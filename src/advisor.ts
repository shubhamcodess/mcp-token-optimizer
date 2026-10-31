import { isExpandRow, isToolsListRow, toolDefinitionCosts, type AuditRow } from "./audit.js";

export interface Advice {
  /** Stable id (`rule:tool`), so the dashboard can apply exactly the recommendation it showed. */
  id: string;
  severity: "warn" | "info";
  tool: string;
  title: string;
  /** The measurements behind the recommendation. */
  numbers: Record<string, number | string>;
  /** Config change that implements it. Advisory: nothing is applied unless the user asks. */
  apply?: { key: string; value: string; label: string };
}

const MIN_CALLS = 4;
const q = (tool: string) => `tools."${tool}"`;

/**
 * Deterministic recommendations from the audit log (sizes only). Advisory only in 0.2.0: each item shows the numbers
 * it is based on and, where there is one, the exact config change to make.
 */
export function buildAdvice(rows: AuditRow[]): Advice[] {
  const calls = new Map<string, AuditRow[]>();
  const expands = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (isToolsListRow(r) || r.mode !== "active") continue;
    if (isExpandRow(r)) {
      if (r.expandOf) expands.set(`${r.server}.${r.expandOf}`, [...(expands.get(`${r.server}.${r.expandOf}`) ?? []), r]);
      continue;
    }
    calls.set(`${r.server}.${r.tool}`, [...(calls.get(`${r.server}.${r.tool}`) ?? []), r]);
  }

  const out: Advice[] = [];
  for (const [tool, rs] of calls) {
    if (rs.length < MIN_CALLS) continue;
    const ex = expands.get(tool) ?? [];
    const tokensIn = rs.reduce((a, r) => a + r.tokensIn, 0);
    const tokensOut = rs.reduce((a, r) => a + r.tokensOut, 0);
    const expandTokens = ex.reduce((a, r) => a + r.tokensOut, 0);
    const net = tokensIn - tokensOut - expandTokens;
    const rate = ex.length / rs.length;
    const nums = { calls: rs.length, expands: ex.length, expandRatePct: Math.round(rate * 100), tokensSaved: tokensIn - tokensOut, expandTokens, netSaved: net };

    if (net < 0) {
      out.push({ id: `negative-net:${tool}`, severity: "warn", tool, title: `Net saving is negative: ${expandTokens.toLocaleString()} tokens were pulled back through mto_expand, more than the ${(tokensIn - tokensOut).toLocaleString()} saved`, numbers: nums, apply: { key: `${q(tool)}.mode`, value: "shadow", label: "Stop optimizing this tool (measure only)" } });
    } else if (ex.length >= 2 && rate >= 0.5) {
      out.push({ id: `high-expand:${tool}`, severity: "warn", tool, title: `The agent expanded ${ex.length} of ${rs.length} calls: pruning is too aggressive for this tool`, numbers: nums, apply: { key: `${q(tool)}.profile`, value: "conservative", label: "Use the conservative profile for this tool" } });
    }

    const summarized = rs.filter((r) => r.stages.some((s) => s.startsWith("summarize")));
    const slow = summarized.length >= 2 ? summarized.reduce((a, r) => a + r.latencyMs, 0) / summarized.length : 0;
    if (slow > 5000) {
      out.push({ id: `slow-summarize:${tool}`, severity: "info", tool, title: `Summarization takes ${(slow / 1000).toFixed(1)}s on average for this tool`, numbers: { summarizedCalls: summarized.length, avgLatencyMs: Math.round(slow) }, apply: { key: `${q(tool)}.summarize`, value: "false", label: "Skip the local model for this tool" } });
    }
  }

  for (const d of toolDefinitionCosts(rows)) {
    if (d.tokens >= 3000) out.push({ id: `tool-definitions:${d.server}`, severity: "info", tool: d.server, title: `Tool definitions cost ${d.tokens.toLocaleString()} tokens every session (not modified by mto)`, numbers: { tokens: d.tokens } });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === "warn" ? -1 : 1));
}
