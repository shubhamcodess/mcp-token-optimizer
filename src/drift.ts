import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME_DIR } from "./config.js";
import { discover, planOrApply, type AgentTarget } from "./installer.js";

export const DRIFT_BASELINE = join(HOME_DIR, "drift-baseline.json");

export interface Finding {
  /** `kind:agent|server` */
  id: string;
  kind: "new-unwrapped" | "wrapper-removed" | "dead-proxy";
  agent: string;
  file: string;
  server: string;
  message: string;
}

interface Baseline {
  servers: Record<string, { wrapped: boolean }>;
}

const readBaseline = (file: string): Baseline | undefined => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Baseline) : undefined;
  } catch {
    return undefined;
  }
};
const writeBaseline = (file: string, b: Baseline) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(b, null, 2) + "\n", { mode: 0o600 });
};

/**
 * Compare the agents' MCP configs with what we last saw. Read-only on the agent configs: it only ever writes its own
 * baseline file. The first run records everything currently present as accepted (no findings).
 *  - new-unwrapped: a server appeared since the baseline and is not behind mto
 *  - wrapper-removed: a server we saw wrapped is plain again (e.g. an agent update rewrote its config)
 *  - dead-proxy: servers are routed through the local proxy but the daemon is not running
 */
export function checkDrift(opts: { targets: AgentTarget[]; baselineFile?: string; daemonUp: boolean }): Finding[] {
  const file = opts.baselineFile ?? DRIFT_BASELINE;
  const inv = discover(opts.targets).found.flatMap((d) => d.servers.filter((s) => s.kind === "stdio" || s.kind === "http").map((s) => ({ ...s, agent: d.agent, file: d.file, key: `${d.agent}|${s.name}` })));
  const base = readBaseline(file);
  const findings: Finding[] = [];
  const next: Baseline = { servers: { ...(base?.servers ?? {}) } };

  if (!base) for (const s of inv) next.servers[s.key] = { wrapped: s.wrapped };
  else
    for (const s of inv) {
      const seen = base.servers[s.key];
      if (!seen && !s.wrapped) findings.push({ id: `new-unwrapped:${s.key}`, kind: "new-unwrapped", agent: s.agent, file: s.file, server: s.name, message: `New ${s.kind} server "${s.name}" in ${s.agent} is not behind mto` });
      else if (seen?.wrapped && !s.wrapped) findings.push({ id: `wrapper-removed:${s.key}`, kind: "wrapper-removed", agent: s.agent, file: s.file, server: s.name, message: `"${s.name}" in ${s.agent} was wrapped before and is plain now` });
      if (s.wrapped && !seen?.wrapped) next.servers[s.key] = { wrapped: true };
    }

  if (!opts.daemonUp) {
    const routed = inv.filter((s) => s.kind === "http" && s.wrapped);
    for (const s of routed) findings.push({ id: `dead-proxy:${s.key}`, kind: "dead-proxy", agent: s.agent, file: s.file, server: s.name, message: `"${s.name}" in ${s.agent} points at the local proxy, but mto serve is not running` });
  }
  if (JSON.stringify(next) !== JSON.stringify(base)) writeBaseline(file, next);
  return findings;
}

/** Accept the current state: everything present now stops being reported. */
export function acceptDrift(targets: AgentTarget[], baselineFile = DRIFT_BASELINE): number {
  const inv = discover(targets).found.flatMap((d) => d.servers.filter((s) => s.kind === "stdio" || s.kind === "http").map((s) => ({ key: `${d.agent}|${s.name}`, wrapped: s.wrapped })));
  writeBaseline(baselineFile, { servers: Object.fromEntries(inv.map((s) => [s.key, { wrapped: s.wrapped }])) });
  return inv.length;
}

/** Wrap one named server. Called only on an explicit user action (dashboard button or CLI), or by the opt-in autoWrap policy. */
export function wrapServer(server: string, targets: AgentTarget[], cliPath: string) {
  return planOrApply({ mode: "wrap", apply: true, cliPath, only: [server], targets });
}
