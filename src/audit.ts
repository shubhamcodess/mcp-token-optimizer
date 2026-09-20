import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "./config.js";

export interface AuditRow {
  ts: string;
  server: string;
  tool: string;
  client?: string;
  mode: "active" | "shadow";
  tokensIn: number;
  tokensOut: number;
  stages: string[];
  lossy: boolean;
  redactions: Record<string, number>;
  latencyMs: number;
}

/** Append-only JSONL audit log. Never records tool content, only sizes and decisions. */
export class Audit {
  constructor(private cfg: Config["audit"]) {
    if (cfg.enabled) mkdirSync(dirname(cfg.path), { recursive: true });
  }
  write(row: AuditRow): void {
    if (!this.cfg.enabled) return;
    try {
      appendFileSync(this.cfg.path, JSON.stringify(row) + "\n");
    } catch {
      /* auditing must never break the agent */
    }
  }
}

export function readAudit(path: string, sinceMs = 0): AuditRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const r = JSON.parse(l) as AuditRow;
        return Date.parse(r.ts) >= sinceMs ? [r] : [];
      } catch {
        return [];
      }
    });
}

export function formatReport(rows: AuditRow[], pricePerMTok: number): string {
  if (!rows.length) return "No data yet. Route an agent through `mto wrap` first (see `mto init`).";
  const agg = (rs: AuditRow[]) => ({
    calls: rs.length,
    inT: rs.reduce((a, r) => a + r.tokensIn, 0),
    outT: rs.reduce((a, r) => a + (r.mode === "shadow" ? r.tokensOut : r.tokensOut), 0),
    lossy: rs.filter((r) => r.lossy).length,
    lat: rs.reduce((a, r) => a + r.latencyMs, 0) / rs.length,
  });
  const line = (name: string, a: ReturnType<typeof agg>) =>
    `${name.padEnd(34)} ${String(a.calls).padStart(6)} ${String(a.inT).padStart(10)} ${String(a.outT).padStart(10)} ${(a.inT ? (100 * (a.inT - a.outT)) / a.inT : 0).toFixed(1).padStart(6)}% ${String(a.lossy).padStart(6)} ${a.lat.toFixed(0).padStart(6)}ms`;
  const head = `${"server.tool".padEnd(34)} ${"calls".padStart(6)} ${"tokens_in".padStart(10)} ${"tokens_out".padStart(10)} ${"saved".padStart(7)} ${"lossy".padStart(6)} ${"avg".padStart(8)}`;
  const groups = new Map<string, AuditRow[]>();
  for (const r of rows) groups.set(`${r.server}.${r.tool}`, [...(groups.get(`${r.server}.${r.tool}`) ?? []), r]);
  const sorted = [...groups].sort((a, b) => agg(b[1]).inT - agg(b[1]).outT - (agg(a[1]).inT - agg(a[1]).outT));
  const total = agg(rows);
  const saved = total.inT - total.outT;
  const secrets: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.redactions ?? {})) secrets[k] = (secrets[k] ?? 0) + n;
  const expands = rows.filter((r) => r.tool === "mto_expand");
  const shadow = rows.some((r) => r.mode === "shadow");
  return [
    head,
    "-".repeat(head.length),
    ...sorted.slice(0, 25).map(([k, rs]) => line(k, agg(rs))),
    "-".repeat(head.length),
    line("TOTAL", total),
    "",
    `${shadow ? "Projected" : "Saved"}: ${saved.toLocaleString()} tokens (~$${((saved / 1e6) * pricePerMTok).toFixed(2)} at $${pricePerMTok}/MTok input).`,
    expands.length ? `mto_expand: agent asked for originals ${expands.length}x (${expands.filter((r) => r.stages[0] === "expand-miss").length} misses) across ${rows.length - expands.length} optimized calls.` : "",
    Object.keys(secrets).length ? `Secrets seen in tool output: ${Object.entries(secrets).map(([k, n]) => `${k}×${n}`).join(", ")} (see redaction.mode).` : "",
    shadow ? "Includes shadow-mode rows: those responses were measured but forwarded unchanged." : "",
  ].join("\n");
}
