import { delimiter } from "node:path";
import type { Config } from "./config.js";
import { agentTargets, expandPath, parseTargetSpec, scanForConfigs, type AgentTarget } from "./installer.js";

/**
 * Which MCP config files to consider: built-in agent locations (minus skips), config `discovery.files`,
 * $MTO_MCP_FILES (path-list), explicit files, and directories from `discovery.scanDirs` / scans.
 */
export function resolveTargets(cfg: Config["discovery"], opts: { skip?: string[]; files?: string[]; scan?: string[]; noBuiltin?: boolean } = {}): AgentTarget[] {
  const skip = [...cfg.skip, ...(opts.skip ?? []).flatMap((v) => v.split(","))].map((x) => x.trim().toLowerCase()).filter(Boolean);
  const useBuiltin = cfg.builtin && !opts.noBuiltin;
  const targets = useBuiltin ? agentTargets().filter((t) => !skip.some((k) => t.agent.toLowerCase().includes(k))) : [];
  const known = new Set(agentTargets().map((t) => t.file));
  const specs = [...cfg.files, ...(process.env.MTO_MCP_FILES?.split(delimiter).filter(Boolean) ?? []), ...(opts.files ?? [])];
  for (const sp of specs) targets.push(parseTargetSpec(sp));
  for (const dir of [...cfg.scanDirs, ...(opts.scan ?? [])]) {
    for (const f of scanForConfigs(expandPath(dir))) if (!(useBuiltin && known.has(f)) && !specs.some((sp) => expandPath(sp.split("#")[0]) === f)) (known.add(f), targets.push({ agent: `scanned: ${f.replace(process.env.HOME ?? "", "~")}`, file: f, keyPath: "auto" }));
  }
  return targets;
}
