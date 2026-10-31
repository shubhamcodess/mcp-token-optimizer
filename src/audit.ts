import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  /** Client profile (config glob) that applied to this call, if any. */
  profile?: string;
  /** For `mto_expand` rows: the tool whose result the agent was expanding. */
  expandOf?: string;
  /** An `mto_expand` note/id was issued with this result. */
  noted?: boolean;
}

export const isExpandRow = (r: Pick<AuditRow, "stages">): boolean => r.stages.some((s) => s.startsWith("expand"));
/** `tools/list` size records (measurement only) are not tool calls. */
export const isToolsListRow = (r: Pick<AuditRow, "stages">): boolean => r.stages.includes("tools-list");

export interface DailyRollup {
  day: string;
  server: string;
  tool: string;
  mode: "active" | "shadow";
  calls: number;
  tokensIn: number;
  tokensOut: number;
  lossy: number;
  expands: number;
}

export const rollupPath = (auditPath: string): string => auditPath.replace(/\.jsonl$/, "") + "-daily.jsonl";

export function readRollups(auditPath: string): DailyRollup[] {
  const f = rollupPath(auditPath);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as DailyRollup];
    } catch {
      return [];
    }
  });
}

const parseRows = (text: string): Array<{ row: AuditRow; line: string }> =>
  text.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [{ row: JSON.parse(line) as AuditRow, line }];
    } catch {
      return [];
    }
  });

/**
 * Keep stats.jsonl bounded. Over `maxMb`, rows older than 7 days (or the older half, if everything is recent) are
 * folded into per-day rollups in stats-daily.jsonl, and only the rest stays. Safe with several writers: the file is
 * renamed away first (atomic), so writers that append meanwhile land in a fresh file; a second rotator simply loses the rename.
 */
