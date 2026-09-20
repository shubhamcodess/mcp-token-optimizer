import { writeFileSync } from "node:fs";
import type { Config } from "./config.js";
import { OllamaClient } from "./llm.js";
import { Pipeline } from "./pipeline.js";
import type { Sample } from "./capture.js";
import { criticalTokens } from "./text.js";
import { estimateTokens } from "./tokens.js";

export interface BenchRow { key: string; n: number; tin: number; tout: number; lossy: number; ms: number; stages: Set<string>; factsKept: number; factsTotal: number }

/** Replays captured samples through the pipeline (no store writes) and measures savings, latency and fact retention. */
export async function runBench(samples: Sample[], cfg: Config, opts: { llm: boolean; dump?: string; sampleCap?: number }) {
  const c: Config = { ...cfg, audit: { ...cfg.audit, enabled: false }, cache: { ...cfg.cache, enabled: false }, retrieval: { ...cfg.retrieval, enabled: false }, summarize: { ...cfg.summarize, enabled: opts.llm && cfg.summarize.enabled } };
  const llm = new OllamaClient(c.llm);
  if (opts.llm) await llm.warm();
  const p = new Pipeline(c, llm, null);
  const rows = new Map<string, BenchRow>();
  const dump: string[] = [];
  const picked = opts.sampleCap ? samples.slice(-opts.sampleCap) : samples;
  for (const s of picked) {
    const key = `${s.server}.${s.tool}`;
    const r = rows.get(key) ?? { key, n: 0, tin: 0, tout: 0, lossy: 0, ms: 0, stages: new Set(), factsKept: 0, factsTotal: 0 };
    const { result, report } = await p.optimizeResult(s.result as never, { server: s.server, tool: s.tool, hasOutputSchema: s.hasOutputSchema });
    r.n++; r.tin += report.tokensIn; r.tout += report.tokensOut; r.ms += report.latencyMs; if (report.lossy) r.lossy++;
    report.stages.forEach((x) => r.stages.add(x));
    const before = (s.result.content ?? []).map((x) => x.text ?? "").join("\n");
    const after = ((result as any).content ?? []).map((x: any) => x.text ?? "").join("\n");
    if (report.stages.some((x) => x.startsWith("summarize"))) {
      const facts = criticalTokens(before);
      r.factsTotal += facts.length;
      r.factsKept += facts.filter((f) => after.includes(f)).length;
    }
    rows.set(key, r);
    if (opts.dump && report.tokensIn - report.tokensOut > 200) dump.push(`## ${key}  (${report.tokensIn} → ${report.tokensOut} tokens; ${report.stages.join(", ")})\n\n### before\n\`\`\`\n${before.slice(0, 2500)}\n\`\`\`\n### after\n\`\`\`\n${after.slice(0, 2500)}\n\`\`\`\n`);
  }
  if (opts.dump) writeFileSync(opts.dump, `# mto bench report (${c.llm.model}, llm=${opts.llm})\n\n${dump.join("\n")}`);
  return [...rows.values()].sort((a, b) => b.tin - b.tout - (a.tin - a.tout));
}

export function formatBench(rows: BenchRow[]): string {
  const head = `${"server.tool".padEnd(34)} ${"n".padStart(4)} ${"in".padStart(8)} ${"out".padStart(8)} ${"saved".padStart(7)} ${"lossy".padStart(5)} ${"avg ms".padStart(7)} ${"facts".padStart(7)}  stages`;
  const line = (r: BenchRow) =>
    `${r.key.slice(0, 34).padEnd(34)} ${String(r.n).padStart(4)} ${String(r.tin).padStart(8)} ${String(r.tout).padStart(8)} ${(r.tin ? (100 * (r.tin - r.tout)) / r.tin : 0).toFixed(1).padStart(6)}% ${String(r.lossy).padStart(5)} ${(r.ms / r.n).toFixed(0).padStart(7)} ${(r.factsTotal ? `${((100 * r.factsKept) / r.factsTotal).toFixed(0)}%` : "-").padStart(7)}  ${[...r.stages].join(",")}`;
  const t = rows.reduce((a, r) => ({ ...a, n: a.n + r.n, tin: a.tin + r.tin, tout: a.tout + r.tout, lossy: a.lossy + r.lossy, ms: a.ms + r.ms, factsKept: a.factsKept + r.factsKept, factsTotal: a.factsTotal + r.factsTotal }), { key: "TOTAL", n: 0, tin: 0, tout: 0, lossy: 0, ms: 0, stages: new Set<string>(), factsKept: 0, factsTotal: 0 } as BenchRow);
  return [head, "-".repeat(head.length), ...rows.slice(0, 30).map(line), "-".repeat(head.length), line(t)].join("\n");
}
void estimateTokens;
