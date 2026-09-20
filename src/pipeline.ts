import { createHash } from "node:crypto";
import type { Config, ToolRuleT } from "./config.js";
import { matchesAny, toolRule } from "./config.js";
import type { LlmClient } from "./llm.js";
import { buildPruneOptions, dedupeAcrossFields, prune } from "./prune.js";
import { makeRedactor } from "./redact.js";
import type { OriginalStore } from "./store.js";
import { summarize } from "./summarize.js";
import { htmlToText, looksLikeCodeOrDiff, looksLikeHtml, normalizeText } from "./text.js";
import { estimateTokens } from "./tokens.js";
import { deepEqual, fromToon, toToon } from "./toon.js";

export interface CallContext {
  server: string;
  tool: string;
  /** JSON Schema of the tool's outputSchema, if the server declared one (results must stay valid JSON). */
  hasOutputSchema?: boolean;
  /** Effective mode for this call is shadow (result will be discarded): don't store originals or add notes. */
  shadow?: boolean;
}

export interface Report {
  tokensIn: number;
  tokensOut: number;
  stages: string[];
  lossy: boolean;
  redactions: Record<string, number>;
  latencyMs: number;
}

interface TextOutcome {
  text: string;
  stages: string[];
  lossy: boolean;
  redactions: Record<string, number>;
}

type McpResult = { content?: { type: string; text?: string; [k: string]: unknown }[]; structuredContent?: unknown; isError?: boolean; [k: string]: unknown };

export class Pipeline {
  private cache = new Map<string, TextOutcome>();
  private redact;

  constructor(
    readonly cfg: Config,
    private llm: LlmClient,
    private store: OriginalStore | null,
  ) {
    this.redact = makeRedactor(cfg);
  }

  async optimizeResult(result: McpResult, ctx: CallContext): Promise<{ result: McpResult; report: Report }> {
    const t0 = Date.now();
    const subject = `${ctx.server}.${ctx.tool}`;
    const rule = toolRule(this.cfg, subject);
    const report: Report = { tokensIn: 0, tokensOut: 0, stages: [], lossy: false, redactions: {}, latencyMs: 0 };
    if (!Array.isArray(result.content)) return { result, report };

    const structured = result.structuredContent !== undefined;
    const content = [];
    for (const item of result.content) {
      if (item.type !== "text" || typeof item.text !== "string") {
        content.push(item);
        continue;
      }
      const out = await this.optimizeText(item.text, ctx, rule, { isError: !!result.isError, structured });
      report.tokensIn += estimateTokens(item.text);
      report.tokensOut += estimateTokens(out.text);
      for (const s of out.stages) if (!report.stages.includes(s)) report.stages.push(s);
      report.lossy ||= out.lossy;
      for (const [k, n] of Object.entries(out.redactions)) report.redactions[k] = (report.redactions[k] ?? 0) + n;
      content.push({ ...item, text: out.text });
    }
    report.latencyMs = Date.now() - t0;
    return { result: { ...result, content }, report };
  }

  async optimizeText(
    original: string,
    ctx: CallContext,
    rule: ToolRuleT,
    flags: { isError: boolean; structured: boolean },
  ): Promise<TextOutcome> {
    const unchanged: TextOutcome = { text: original, stages: [], lossy: false, redactions: {} };
    const inTok = estimateTokens(original);
    if (inTok < this.cfg.skipBelowTokens) return unchanged;

    const subject = `${ctx.server}.${ctx.tool}`;
    const key = this.cfg.cache.enabled ? createHash("sha1").update(subject).update("\0").update(original).digest("hex") : "";
    if (key) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }

    let out = await this.compute(original, ctx, rule, flags, subject);
    // Never-bigger guarantee: only accept strictly cheaper output.
    if (estimateTokens(out.text) >= inTok) {
      // Fall back to the original, but never re-expose secrets that redact mode already removed.
      const safe = this.cfg.redaction.mode === "redact" ? this.redact(original).text : original;
      out = { ...unchanged, text: safe, redactions: out.redactions };
    }

    if (key) {
      this.cache.set(key, out);
      if (this.cache.size > this.cfg.cache.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
    }
    return out;
  }