export function rotateAudit(cfg: Pick<Config["audit"], "path" | "maxMb" | "keepDays">, now = Date.now()): { rotated: boolean; rolledUp: number } {
  try {
    if (!existsSync(cfg.path) || statSync(cfg.path).size <= cfg.maxMb * 1024 * 1024) return { rotated: false, rolledUp: 0 };
    const tmp = `${cfg.path}.rotating`;
    renameSync(cfg.path, tmp);
    const all = parseRows(readFileSync(tmp, "utf8"));
    const cutoff = now - 7 * 864e5;
    let old = all.filter((x) => Date.parse(x.row.ts) < cutoff);
    if (old.length === 0) old = all.slice(0, Math.floor(all.length / 2));
    const oldSet = new Set(old);
    const merged = new Map<string, DailyRollup>();
    const key = (r: Pick<DailyRollup, "day" | "server" | "tool" | "mode">) => `${r.day}|${r.server}|${r.tool}|${r.mode}`;
    for (const r of readRollups(cfg.path)) merged.set(key(r), r);
    for (const { row } of old) {
      if (isToolsListRow(row)) continue;
      const d: DailyRollup = { day: row.ts.slice(0, 10), server: row.server, tool: row.tool, mode: row.mode, calls: 0, tokensIn: 0, tokensOut: 0, lossy: 0, expands: 0 };
      const cur = merged.get(key(d)) ?? d;
      if (row.stages.some((x) => x.startsWith("expand"))) cur.expands++;
      else (cur.calls++, (cur.tokensIn += row.tokensIn), (cur.tokensOut += row.tokensOut), (cur.lossy += row.lossy ? 1 : 0));
      merged.set(key(d), cur);
    }
    const oldestDay = new Date(now - cfg.keepDays * 864e5).toISOString().slice(0, 10);
    const keep = [...merged.values()].filter((r) => r.day >= oldestDay).sort((a, b) => a.day.localeCompare(b.day));
    const out = rollupPath(cfg.path);
    writeFileSync(out + ".tmp", keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
    renameSync(out + ".tmp", out);
    const recent = all.filter((x) => !oldSet.has(x));
    if (recent.length) appendFileSync(cfg.path, recent.map((x) => x.line).join("\n") + "\n");
    rmSync(tmp, { force: true });
    return { rotated: true, rolledUp: old.length };
  } catch {
    return { rotated: false, rolledUp: 0 };
  }
}

export interface DayStat {
  day: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/** Per-day totals (active mode, expand calls excluded) from rollups plus whatever raw rows are still in the log. */
export function dailyStats(rows: AuditRow[], rollups: DailyRollup[], sinceMs = 0): DayStat[] {
  const days = new Map<string, DayStat>();
  const add = (day: string, calls: number, inT: number, outT: number) => {
    const d = days.get(day) ?? { day, calls: 0, tokensIn: 0, tokensOut: 0 };
    (d.calls += calls), (d.tokensIn += inT), (d.tokensOut += outT);
    days.set(day, d);
  };
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  for (const r of rollups) if (r.mode === "active" && r.day >= since) add(r.day, r.calls, r.tokensIn, r.tokensOut);
  for (const r of rows) if (r.mode === "active" && !isExpandRow(r) && !isToolsListRow(r) && Date.parse(r.ts) >= sinceMs) add(r.ts.slice(0, 10), 1, r.tokensIn, r.tokensOut);
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Append-only JSONL audit log. Never records tool content, only sizes and decisions. */
export class Audit {
  private listeners: Array<(row: AuditRow) => void> = [];
  private writes = 0;
  constructor(private cfg: Config["audit"]) {
    if (cfg.enabled) {
      mkdirSync(dirname(cfg.path), { recursive: true });
      rotateAudit(cfg);
    }
  }
  /** Subscribe to rows as they are written (the daemon's live feed). Listeners must never throw into the caller. */
  onWrite(fn: (row: AuditRow) => void): void {
    this.listeners.push(fn);
  }
  write(row: AuditRow): void {
    if (!this.cfg.enabled) return;
    try {
      appendFileSync(this.cfg.path, JSON.stringify(row) + "\n");
      if (++this.writes % 500 === 0) rotateAudit(this.cfg);
    } catch {
      /* auditing must never break the agent */
    }
    for (const fn of this.listeners) {
      try {
        fn(row);
      } catch {
        /* same */
      }
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

export function formatReport(allRows: AuditRow[], pricePerMTok: number): string {
  const rows = allRows.filter((r) => !isToolsListRow(r));
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
    ...toolDefLines(allRows),
    expands.length ? `mto_expand: agent asked for originals ${expands.length}x (${expands.filter((r) => r.stages[0] === "expand-miss").length} misses) across ${rows.length - expands.length} optimized calls.` : "",
    Object.keys(secrets).length ? `Secrets seen in tool output: ${Object.entries(secrets).map(([k, n]) => `${k}×${n}`).join(", ")} (see redaction.mode).` : "",
    shadow ? "Includes shadow-mode rows: those responses were measured but forwarded unchanged." : "",
    "",
    "Token counts are estimates (model-agnostic): reliable for relative savings, not billing-exact.",
  ].join("\n");
}

/** Latest `tools/list` size per server (tokens the agent pays for tool definitions each session). */
export function toolDefinitionCosts(rows: AuditRow[]): Array<{ server: string; tokens: number; client?: string }> {
  const latest = new Map<string, AuditRow>();
  for (const r of rows) if (isToolsListRow(r)) latest.set(r.server, r);
  return [...latest.values()].map((r) => ({ server: r.server, tokens: r.tokensIn, client: r.client })).sort((a, b) => b.tokens - a.tokens);
}

const toolDefLines = (rows: AuditRow[]): string[] => {
  const c = toolDefinitionCosts(rows);
  return c.length ? ["", "Tool definitions (tools/list, tokens per session, not modified): " + c.map((x) => `${x.server} ${x.tokens.toLocaleString()}`).join(", ")] : [];
};
