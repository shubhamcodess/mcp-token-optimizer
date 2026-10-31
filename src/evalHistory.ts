import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME_DIR } from "./config.js";
import type { EvalResult } from "./eval.js";

export const EVAL_HISTORY = join(HOME_DIR, "eval-history.jsonl");
const KEEP = 50;

export interface EvalRun {
  id: string;
  ts: string;
  label: string;
  source: "captures" | "examples";
  /** The candidate settings this run used on top of the current config (what the dashboard varied). */
  candidate: { profile?: string; format?: string; prettyJsonAboveTokens?: number };
  result: EvalResult;
}

export function readRuns(file = EVAL_HISTORY): EvalRun[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as EvalRun];
    } catch {
      return [];
    }
  });
}

/** Append a run; the file keeps the newest 50. Survives restarts because it is a plain file. */
export function saveRun(run: Omit<EvalRun, "id" | "ts">, file = EVAL_HISTORY): EvalRun {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const full: EvalRun = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: new Date().toISOString(), ...run };
  const all = [...readRuns(file), full];
  if (all.length > KEEP) writeFileSync(file, all.slice(-KEEP).map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  else appendFileSync(file, JSON.stringify(full) + "\n", { mode: 0o600 });
  return full;
}

export interface RunDiff {
  totals: { savedPctDelta: number; tokensOutDelta: number };
  rows: Array<{ key: string; a?: number; b?: number; delta?: number; verdictA?: string; verdictB?: string }>;
}

/** What changed between two runs: total saving and, per tool, saving and verdict. */
export function diffRuns(a: EvalRun, b: EvalRun): RunDiff {
  const keys = [...new Set([...a.result.rows.map((r) => r.key), ...b.result.rows.map((r) => r.key)])];
  return {
    totals: { savedPctDelta: Math.round((b.result.totals.savedPct - a.result.totals.savedPct) * 10) / 10, tokensOutDelta: b.result.totals.tokensOut - a.result.totals.tokensOut },
    rows: keys.map((key) => {
      const x = a.result.rows.find((r) => r.key === key);
      const y = b.result.rows.find((r) => r.key === key);
      return { key, a: x?.savedPct, b: y?.savedPct, delta: x && y ? Math.round((y.savedPct - x.savedPct) * 10) / 10 : undefined, verdictA: x?.verdict, verdictB: y?.verdict };
    }),
  };
}
