import type { Config } from "./config.js";
import type { LlmClient } from "./llm.js";
import { estimateTokens } from "./tokens.js";
import { criticalTokens, restoreFencedCode, splitFencedCode } from "./text.js";

const SYSTEM = `You compress tool output for ANOTHER AI CODING AGENT, not for a human. The agent will act on your text, so accuracy beats brevity.
RULES:
- Keep every identifier, file path, URL, number, version, error message/code, name, date, and decision EXACTLY as written.
- Keep all facts that could change what the agent does next. Remove only pleasantries, marketing, boilerplate, repetition, navigation/footers, and redundant explanation.
- Preserve structure that carries meaning (lists, tables as compact lines, ordered steps, headings).
- Tokens like ⟦CODE0⟧ are placeholders: copy them through verbatim, unchanged, in place.
- Never add information, opinions, or a preamble/conclusion. Output the compressed text only.`;

const dbg = (m: string) => { if (process.env.MTO_DEBUG) process.stderr.write(`[mto:summarize] ${m}\n`); };

export interface SummarizeResult {
  text: string;
  method: "llm";
  coverage: number;
  llmMs: number;
  chunksSummarized: number;
  chunksTotal: number;
}

const HEADING = /^#{1,6}\s[^\n]*$/;

/** Sections split at headings, so every chunk has at most one leading heading (handled outside the LLM). */
function chunkByParagraph(text: string, maxTokens: number): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur: string[] = [];
  let curT = 0;
  const flush = () => {
    if (cur.length) chunks.push(cur.join("\n\n"));
    cur = [];
    curT = 0;
  };
  for (const p of paras) {
    const t = estimateTokens(p);
    if (cur.length && (HEADING.test(p) || curT + t > maxTokens)) flush();
    cur.push(p);
    curT += t;
  }
  flush();
  return chunks;
}

/**
 * LLM summarization with hard guards. Returns null (caller keeps the deterministic result) when nothing was
 * gained or trust cannot be established. Guards:
 *  - latency budget: chunks not finished in time stay VERBATIM (partial summarization is still valid)
 *  - truncated generations are discarded (chunk stays verbatim)
 *  - per-chunk output must be meaningfully shorter, otherwise the original chunk is kept
 *  - critical facts (paths, ids, numbers...) missing from the result are re-attached, or the whole result is rejected
 */
export async function summarize(text: string, cfg: Config, llm: LlmClient, hint?: string): Promise<SummarizeResult | null> {
  if (!llm.available()) return null;
  const started = Date.now();
  const deadline = started + cfg.summarize.maxLatencyMs;
  const { prose, blocks } = splitFencedCode(text);
  const numCtx = Number((cfg.llm.options as { num_ctx?: number }).num_ctx ?? 8192);
  // Small chunks keep each request short so the latency budget yields partial progress instead of nothing.
  const chunks = chunkByParagraph(prose, Math.max(300, Math.min(800, Math.floor(numCtx * 0.3))));
  const outs: string[] = chunks.slice();
  let done = 0;
  let tps = 30; // observed generation speed (tokens/s); starts conservative, adapts after each chunk

  const work = async (idx: number) => {
    // Headings never go through the LLM: strip them here, re-attach verbatim after.
    const paras = chunks[idx].split(/\n{2,}/);
    const lead: string[] = [];
    while (paras.length > 1 && HEADING.test(paras[0])) lead.push(paras.shift()!);
    const chunk = paras.join("\n\n");
    const inTok = estimateTokens(chunk);
    const remaining = deadline - Date.now();
    const targetTok = Math.max(60, Math.round(inTok * cfg.summarize.targetRatio));
    // Never start a request we predict cannot finish inside the budget: an abandoned chunk wastes all its work.
    const predictedMs = (targetTok / tps) * 1000 * 1.25 + 1000;
    if (inTok < 150 || remaining < predictedMs || !llm.available()) return dbg(`chunk ${idx}: skipped (inTok=${inTok} remaining=${remaining}ms predicted=${Math.round(predictedMs)}ms tps=${tps.toFixed(0)})`);
    const user = `${hint ? `Source: ${hint}\n` : ""}Compress to roughly ${targetTok} tokens or fewer.\n\n<input>\n${chunk}\n</input>`;
    try {
      const t0 = Date.now();
      const r = await llm.complete(SYSTEM, user, { timeoutMs: remaining, numPredict: Math.ceil(targetTok * 2) });
      const out = r.text.trim();
      const secs = (Date.now() - t0) / 1000;
      tps = r.tokensPerSec ?? (secs > 2 ? Math.max(5, estimateTokens(out) / secs) : tps);
      if (r.truncated || !out || estimateTokens(out) >= inTok * 0.85) return dbg(`chunk ${idx}: rejected truncated=${r.truncated} in=${inTok} out=${estimateTokens(out)} ${secs.toFixed(1)}s`);
      dbg(`chunk ${idx}: ok ${inTok}->${estimateTokens(out)} tok in ${secs.toFixed(1)}s (${tps.toFixed(0)} tok/s)`);
      outs[idx] = [...lead, out].join("\n\n");
      done++;
    } catch (e) {
      dbg(`chunk ${idx}: error ${(e as Error).message}`);
    }
  };

  // biggest chunks first: best savings per second of LLM time when the budget runs out
  const queue = chunks.map((_, i) => i).sort((a, b) => estimateTokens(chunks[b]) - estimateTokens(chunks[a]));
  await Promise.all(
    Array.from({ length: Math.min(cfg.summarize.concurrency, queue.length) }, async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) await work(i);
    }),
  );
  if (done === 0) return (dbg("no chunk accepted"), null);

  let result = outs.join("\n\n");
  const need = criticalTokens(text);
  const haveSet = result + "\n" + blocks.join("\n");
  const missing = need.filter((t) => !haveSet.includes(t));
  const coverage = need.length ? 1 - missing.length / need.length : 1;
  if (coverage < cfg.summarize.minCoverage) {
    const addendum = `\nPreserved details: ${missing.join("; ")}`;
    result += addendum;
  }
  result = restoreFencedCode(result, blocks);
  if (estimateTokens(result) >= estimateTokens(text) * 0.95) return (dbg("rejected: saves <5%"), null);
  return { text: result, method: "llm", coverage, llmMs: Date.now() - started, chunksSummarized: done, chunksTotal: chunks.length };
}
