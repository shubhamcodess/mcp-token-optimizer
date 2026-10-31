import { isExpandRow, isToolsListRow, toolDefinitionCosts, type AuditRow } from "./audit.js";

export interface DayPoint {
  day: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface Overview {
  totals: { calls: number; tokensIn: number; tokensOut: number; saved: number; savedPct: number };
  /** Last 7 days (oldest first, today last), zero-filled. UTC dates. */
  daily: DayPoint[];
  topTools: Array<{ tool: string; calls: number; tokensIn: number; tokensOut: number; saved: number }>;
  expand: { calls: number; misses: number; rate: number };
  /** Tokens the agent spends on tool definitions per session (latest tools/list per server). Measured, never modified. */
  toolDefinitions: Array<{ server: string; tokens: number; client?: string }>;
}


/** Dashboard numbers from audit rows (sizes only). Shadow rows count as projected savings only in `totals.shadow*`-free form: they are excluded. */
export function buildOverview(rows: AuditRow[], now = Date.now()): Overview {
  const real = rows.filter((r) => r.mode === "active" && !isExpandRow(r) && !isToolsListRow(r));
  const expands = rows.filter(isExpandRow);
  const days: DayPoint[] = Array.from({ length: 7 }, (_, i) => ({ day: new Date(now - (6 - i) * 864e5).toISOString().slice(0, 10), calls: 0, tokensIn: 0, tokensOut: 0 }));
  for (const r of real) {
    const d = days.find((x) => x.day === r.ts.slice(0, 10));
    if (d) (d.calls++, (d.tokensIn += r.tokensIn), (d.tokensOut += r.tokensOut));
  }
  const tools = new Map<string, { tool: string; calls: number; tokensIn: number; tokensOut: number; saved: number }>();
  for (const r of real) {
    const key = `${r.server}.${r.tool}`;
    const t = tools.get(key) ?? { tool: key, calls: 0, tokensIn: 0, tokensOut: 0, saved: 0 };
    t.calls++;
    t.tokensIn += r.tokensIn;
    t.tokensOut += r.tokensOut;
    t.saved = t.tokensIn - t.tokensOut;
    tools.set(key, t);
  }
  const tokensIn = real.reduce((a, r) => a + r.tokensIn, 0);
  const tokensOut = real.reduce((a, r) => a + r.tokensOut, 0);
  const optimized = real.filter((r) => r.stages.length > 0).length;
  const misses = expands.filter((r) => r.stages.includes("expand-miss")).length;
  return {
    totals: { calls: real.length, tokensIn, tokensOut, saved: tokensIn - tokensOut, savedPct: tokensIn ? Math.round(((tokensIn - tokensOut) / tokensIn) * 1000) / 10 : 0 },
    daily: days,
    topTools: [...tools.values()].sort((a, b) => b.saved - a.saved).slice(0, 5),
    toolDefinitions: toolDefinitionCosts(rows),
    expand: { calls: expands.length, misses, rate: optimized ? Math.round((expands.length / optimized) * 1000) / 10 : 0 },
  };
}
