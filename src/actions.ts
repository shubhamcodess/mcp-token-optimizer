import { CAPTURE_DIR, deleteCaptures, readCaptures } from "./capture.js";
import { checkFidelity, exampleSamples, runEval } from "./eval.js";
import { saveRun } from "./evalHistory.js";
import { applyConnection, listConnections, previewConnection, restoreBackup } from "./connections.js";
import { previewRaw, saveRaw } from "./configForm.js";
import { ruleKeyFor } from "./tools.js";
import { checkDrift, wrapServer } from "./drift.js";
import { readAudit } from "./audit.js";
import { buildAdvice } from "./advisor.js";
import { captureEnabled, setCapture } from "./capture.js";
import { configPath, setConfigValue, unsetConfigValue } from "./configEdit.js";
import { ConfigSchema } from "./config.js";
import { runDoctor } from "./doctor.js";
import { testModel, validModelName } from "./llm.js";
import type { Runtime } from "./runtime.js";

/**
 * The only things the dashboard can make the daemon do. Each action has a fixed name and a strictly validated
 * argument; there is no shell, no free-form command and no path argument anywhere in this table.
 */
export interface ActionSpec {
  name: string;
  description: string;
  /** Human-readable argument shape, e.g. "mode: off|shadow|active". */
  args?: string;
}

export const ACTIONS: ActionSpec[] = [
  { name: "doctor", description: "Check config, Ollama and the selected model" },
  { name: "set-mode", description: "Switch the global mode", args: "mode: off|shadow|active" },
  { name: "capture", description: "Turn local capture of tool results on or off", args: "state: on|off" },
  { name: "apply-advice", description: "Apply one advisor recommendation the dashboard showed", args: "id: advice id" },
  { name: "wrap-server", description: "Put one drifted MCP server behind mto (backs up the config first)", args: "server: name from the drift list" },
  { name: "drift-accept", description: "Accept the current agent configs as the baseline (stop reporting what is there now)" },
  { name: "set-server-mode", description: "Soft-disconnect or reconnect one server (applies instantly)", args: "server, mode: off|shadow|active|default" },
  { name: "plan-connection", description: "Dry-run wrapping or unwrapping one server, with a diff", args: "op: wrap|unwrap, server" },
  { name: "apply-connection", description: "Wrap or unwrap one server in the agent config (backup first)", args: "op: wrap|unwrap, server" },
  { name: "restore-backup", description: "Restore an agent config from its .mto.bak", args: "file: a known agent config" },
  { name: "set-tool-rule", description: "Edit one field of a per-tool rule", args: "tool, field: mode|format|summarize|maxArrayItems|dropKeys|keepKeys|profile, value (null clears)" },
  { name: "config-set", description: "Set one config key (validated)", args: "path, value" },
  { name: "config-reset", description: "Restore a config section to its defaults", args: "section" },
  { name: "config-raw-preview", description: "Validate raw YAML and diff it against the file", args: "yaml" },
  { name: "config-raw-save", description: "Save raw YAML to the config file (validated)", args: "yaml" },
  { name: "eval-run", description: "Replay captures (or the examples) through the current config plus optional candidate settings and save the run", args: "source: captures|examples, profile?, format?, prettyJsonAboveTokens?, label?" },
  { name: "eval-fidelity", description: "Is text the agent produced identical to a captured original (or a JSON path inside it)?", args: "id: capture id, path?, text" },
  { name: "delete-captures", description: "Delete every recorded capture" },
  { name: "model-test", description: "Run the fixed summarization test on a model", args: "model: name (default: active model)" },
];

export type ActionResult = { status: number; body: unknown };

export interface ActionEnv {
  /** Agent config files to consider (daemon passes the configured discovery targets). */
  targets?: () => import("./installer.js").AgentTarget[];
  cliPath?: string;
  baselineFile?: string;
  captureDir?: string;
  evalHistoryFile?: string;
}

