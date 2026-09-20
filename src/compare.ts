import type { Sample } from "./capture.js";
import { criticalTokens } from "./text.js";
import { estimateTokens } from "./tokens.js";
import { fromToon } from "./toon.js";

type Leaf = Map<string, unknown>;

const textOf = (r?: { content?: { text?: string }[] }): string => (r?.content ?? []).map((c) => c.text ?? "").join("\n");

/** Reverses TOON / strips the [mto: …] note and `_mto` key so the optimized payload can be compared structurally. */
export function decodeOptimized(text: string): unknown | undefined {
  const noNote = text.replace(/\n?\[mto: [^\n]*\]\s*$/, "");
  for (const attempt of [() => JSON.parse(noNote), () => fromToon(noNote)]) {
    try {
      const v = attempt();
      if (v && typeof v === "object") {
        if (!Array.isArray(v)) delete (v as Record<string, unknown>)._mto;
        return v;
      }
    } catch {
      /* next */
    }
  }
  return undefined;
}

function leaves(v: unknown, path = "$", out: Leaf = new Map()): Leaf {
  if (Array.isArray(v)) {
    if (v.length === 0) out.set(path, []);
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  } else if (v && typeof v === "object") {
    const e = Object.entries(v);
    if (e.length === 0) out.set(path, {});
    for (const [k, x] of e) leaves(x, `${path}.${k}`, out);
  } else out.set(path, v);
  return out;
}

const norm = (p: string) => p.replace(/\[\d+\]/g, "[]");
const isEmpty = (v: unknown) => v === null || v === "" || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Object.keys(v).length);
const POINTER = /lines identical to .* omitted/;

export interface Diff {
  tokensIn: number;
  tokensOut: number;
  kind: "json" | "text";
  emptyDropped: number;
  dataDropped: { path: string; count: number }[];
  pointers: number;
  changed: number;
  factsKept?: number;
  factsTotal?: number;
  verdict: "equivalent" | "pruned-data" | "value-changed" | "summarized" | "unchanged" | "n/a";
}

export function diffSample(s: Sample): Diff | undefined {
  if (!s.optimized) return undefined;
  const before = textOf(s.result);
  const after = textOf(s.optimized);
  const base = { tokensIn: estimateTokens(before), tokensOut: estimateTokens(after) };
  let orig: unknown;
  try {
    orig = JSON.parse(before);
  } catch {
    /* text */
  }
  if (orig && typeof orig === "object") {
    const opt = decodeOptimized(after);
    if (opt === undefined) return { ...base, kind: "json", emptyDropped: 0, dataDropped: [], pointers: 0, changed: 0, verdict: "n/a" };
    const a = leaves(orig);
    const b = leaves(opt);
    let emptyDropped = 0;
    let changed = 0;
    let pointers = 0;
    const dropped = new Map<string, number>();
    for (const [p, v] of a) {
      if (!b.has(p)) {
        if (isEmpty(v)) emptyDropped++;
        else dropped.set(norm(p), (dropped.get(norm(p)) ?? 0) + 1);
      } else if (JSON.stringify(b.get(p)) !== JSON.stringify(v)) {
        if (typeof b.get(p) === "string" && POINTER.test(b.get(p) as string)) pointers++;
        else changed++;
      }
    }
    const dataDropped = [...dropped].map(([path, count]) => ({ path, count })).sort((x, y) => y.count - x.count);
    return { ...base, kind: "json", emptyDropped, dataDropped, pointers, changed, verdict: changed ? "value-changed" : dataDropped.length ? "pruned-data" : pointers || emptyDropped ? "equivalent" : "unchanged" };
  }
  const facts = criticalTokens(before);
  const kept = facts.filter((f) => after.includes(f)).length;
  return { ...base, kind: "text", emptyDropped: 0, dataDropped: [], pointers: 0, changed: 0, factsKept: kept, factsTotal: facts.length, verdict: after === before ? "unchanged" : "summarized" };
}

export function formatCompare(samples: Sample[], opts: { md?: boolean } = {}): string {
  const out: string[] = [];
  const tally: Record<string, number> = {};
  for (const s of samples) {
    const d = diffSample(s);
    if (!d) continue;
    tally[d.verdict] = (tally[d.verdict] ?? 0) + 1;
    const pct = d.tokensIn ? (100 * (1 - d.tokensOut / d.tokensIn)).toFixed(1) : "0";
    out.push(`${opts.md ? "### " : ""}${s.server}.${s.tool}  ${s.ts.slice(11, 19)}  ${d.tokensIn} → ${d.tokensOut} tok (-${pct}%)  [${d.verdict.toUpperCase()}]`);
    if (d.kind === "json") {
      out.push(`  empty/null fields dropped: ${d.emptyDropped}   duplicate-line pointers: ${d.pointers}   values changed: ${d.changed}`);
      if (d.dataDropped.length) out.push(`  DATA fields the agent no longer sees:\n${d.dataDropped.slice(0, 12).map((x) => `    ${String(x.count).padStart(4)}× ${x.path}`).join("\n")}`);
    } else out.push(`  critical facts retained: ${d.factsKept}/${d.factsTotal}`);
  }
  const summary = Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(", ");
  return `${out.join("\n")}\n\n${samples.filter((s) => s.optimized).length} compared: ${summary || "nothing yet"}.\n"equivalent" = same information (only nulls/empties removed or duplicates pointed); "pruned-data" = named fields dropped (listed above); "value-changed" would be a bug.`;
}
