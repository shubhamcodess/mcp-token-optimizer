import { isExpandRow, isToolsListRow, type AuditRow } from "./audit.js";
import { globToRegex, toolRule, type Config, type ToolRuleT } from "./config.js";

export interface ToolRow {
  tool: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  saved: number;
  lossyPct: number;
  avgLatencyMs: number;
  expands: number;
  /** The config key whose rule applies to this tool (first match wins), if any. Edits go to this key. */
  ruleKey?: string;
  rule: ToolRuleT;
}

/** The `tools:` key a rule edit for `tool` must write to: the first existing glob that matches, else the tool itself. */
export const ruleKeyFor = (cfg: Config, tool: string): string => Object.keys(cfg.tools).find((g) => globToRegex(g).test(tool)) ?? tool;

/** Per-tool table (sizes and decisions only) with the rule currently applied to each tool. */
export function buildToolTable(rows: AuditRow[], cfg: Config): ToolRow[] {
  const by = new Map<string, AuditRow[]>();
  const expands = new Map<string, number>();
  for (const r of rows) {
    if (isToolsListRow(r)) continue;
    if (isExpandRow(r)) {
      if (r.expandOf) expands.set(`${r.server}.${r.expandOf}`, (expands.get(`${r.server}.${r.expandOf}`) ?? 0) + 1);
      continue;
    }
    by.set(`${r.server}.${r.tool}`, [...(by.get(`${r.server}.${r.tool}`) ?? []), r]);
  }
  return [...by]
    .map(([tool, rs]): ToolRow => {
      const tokensIn = rs.reduce((a, r) => a + r.tokensIn, 0);
      const tokensOut = rs.reduce((a, r) => a + r.tokensOut, 0);
      const key = Object.keys(cfg.tools).find((g) => globToRegex(g).test(tool));
      return { tool, calls: rs.length, tokensIn, tokensOut, saved: tokensIn - tokensOut, lossyPct: Math.round((100 * rs.filter((r) => r.lossy).length) / rs.length), avgLatencyMs: Math.round(rs.reduce((a, r) => a + r.latencyMs, 0) / rs.length), expands: expands.get(tool) ?? 0, ruleKey: key, rule: toolRule(cfg, tool) };
    })
    .sort((a, b) => b.saved - a.saved);
}
