import type { Audit } from "./audit.js";
import { captureEnabled, writeCapture } from "./capture.js";
import { makeRedactor } from "./redact.js";
import { toolRule, type Config } from "./config.js";
import type { Pipeline } from "./pipeline.js";
import { estimateTokens } from "./tokens.js";
import type { OriginalStore } from "./store.js";

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any; result?: any; error?: any };

export const EXPAND_TOOL = "mto_expand";

const EXPAND_DEF = {
  name: EXPAND_TOOL,
  description:
    "Fetch the EXACT, unmodified original of a tool result that was compacted (pruned fields, deduplicated lines, or summarized). Call this whenever a result carries an `[mto: ... mto_expand {\"id\":...}]` note (or `_mto` key) AND you need data that seems missing, a field you expected, or exact text. Notes list exactly what was removed, so usually you do NOT need this. With only `id` you get an outline (structure + sizes); then fetch just what you need with `path` (e.g. `$.items[3].spec`) or `grep`. `full=true` returns everything (large).",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "12-char id from the condensed result" },
      path: { type: "string", description: "Optional JSON path into the original, e.g. $.manifest.data[\"app.yaml\"] or $.items[2]" },
      grep: { type: "string", description: "Optional regex; return only matching lines (+2 lines context)" },
      full: { type: "boolean", description: "Return the entire original (can be very large)" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, description: "Max chars to return (default 20000)" },
    },
    required: ["id"],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

/** Cheap map of the original so the agent can ask for a part instead of the whole thing. */
function outline(text: string): string {
  const total = estimateTokens(text);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    const lines = text.split("\n");
    return `Original is text: ${lines.length} lines, ~${total} tokens. Use grep="regex", offset/limit (chars), or full=true.`;
  }
  const rows: [string, number][] = [];
  const walk = (node: any, path: string, depth: number) => {
    if (node && typeof node === "object" && depth < 3) {
      const entries: [string | number, any][] = Array.isArray(node) ? (node.length > 12 ? node.slice(0, 3).map((x, i) => [i, x] as [number, any]) : node.map((x, i) => [i, x] as [number, any])) : Object.entries(node);
      if (Array.isArray(node) && node.length > 12) {
        rows.push([`${path}  (array of ${node.length}; showing first 3 items)`, estimateTokens(JSON.stringify(node))]);
        const first = node[0];
        if (first && typeof first === "object" && !Array.isArray(first)) rows.push([`${path}[i] keys: ${Object.keys(first).slice(0, 24).join(", ")}  (use ${path}[i].<key>)`, estimateTokens(JSON.stringify(first))]);
      }
      for (const [k, x] of entries) walk(x, typeof k === "number" ? `${path}[${k}]` : /^[A-Za-z_]\w*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, depth + 1);
    } else rows.push([path, estimateTokens(JSON.stringify(node))]);
  };
  walk(v, "$", 0);
  const top = rows.sort((a, b) => b[1] - a[1]).slice(0, 25);
  return `Original is JSON, ~${total} tokens. Largest parts:\n${top.map(([p, t]) => `  ${String(t).padStart(6)} tok  ${p}`).join("\n")}\nFetch a part with path="<one of the above>", search with grep="regex", or pass full=true for everything.`;
}

interface Pending {
  method: string;
  tool?: string;
}

/**
 * Transport-agnostic JSON-RPC interceptor for ONE agent<->server connection. Both the stdio wrapper and the
 * HTTP proxy feed messages through it. Fail-open by construction: any internal error forwards the original.
 */
export class Session {
  private pending = new Map<string | number, Pending>();
  private outputSchemaTools = new Set<string>();
  private clientName?: string;
  private captureRedact: ReturnType<typeof makeRedactor>;

  constructor(
    private server: string,
    private cfg: Config,
    private pipeline: Pipeline,
    private audit: Audit,
    private store: OriginalStore | null,
  ) {
    this.captureRedact = makeRedactor({ ...cfg, redaction: { ...cfg.redaction, mode: "redact" } });
  }

  /** Agent -> server. `reply` means: answer locally and do not forward. */
  fromClient(msg: Msg): { forward?: Msg; reply?: Msg } {
    try {
      if (msg.id !== undefined && msg.id !== null && typeof msg.method === "string") {
        if (msg.method === "tools/call" && msg.params?.name === EXPAND_TOOL && this.store && this.cfg.retrieval.enabled) {
          const reply = this.expand(msg);
          this.audit.write({ ts: new Date().toISOString(), server: this.server, tool: EXPAND_TOOL, client: this.clientName, mode: "active", tokensIn: 0, tokensOut: estimateTokens(JSON.stringify(reply.result?.content ?? "")), stages: [reply.result?.isError ? "expand-miss" : "expand"], lossy: false, redactions: {}, latencyMs: 0 });
          return { reply };
        }
        this.pending.set(msg.id, { method: msg.method, tool: msg.params?.name });
        if (msg.method === "initialize") this.clientName = msg.params?.clientInfo?.name;
      }
    } catch {
      /* fail open */
    }
    return { forward: msg };
  }

  /** Server -> agent. */
  async fromServer(msg: Msg): Promise<Msg> {
    try {
      if (msg.id === undefined || msg.id === null || msg.result === undefined) return msg;
      const p = this.pending.get(msg.id);
      if (!p) return msg;
      this.pending.delete(msg.id);
      if (this.cfg.mode === "off") return msg;

      switch (p.method) {
        case "initialize":
          return this.onInitialize(msg);
        case "tools/list":
          return this.onToolsList(msg);
        case "tools/call":
          return await this.onToolCall(msg, p.tool ?? "unknown");
        default:
          return msg;
      }
    } catch (e) {
      process.stderr.write(`[mto] optimizer error (forwarding original): ${(e as Error).message}\n`);
      return msg;
    }
  }