  private async compute(original: string, ctx: CallContext, rule: ToolRuleT, flags: { isError: boolean; structured: boolean }, subject: string): Promise<TextOutcome> {
    const stages: string[] = [];
    let lossy = false;
    const noteParts: string[] = [];
    let noteDone = false;
    let value: unknown;

    const red = this.redact(original);
    let text = red.text;
    if (this.cfg.redaction.mode === "redact" && Object.keys(red.findings).length) stages.push("redact");

    const trimmed = text.trimStart();
    const jsonish = trimmed.startsWith("{") || trimmed.startsWith("[");
    let parsed: unknown;
    let isJson = false;
    if (jsonish) {
      try {
        parsed = JSON.parse(text);
        isJson = typeof parsed === "object" && parsed !== null;
      } catch {
        /* plain text that merely starts with a bracket */
      }
    }

    if (isJson) {
      const mustKeepJson = !!ctx.hasOutputSchema || flags.structured || matchesAny(this.cfg.format.jsonTools, subject) || rule.format === "json" || rule.format === "json-pretty" || (this.cfg.format.prettyJsonAboveTokens > 0 && estimateTokens(original) > this.cfg.format.prettyJsonAboveTokens);
      value = parsed;
      // Outputs bound to a schema/structuredContent are contracts: minify only, never drop fields.
      if (!ctx.hasOutputSchema && !flags.structured) {
        const opts = buildPruneOptions(this.cfg, rule);
        const pr = prune(parsed, opts);
        value = pr.value;
        if (pr.stats.droppedKeys || pr.stats.droppedEmpty) stages.push("prune");
        if (pr.stats.droppedKeys) {
          const top = Object.entries(pr.stats.droppedKeyNames).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join(", ");
          noteParts.push(`pruned low-value fields: ${top}`);
        }
        if (pr.stats.lossy) lossy = true;
        if (this.cfg.prune.dedupeAcrossFields ?? this.cfg.profile !== "conservative") {
          const dd = dedupeAcrossFields(value);
          if (dd.runs) {
            value = dd.value;
            stages.push("xdedupe");
          }
        }
      }
      const expandable = !!this.store && this.cfg.retrieval.enabled && !(ctx.shadow ?? this.cfg.mode === "shadow") && (lossy || noteParts.length > 0);
      const id = expandable ? this.store!.put(original) : "";
      const note = id ? `${noteParts.join("; ") || "condensed"}. Only if you need them: mto_expand {"id":"${id}","path":...}` : "";
      // Plain JSON must stay valid JSON, so the note travels as a top-level key (objects only); TOON/text get a trailing line.
      const jsonValue = note && value && typeof value === "object" && !Array.isArray(value) ? { ...(value as object), _mto: note } : value;
      const format = rule.format ?? this.cfg.format.default;
      const pretty = format === "json-pretty" || (this.cfg.format.prettyJsonAboveTokens > 0 && estimateTokens(original) > this.cfg.format.prettyJsonAboveTokens);
      const jsonText = pretty ? JSON.stringify(jsonValue, null, 2) : JSON.stringify(jsonValue);
      let best = jsonText;
      let noted = jsonValue !== value;
      if (!mustKeepJson && format !== "json" && format !== "json-pretty") {
        const toon = safeToon(value);
        if (toon && (format === "toon" || estimateTokens(toon) < estimateTokens(jsonText))) {
          best = note ? `${toon}\n[mto: ${note}]` : toon;
          noted = !!note;
          stages.push("toon");
        }
      }
      if (best === jsonText && jsonText.length < text.length) stages.push(pretty ? "json-pretty" : "minify");
      text = best;
      if (id) noteDone = noted;
    } else {
      const before = text;
      if (looksLikeHtml(text)) {
        text = htmlToText(text);
        stages.push("html→text");
      }
      text = normalizeText(text);
      if (text !== before && !stages.includes("html→text")) stages.push("normalize");

      const canSummarize =
        this.cfg.summarize.enabled &&
        rule.summarize !== false &&
        !flags.isError &&
        estimateTokens(text) >= this.cfg.summarize.minTokens &&
        !matchesAny(this.cfg.summarize.neverTools, subject) &&
        !looksLikeCodeOrDiff(text);
      if (canSummarize) {
        const s = await summarize(text, this.cfg, this.llm, subject);
        if (s) {
          text = s.text;
          lossy = true;
          stages.push(`summarize(${this.cfg.llm.model})`);
        }
      }
    }

    if (lossy && !noteDone && this.store && this.cfg.retrieval.enabled && !(ctx.shadow ?? this.cfg.mode === "shadow")) {
      const id = this.store.put(original);
      text += `\n[mto: condensed. Exact original available via tool mto_expand {"id":"${id}"}]`;
    }
    return { text, stages, lossy, redactions: red.findings };
  }
}

/** TOON is only emitted when decode(encode(x)) deep-equals x. */
function safeToon(value: unknown): string | null {
  try {
    const t = toToon(value);
    return deepEqual(fromToon(t), JSON.parse(JSON.stringify(value))) ? t : null;
  } catch {
    return null;
  }
}