export async function runAction(rt: Runtime, name: string, args: Record<string, unknown>, env: ActionEnv = {}): Promise<ActionResult> {
  switch (name) {
    case "doctor":
      return { status: 200, body: await runDoctor(rt.config, rt.configPath) };
    case "set-mode": {
      const mode = args.mode;
      if (mode !== "off" && mode !== "shadow" && mode !== "active") return { status: 400, body: { error: "mode must be off, shadow or active" } };
      const r = setConfigValue(configPath(rt.configPath), "mode", mode);
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.config.mode = mode; // live: sessions in this process read this object
      return { status: 200, body: { ok: true, mode, note: "stdio wrappers pick it up when their agent restarts that server" } };
    }
    case "capture": {
      if (args.state !== "on" && args.state !== "off") return { status: 400, body: { error: "state must be on or off" } };
      setCapture(args.state === "on");
      return { status: 200, body: { ok: true, capture: captureEnabled() } };
    }
    case "apply-advice": {
      // only a recommendation the advisor currently produces can be applied: the client never supplies a key or value
      const adv = buildAdvice(readAudit(rt.config.audit.path, Date.now() - 7 * 864e5)).find((a) => a.id === args.id);
      if (!adv?.apply) return { status: 404, body: { error: "no such recommendation (it may no longer apply)" } };
      const r = setConfigValue(configPath(rt.configPath), adv.apply.key, adv.apply.value);
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.reload();
      return { status: 200, body: { ok: true, applied: adv.apply } };
    }
    case "wrap-server": {
      if (!env.targets || !env.cliPath) return { status: 400, body: { error: "not available here" } };
      // only a server the drift check currently reports can be wrapped
      const targets = env.targets();
      const hit = checkDrift({ targets, daemonUp: true, baselineFile: env.baselineFile }).find((f) => f.server === args.server && f.kind !== "dead-proxy");
      if (!hit) return { status: 404, body: { error: "that server is not in the drift list" } };
      const changes = wrapServer(hit.server, targets, env.cliPath).filter((c) => c.action === "wrap" || c.action === "wrap-http");
      return changes.length ? { status: 200, body: { ok: true, changes } } : { status: 400, body: { error: "nothing could be wrapped (remote sse server or unparsable file)" } };
    }
    case "eval-run": {
      const source = args.source === "examples" ? "examples" : args.source === "captures" ? "captures" : null;
      if (!source) return { status: 400, body: { error: "source must be captures or examples" } };
      const candidate: { profile?: string; format?: string; prettyJsonAboveTokens?: number } = {};
      const cfg = structuredClone(rt.config);
      if (args.profile !== undefined && args.profile !== "") {
        if (!["conservative", "balanced", "aggressive"].includes(String(args.profile))) return { status: 400, body: { error: "invalid profile" } };
        candidate.profile = cfg.profile = args.profile as typeof cfg.profile;
      }
      if (args.format !== undefined && args.format !== "") {
        if (!["auto", "json", "json-pretty", "toon"].includes(String(args.format))) return { status: 400, body: { error: "invalid format" } };
        candidate.format = cfg.format.default = args.format as typeof cfg.format.default;
      }
      if (args.prettyJsonAboveTokens !== undefined && args.prettyJsonAboveTokens !== "") {
        const n = Number(args.prettyJsonAboveTokens);
        if (!Number.isInteger(n) || n < 0) return { status: 400, body: { error: "prettyJsonAboveTokens must be a non-negative integer" } };
        candidate.prettyJsonAboveTokens = cfg.format.prettyJsonAboveTokens = n;
      }
      let samples;
      try {
        samples = source === "examples" ? exampleSamples() : readCaptures(env.captureDir ?? CAPTURE_DIR).slice(-300);
      } catch (e) {
        return { status: 400, body: { error: (e as Error).message } };
      }
      if (!samples.length) return { status: 400, body: { error: "no samples: turn capture on and use your agent first, or run the examples" } };
      const result = await runEval(samples, cfg);
      const label = typeof args.label === "string" && args.label.trim() ? args.label.trim().slice(0, 80) : `${source}${Object.keys(candidate).length ? " · candidate" : ""}`;
      return { status: 200, body: saveRun({ label, source, candidate, result }, env.evalHistoryFile) };
    }
    case "eval-fidelity": {
      const sample = readCaptures(env.captureDir ?? CAPTURE_DIR)[Number(args.id)];
      if (!sample) return { status: 404, body: { error: "no such capture" } };
      if (typeof args.text !== "string") return { status: 400, body: { error: "text required" } };
      try {
        return { status: 200, body: checkFidelity(sample, args.text, typeof args.path === "string" && args.path ? args.path : undefined) };
      } catch (e) {
        return { status: 400, body: { error: (e as Error).message } };
      }
    }
    case "delete-captures":
      return { status: 200, body: { ok: true, deleted: deleteCaptures(env.captureDir) } };
    case "set-server-mode":
    case "plan-connection":
    case "apply-connection":
    case "restore-backup": {
      if (!env.targets || !env.cliPath) return { status: 400, body: { error: "not available here" } };
      const targets = env.targets();
      if (name === "restore-backup") {
        const r = restoreBackup(String(args.file ?? ""), targets);
        return r.ok ? { status: 200, body: { ok: true, note: "The current file was kept as .mto.pre-restore. Restart the agent's MCP servers." } } : { status: 400, body: { error: r.error } };
      }
      // the server must exist in an agent config we know about: the client never supplies free-form names
      const server = String(args.server ?? "");
      if (!listConnections(targets, rt.config).files.some((f) => f.servers.some((x) => x.name === server))) return { status: 404, body: { error: "unknown server" } };
      if (name === "set-server-mode") {
        const mode = args.mode;
        if (mode !== "off" && mode !== "shadow" && mode !== "active" && mode !== "default") return { status: 400, body: { error: "mode must be off, shadow, active or default" } };
        const key = `tools."${server}.*".mode`;
        const r = mode === "default" ? unsetConfigValue(configPath(rt.configPath), key) : setConfigValue(configPath(rt.configPath), key, mode);
        if (!r.ok) return { status: 400, body: { error: r.error } };
        rt.reload();
        return { status: 200, body: { ok: true } };
      }
      if (args.op !== "wrap" && args.op !== "unwrap") return { status: 400, body: { error: "op must be wrap or unwrap" } };
      if (name === "plan-connection") return { status: 200, body: previewConnection(args.op, server, targets, env.cliPath) };
      return { status: 200, body: { ok: true, changes: applyConnection(args.op, server, targets, env.cliPath), note: "Restart this server in your agent for it to take effect." } };
    }
    case "set-tool-rule": {
      const tool = String(args.tool ?? "");
      const field = String(args.field ?? "");
      if (!/^[\w.@\-*?/]{1,160}$/.test(tool)) return { status: 400, body: { error: "invalid tool name" } };
      if (!["mode", "format", "summarize", "maxArrayItems", "dropKeys", "keepKeys", "profile"].includes(field)) return { status: 400, body: { error: "unknown rule field" } };
      const key = `tools."${ruleKeyFor(rt.config, tool)}".${field}`;
      const r = args.value === null ? unsetConfigValue(configPath(rt.configPath), key) : setConfigValue(configPath(rt.configPath), key, JSON.stringify(args.value));
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.reload();
      return { status: 200, body: { ok: true, key } };
    }
    case "config-set": {
      const path = String(args.path ?? "");
      if (/^(tools|audit\.path|discovery)(\.|$)/.test(path) || path === "llm.baseUrl" || !/^[\w.]+$/.test(path)) return { status: 400, body: { error: "that key is not editable here (use the raw editor or the config file)" } };
      const r = setConfigValue(configPath(rt.configPath), path, JSON.stringify(args.value));
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.reload();
      return { status: 200, body: { ok: true } };
    }
    case "config-reset": {
      const section = String(args.section ?? "");
      if (!(section in ConfigSchema.shape)) return { status: 400, body: { error: "unknown section" } };
      const r = unsetConfigValue(configPath(rt.configPath), section);
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.reload();
      return { status: 200, body: { ok: true } };
    }
    case "config-raw-preview":
      return { status: 200, body: previewRaw(configPath(rt.configPath), String(args.yaml ?? "")) };
    case "config-raw-save": {
      const r = saveRaw(configPath(rt.configPath), String(args.yaml ?? ""));
      if (!r.ok) return { status: 400, body: { error: r.error } };
      rt.reload();
      return { status: 200, body: { ok: true } };
    }
    case "model-test": {
      const model = args.model ?? rt.config.llm.model;
      if (!validModelName(model)) return { status: 400, body: { error: "invalid model name" } };
      return { status: 200, body: await testModel(rt.config.llm, model) };
    }
    default:
      return { status: 404, body: { error: "unknown action" } };
  }
}