  /** Optimization can happen for at least one tool (global active, or a per-tool `mode: active` override). */
  private get canOptimize(): boolean {
    return this.cfg.mode === "active" || Object.values(this.cfg.tools).some((r) => r.mode === "active");
  }

  private onInitialize(msg: Msg): Msg {
    if (!this.cfg.format.announceToon || !this.canOptimize) return msg;
    const note =
      "Some tool results are compacted by mcp-token-optimizer: TOON is lossless JSON in indented form (`key[N]{a,b}:` starts a table whose N rows follow as comma-separated values). Results with an `[mto: ...]` note (or `_mto` key) were compacted: low-value fields pruned, duplicate lines pointed at their canonical copy, or text summarized. If you need something that seems missing, call `mto_expand` with that id (optionally `path` or `grep`) to get the exact original.";
    const prev = typeof msg.result.instructions === "string" ? `${msg.result.instructions}\n\n` : "";
    return { ...msg, result: { ...msg.result, instructions: prev + note } };
  }

  private onToolsList(msg: Msg): Msg {
    const tools: any[] = Array.isArray(msg.result?.tools) ? msg.result.tools : [];
    for (const t of tools) if (t.outputSchema) this.outputSchemaTools.add(t.name);
    let out = tools;
    if (this.cfg.toolDefinitions.enabled && this.cfg.mode === "active") {
      const strip = new Set(this.cfg.toolDefinitions.stripKeys);
      // Strip annotation keywords from schemas. Keys directly under `properties`/`$defs`/`definitions` are
      // parameter names, not keywords, so they are recursed into but never removed.
      const NAMESPACES = new Set(["properties", "$defs", "definitions", "patternProperties"]);
      const clean = (v: any, isNamespace = false): any => {
        if (Array.isArray(v)) return v.map((x) => clean(x));
        if (!v || typeof v !== "object") return v;
        return Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => isNamespace || !strip.has(k))
            .map(([k, x]) => [k, clean(x, !isNamespace && NAMESPACES.has(k))]),
        );
      };
      out = tools.map((t) => ({ ...t, inputSchema: clean(t.inputSchema), ...(t.outputSchema ? { outputSchema: clean(t.outputSchema) } : {}) }));
    }
    if (this.store && this.cfg.retrieval.enabled && this.canOptimize && !msg.result.nextCursor && !out.some((t) => t.name === EXPAND_TOOL)) {
      out = [...out, EXPAND_DEF];
    }
    return { ...msg, result: { ...msg.result, tools: out } };
  }

  private async onToolCall(msg: Msg, tool: string): Promise<Msg> {
    const rule = toolRule(this.cfg, `${this.server}.${tool}`);
    const mode = rule.mode ?? this.cfg.mode;
    if (mode === "off") return msg;
    const { result, report } = await this.pipeline.optimizeResult(msg.result, {
      server: this.server,
      tool,
      hasOutputSchema: this.outputSchemaTools.has(tool),
      shadow: mode === "shadow",
    });
    if (captureEnabled()) writeCapture(this.server, tool, this.outputSchemaTools.has(tool), msg.result, this.captureRedact, mode === "shadow" ? undefined : result);
    this.audit.write({
      ts: new Date().toISOString(),
      server: this.server,
      tool,
      client: this.clientName,
      mode,
      tokensIn: report.tokensIn,
      tokensOut: report.tokensOut,
      stages: report.stages,
      lossy: report.lossy,
      redactions: report.redactions,
      latencyMs: report.latencyMs,
    });
    return mode === "shadow" ? msg : { ...msg, result };
  }

  private expand(msg: Msg): Msg {
    const a = msg.params?.arguments ?? {};
    const text = this.store!.get(String(a.id ?? ""));
    const reply = (t: string, isError = false): Msg => ({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: t }], isError } });
    if (text === undefined) return reply(`No stored original for id "${a.id}" (expired or unknown).`, true);
    if (typeof a.path === "string" && a.path) {
      try {
        let cur: any = JSON.parse(text);
        for (const m of a.path.replace(/^\$/, "").matchAll(/\.([A-Za-z_][\w-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g)) {
          const k: string | number = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(`"${m[3]}"`));
          if (cur === null || typeof cur !== "object" || !(k in cur)) return reply(`Path not found: ${a.path}`, true);
          cur = cur[k];
        }
        const out = typeof cur === "string" ? cur : JSON.stringify(cur, null, 2);
        return reply(out.length > 40000 ? out.slice(0, 40000) + `\n[mto: truncated; ${out.length - 40000} more chars, narrow the path]` : out);
      } catch {
        return reply("The stored original is not JSON; use grep/offset instead.", true);
      }
    }
    if (typeof a.grep === "string" && a.grep) {
      let re: RegExp;
      try {
        re = new RegExp(a.grep, "i");
      } catch {
        return reply(`Invalid regex: ${a.grep}`, true);
      }
      const lines = text.split("\n");
      const keep = new Set<number>();
      lines.forEach((l, i) => {
        if (re.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) keep.add(k);
      });
      const out = [...keep].sort((x, y) => x - y).map((i) => lines[i]).join("\n");
      return reply(out || "No lines matched.");
    }
    if (!a.full && a.offset === undefined && a.limit === undefined) return reply(outline(text));
    const offset = Number(a.offset ?? 0);
    const limit = Number(a.limit ?? (a.full ? 400000 : 20000));
    const slice = text.slice(offset, offset + limit);
    const more = offset + limit < text.length ? `\n[mto: ${text.length - offset - limit} more chars; call again with offset=${offset + limit}]` : "";
    return reply(slice + more);
  }
}
