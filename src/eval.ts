import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sample } from "./capture.js";
import { diffSample, type Diff } from "./compare.js";
import { defaultConfig, type Config } from "./config.js";
import { OllamaClient } from "./llm.js";
import { Pipeline } from "./pipeline.js";

/** Synthetic examples shipped with the package (see `npm run examples`). */
export const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

const EXAMPLE_FILES: Array<[tool: string, file: string, structured: boolean]> = [
  ["list_issues", "github-issues.json", false],
  ["describe_configmap", "k8s-configmap.json", false],
  ["fetch_guide", "deploy-guide.md", false],
  ["build_log", "build.log", false],
  ["get_page", "page.html", false],
  ["read_file", "source.ts", false],
  ["get_rows", "structured-result.json", true],
];

/** The synthetic examples as capture samples: a regression suite that needs no agent and contains no real data. */
export function exampleSamples(dir = EXAMPLES_DIR): Sample[] {
  const missing = EXAMPLE_FILES.filter(([, f]) => !existsSync(join(dir, f))).map(([, f]) => f);
  if (missing.length) throw new Error(`examples missing (${missing.join(", ")}); run \`npm run examples\``);
  return EXAMPLE_FILES.map(([tool, file, structured]) => ({
    ts: "1970-01-01T00:00:00.000Z",
    server: "demo",
    tool,
    hasOutputSchema: structured,
    result: structured ? JSON.parse(readFileSync(join(dir, file), "utf8")) : { content: [{ type: "text", text: readFileSync(join(dir, file), "utf8") }] },
  }));
}

export interface EvalRow {
  key: string;
  n: number;
  tokensIn: number;
  tokensOut: number;
  savedPct: number;
  lossy: number;
  avgMs: number;
  /** Worst verdict among the samples (value-changed > pruned-data > summarized > equivalent > unchanged). */
  verdict: Diff["verdict"];
  dataDropped: Array<{ path: string; count: number }>;
  factsKept: number;
  factsTotal: number;
}

export interface EvalResult {
  samples: number;
  totals: {
    tokensIn: number;
    tokensOut: number;
    savedPct: number;
    lossy: number;
    /** Samples whose values survived unchanged (no `value-changed` verdict). */
    lossless: { ok: number; total: number; pct: number };
    facts: { kept: number; total: number; pct: number | null };
  };
  rows: EvalRow[];
}

const RANK: Diff["verdict"][] = ["unchanged", "n/a", "equivalent", "summarized", "pruned-data", "value-changed"];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * Replay samples through the pipeline with the given config and measure what happens: savings, whether any value
 * changed (lossless check), which named fields were dropped, and key-fact retention. Same pipeline settings as
 * `mto bench`, so numbers match it. The LLM is off unless asked for: results are then deterministic.
 */
export async function runEval(samples: Sample[], cfg: Config = defaultConfig(), opts: { llm?: boolean } = {}): Promise<EvalResult> {
  const c: Config = { ...cfg, audit: { ...cfg.audit, enabled: false }, cache: { ...cfg.cache, enabled: false }, retrieval: { ...cfg.retrieval, enabled: false }, summarize: { ...cfg.summarize, enabled: !!opts.llm && cfg.summarize.enabled } };
  const llm = new OllamaClient(c.llm);
  if (opts.llm) await llm.warm();
  const pipeline = new Pipeline(c, llm, null);
  const by = new Map<string, { row: EvalRow; ms: number; drop: Map<string, number> }>();
  for (const s of samples) {
    const key = `${s.server}.${s.tool}`;
    const { result, report } = await pipeline.optimizeResult(s.result as never, { server: s.server, tool: s.tool, hasOutputSchema: s.hasOutputSchema });
    const d = diffSample({ ...s, optimized: result as Sample["optimized"] });
    const e = by.get(key) ?? { row: { key, n: 0, tokensIn: 0, tokensOut: 0, savedPct: 0, lossy: 0, avgMs: 0, verdict: "unchanged" as Diff["verdict"], dataDropped: [], factsKept: 0, factsTotal: 0 }, ms: 0, drop: new Map<string, number>() };
    e.row.n++;
    e.row.tokensIn += report.tokensIn;
    e.row.tokensOut += report.tokensOut;
    e.row.lossy += report.lossy ? 1 : 0;
    e.ms += report.latencyMs;
    if (d) {
      if (RANK.indexOf(d.verdict) > RANK.indexOf(e.row.verdict)) e.row.verdict = d.verdict;
      for (const x of d.dataDropped) e.drop.set(x.path, (e.drop.get(x.path) ?? 0) + x.count);
      e.row.factsKept += d.factsKept ?? 0;
      e.row.factsTotal += d.factsTotal ?? 0;
    }
    by.set(key, e);
  }
  const rows = [...by.values()].map(({ row, ms, drop }): EvalRow => ({ ...row, savedPct: pct(row.tokensIn - row.tokensOut, row.tokensIn), avgMs: Math.round(ms / row.n), dataDropped: [...drop].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 10) }));
  rows.sort((a, b) => b.tokensIn - b.tokensOut - (a.tokensIn - a.tokensOut));
  const tokensIn = rows.reduce((a, r) => a + r.tokensIn, 0);
  const tokensOut = rows.reduce((a, r) => a + r.tokensOut, 0);
  const changed = rows.filter((r) => r.verdict === "value-changed").reduce((a, r) => a + r.n, 0);
  const kept = rows.reduce((a, r) => a + r.factsKept, 0);
  const total = rows.reduce((a, r) => a + r.factsTotal, 0);
  return {
    samples: samples.length,
    totals: { tokensIn, tokensOut, savedPct: pct(tokensIn - tokensOut, tokensIn), lossy: rows.reduce((a, r) => a + r.lossy, 0), lossless: { ok: samples.length - changed, total: samples.length, pct: pct(samples.length - changed, samples.length) }, facts: { kept, total, pct: total ? pct(kept, total) : null } },
    rows,
  };
}

// ---------- gates

export interface Thresholds {
  /** minimum total saved %, e.g. 55 */
  savings?: number;
  /** minimum key-fact retention %, e.g. 97 (only checked when a summarized sample exists) */
  facts?: number;
  /** minimum % of samples with no changed values, e.g. 100 */
  lossless?: number;
}

/** `savings=60,facts=97,lossless=100` */
export function parseThresholds(spec: string): Thresholds {
  const out: Thresholds = {};
  for (const part of spec.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = part.split("=");
    const n = Number(v);
    if (!["savings", "facts", "lossless"].includes(k) || !Number.isFinite(n)) throw new Error(`bad --fail-under entry "${part}" (use savings=NN, facts=NN, lossless=NN)`);
    out[k as keyof Thresholds] = n;
  }
  return out;
}

export interface Baseline {
  tolerance?: number;
  rows: Record<string, { savedPct: number; verdict: Diff["verdict"] }>;
}

export const toBaseline = (r: EvalResult, tolerance = 0.5): Baseline => ({ tolerance, rows: Object.fromEntries(r.rows.map((x) => [x.key, { savedPct: x.savedPct, verdict: x.verdict }])) });

export interface GateReport {
  ok: boolean;
  failures: string[];
}

/** Check a result against thresholds and/or a baseline of expected per-tool numbers. */
export function checkGates(r: EvalResult, t: Thresholds = {}, base?: Baseline): GateReport {
  const failures: string[] = [];
  if (t.savings !== undefined && r.totals.savedPct < t.savings) failures.push(`savings ${r.totals.savedPct}% is below ${t.savings}%`);
  if (t.lossless !== undefined && r.totals.lossless.pct < t.lossless) failures.push(`lossless ${r.totals.lossless.pct}% is below ${t.lossless}% (${r.totals.lossless.total - r.totals.lossless.ok} sample(s) had changed values)`);
  if (t.facts !== undefined && r.totals.facts.pct !== null && r.totals.facts.pct < t.facts) failures.push(`facts retained ${r.totals.facts.pct}% is below ${t.facts}%`);
  if (base) {
    const tol = base.tolerance ?? 0.5;
    for (const [key, want] of Object.entries(base.rows)) {
      const got = r.rows.find((x) => x.key === key);
      if (!got) failures.push(`${key}: expected in the results but missing`);
      else if (Math.abs(got.savedPct - want.savedPct) > tol) failures.push(`${key}: saved ${got.savedPct}%, expected ${want.savedPct}% (±${tol})`);
      else if (got.verdict !== want.verdict) failures.push(`${key}: verdict ${got.verdict}, expected ${want.verdict}`);
    }
    for (const x of r.rows) if (!base.rows[x.key]) failures.push(`${x.key}: not in the baseline`);
  }
  return { ok: failures.length === 0, failures };
}

export function formatEval(r: EvalResult): string {
  const head = `${"server.tool".padEnd(28)} ${"n".padStart(3)} ${"in".padStart(7)} ${"out".padStart(7)} ${"saved".padStart(7)} ${"ms".padStart(5)}  verdict`;
  const line = (x: EvalRow) => `${x.key.padEnd(28)} ${String(x.n).padStart(3)} ${String(x.tokensIn).padStart(7)} ${String(x.tokensOut).padStart(7)} ${`${x.savedPct.toFixed(1)}%`.padStart(7)} ${String(x.avgMs).padStart(5)}  ${x.verdict}${x.dataDropped.length ? ` (${x.dataDropped.slice(0, 3).map((d) => `${d.count}× ${d.path}`).join(", ")})` : ""}`;
  const t = r.totals;
  return [head, "-".repeat(head.length), ...r.rows.map(line), "-".repeat(head.length), `TOTAL ${t.tokensIn} → ${t.tokensOut} tokens, ${t.savedPct}% saved · lossless ${t.lossless.ok}/${t.lossless.total}${t.facts.pct === null ? "" : ` · facts ${t.facts.pct}%`}`, "(token counts are estimates)"].join("\n");
}

// ---------- fidelity (what scripts/fidelity.mjs does, against pasted text)

/** Walk `$.a["b"][0]` into a JSON value. Throws if the path is not in the original. */
export function jsonPathGet(value: unknown, path: string): unknown {
  let cur = value;
  for (const m of path.replace(/^\$/, "").matchAll(/\.([A-Za-z_][\w-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g)) {
    const k = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(`"${m[3]}"`));
    if (cur === null || typeof cur !== "object" || !(k in (cur as object))) throw new Error(`path not found in the original: ${path}`);
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

export interface Fidelity {
  identical: boolean;
  originalBytes: number;
  givenBytes: number;
  firstDifference?: number;
  whitespaceOnly?: boolean;
}

/** Is `given` (what the agent produced) byte-identical to the original tool result, or to `path` inside it? */
export function checkFidelity(sample: Sample, given: string, path?: string): Fidelity {
  let original = (sample.result.content ?? []).map((c) => c.text ?? "").join("\n");
  if (path) {
    const v = jsonPathGet(JSON.parse(original), path);
    original = typeof v === "string" ? v : JSON.stringify(v);
  }
  if (given === original) return { identical: true, originalBytes: original.length, givenBytes: given.length };
  let i = 0;
  while (i < original.length && i < given.length && original[i] === given[i]) i++;
  return { identical: false, originalBytes: original.length, givenBytes: given.length, firstDifference: i, whitespaceOnly: given.replace(/\r/g, "").trim() === original.replace(/\r/g, "").trim() };
}
