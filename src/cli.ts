#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import { formatReport, readAudit } from "./audit.js";
import { defaultConfig, HOME_DIR, loadConfig } from "./config.js";
import { formatBench, runBench } from "./bench.js";
import { formatCompare } from "./compare.js";
import { CAPTURE_DIR, captureEnabled, readCaptures, setCapture } from "./capture.js";
import { startHttpProxy } from "./http.js";
import { DEFAULT_PORT, ROUTES_FILE, loadRoutes } from "./routes.js";
import { agentTargets, discover, parseTargetSpec, planOrApply, scanForConfigs, expandPath, type AgentTarget } from "./installer.js";
import { ollamaHealth } from "./llm.js";
import { createRuntime } from "./runtime.js";
import { runStdioWrapper } from "./stdio.js";

const HELP = `mto - MCP Token Optimizer

Usage:
  mto discover [--scan dir] [--file path[#keyPath]] [--no-builtin]  List every MCP config + server found (read-only)
  mto init [--apply] [--only a,b] [--file f] [--scan d] [--skip agent] [--no-builtin]   Wrap every stdio MCP server found in your agents' configs
  mto uninstall [--apply]                           Restore the original server commands
  mto wrap [--name n] [--config f] -- <cmd> [args]  Run one MCP server through the optimizer (what init installs)
  mto try <file|-> [--tool name] [--server name]    Optimize a saved tool response and show before/after
  mto serve [--port 8787] [--config f]              Run the local HTTP proxy that init points remote (URL) MCP servers at
  mto capture on|off|status                         Record raw (secret-redacted) tool results locally, live, no restart
  mto bench [dir] [--llm] [--models a,b] [--dump f] Replay captures: savings, latency, fact retention (per model with --models)
  mto compare [--tool glob] [--last N]              Original vs what the agent received (needs capture + active mode)
  mto stats [--since 7d] [--json]                   Token savings report from the audit log
  mto doctor [--config f]                           Check config, Ollama and model availability
  mto config init                                   Write a commented default config to ${join(HOME_DIR, "config.yaml")}

init/uninstall are dry-runs unless --apply is given. Configs are backed up as <file>.mto.bak.`;

function flagAll(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
}

/**
 * Which MCP config files to consider: built-in agent locations (minus --skip / discovery.skip), config
 * `discovery.files`, $MTO_MCP_FILES (path-list), --file path[#keyPath], and directories from --scan / discovery.scanDirs.
 */
function resolveTargets(rest: string[]): AgentTarget[] {
  const cfg = loadConfig(flag(rest, "--config")).config.discovery;
  // --skip may be repeated and/or comma separated
  const skip = [...cfg.skip, ...flagAll(rest, "--skip").flatMap((v) => v.split(","))].map((x) => x.trim().toLowerCase()).filter(Boolean);
  // --no-builtin (or discovery.builtin: false): ONLY the files you name via --file/--scan/config. Use it when testing.
  const useBuiltin = cfg.builtin && !rest.includes("--no-builtin");
  const targets = useBuiltin ? agentTargets().filter((t) => !skip.some((k) => t.agent.toLowerCase().includes(k))) : [];
  const known = new Set(agentTargets().map((t) => t.file));
  const specs = [...cfg.files, ...(process.env.MTO_MCP_FILES?.split(delimiter).filter(Boolean) ?? []), ...flagAll(rest, "--file")];
  for (const sp of specs) targets.push(parseTargetSpec(sp));
  for (const dir of [...cfg.scanDirs, ...flagAll(rest, "--scan")]) {
    for (const f of scanForConfigs(expandPath(dir))) if (!(useBuiltin && known.has(f)) && !specs.some((sp) => expandPath(sp.split("#")[0]) === f)) (known.add(f), targets.push({ agent: `scanned: ${f.replace(process.env.HOME ?? "", "~")}`, file: f, keyPath: "auto" }));
  }
  return targets;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const cliPath = fileURLToPath(import.meta.url);

  switch (cmd) {
    case "wrap": {
      const sep = rest.indexOf("--");
      if (sep < 0 || sep === rest.length - 1) {
        process.stderr.write("usage: mto wrap [--name n] [--config f] -- <command> [args...]\n");
        return 2;
      }
      const opts = rest.slice(0, sep);
      const [command, ...args] = rest.slice(sep + 1);
      const rt = createRuntime(flag(opts, "--config"));
      return runStdioWrapper(rt, flag(opts, "--name") ?? command, command, args);
    }

    case "discover": {
      const { found, unparsable, missing } = discover(resolveTargets(rest));
      for (const d of found) {
        console.log(`\n${d.agent}\n  ${d.file}  [${d.keyPath}]`);
        for (const sv of d.servers) console.log(`    ${sv.wrapped ? "✓ wrapped " : "· plain   "} ${sv.kind.padEnd(5)} ${sv.name}`);
      }
      for (const u of unparsable) console.log(`\n⚠ unparsable: ${u.file} (${u.agent})`);
      console.log(`\n${found.reduce((a, d) => a + d.servers.length, 0)} server(s) in ${found.length} list(s); ${missing.length} known location(s) not present.`);
      if (!found.length) console.log("Nothing found. Point me at yours: mto discover --file ~/path/to/mcp.json   or   --scan ~/some/dir");
      return 0;
    }

    case "init":
    case "uninstall": {
      const apply = rest.includes("--apply");
      const changes = planOrApply({
        mode: cmd === "init" ? "wrap" : "unwrap",
        apply,
        cliPath,
        targets: resolveTargets(rest),
        configPath: flag(rest, "--config"),
        only: flag(rest, "--only")?.split(","),
      });
      if (!changes.length) {
        console.log("No MCP servers found in known agent configs (Claude Code, Claude Desktop, Copilot/VS Code, Cursor, Windsurf).");
        return 0;
      }
      for (const c of changes) console.log(`${c.action.padEnd(13)} ${c.server.padEnd(24)} ${c.agent}  (${c.file})${c.detail ? "  " + c.detail : ""}`);
      if (changes.some((c) => c.action === "unparsable")) console.log("\nFiles marked 'unparsable' were left untouched: fix their syntax and re-run.");
      const skipped = changes.filter((c) => c.action === "skip-remote").length;
      if (skipped) console.log(`\n${skipped} server(s) skipped (legacy "sse" transport or unrecognized entry).`);
      if (changes.some((c) => c.action === "wrap-http")) console.log(`\nHTTP servers are routed through a local proxy: keep \`mto serve\` running (default port ${DEFAULT_PORT}) or those servers will be unreachable.`);
      console.log(apply ? "\nApplied. Restart your agent(s) to pick up the change." : "\nDry run. Re-run with --apply to write changes.");
      return 0;
    }

    case "try": {
      const src = rest.find((a) => !a.startsWith("--") && a !== flag(rest, "--tool") && a !== flag(rest, "--server") && a !== flag(rest, "--config"));
      if (!src) return (console.error("usage: mto try <file|->"), 2);
      const raw = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
      const rt = createRuntime(flag(rest, "--config"));
      // Accept a bare payload or a full MCP result object.
      let result: any;
      try {
        const j = JSON.parse(raw);
        result = j && Array.isArray(j.content) ? j : { content: [{ type: "text", text: raw }] };
      } catch {
        result = { content: [{ type: "text", text: raw }] };
      }
      await rt.warm();
      const { result: out, report } = await rt.pipeline.optimizeResult(result, { server: flag(rest, "--server") ?? "demo", tool: flag(rest, "--tool") ?? "demo" });
      console.log(out.content?.map((c: any) => c.text ?? `[${c.type}]`).join("\n---\n"));
      console.error(`\n── tokens ${report.tokensIn} → ${report.tokensOut} (${report.tokensIn ? (100 * (1 - report.tokensOut / report.tokensIn)).toFixed(1) : 0}% saved) · stages: ${report.stages.join(", ") || "none"} · lossy: ${report.lossy} · ${report.latencyMs}ms`);
      return 0;
    }

    case "serve": {
      const rt = createRuntime(flag(rest, "--config"));
      const port = Number(flag(rest, "--port") ?? DEFAULT_PORT);
      void rt.warm();
      const srv = await startHttpProxy(rt, { port });
      const routes = Object.entries(loadRoutes());
      console.error(`[mto] http proxy on http://127.0.0.1:${port}  (${routes.length} route(s) from ${ROUTES_FILE})`);
      for (const [n, r] of routes) console.error(`  /${n} -> ${new URL(r.url).origin}${new URL(r.url).pathname}`);
      return new Promise<number>((resolve) => srv.on("close", () => resolve(0)));
    }

    case "capture": {
      if (rest[0] === "on" || rest[0] === "off") setCapture(rest[0] === "on");
      console.log(`capture is ${captureEnabled() ? "ON" : "OFF"} · ${readCaptures().length} samples in ${CAPTURE_DIR}`);
      return 0;
    }

    case "bench": {
      const dir = rest.find((a, i) => !a.startsWith("--") && !["--models", "--dump", "--config", "--cap"].includes(rest[i - 1] ?? ""));
      const samples = readCaptures(dir);
      if (!samples.length) return (console.error(`No samples in ${dir ?? CAPTURE_DIR}. Run \`mto capture on\`, use your agent for a while, then re-run.`), 1);
      const { config } = createRuntime(flag(rest, "--config"));
      const models = flag(rest, "--models")?.split(",");
      const cap = flag(rest, "--cap") ? Number(flag(rest, "--cap")) : undefined;
      const runs = models ?? [config.llm.model];
      for (const m of runs) {
        const cfg = { ...config, llm: { ...config.llm, model: m } };
        console.log(`\n=== ${rest.includes("--llm") || models ? `model ${m}` : "deterministic only (no LLM)"} · ${samples.length} samples ===`);
        console.log(formatBench(await runBench(samples, cfg, { llm: rest.includes("--llm") || !!models, dump: flag(rest, "--dump") && `${flag(rest, "--dump")}${models ? "." + m.replace(/[^\w.-]/g, "_") : ""}.md`, sampleCap: cap })));
        if (!models && !rest.includes("--llm")) break;
      }
      return 0;
    }

    case "compare": {
      const g = flag(rest, "--tool");
      const re = g ? new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i") : undefined;
      let samples = readCaptures().filter((x) => x.optimized && (!re || re.test(`${x.server}.${x.tool}`)));
      if (flag(rest, "--last")) samples = samples.slice(-Number(flag(rest, "--last")));
      if (!samples.length) return (console.error("No paired samples yet: they are recorded only in active mode with `mto capture on`."), 1);
      console.log(formatCompare(samples));
      return 0;
    }

    case "stats": {
      const rt = createRuntime(flag(rest, "--config"));
      const since = flag(rest, "--since");
      const m = since && /^(\d+)([hd])$/.exec(since);
      const sinceMs = m ? Date.now() - Number(m[1]) * (m[2] === "h" ? 3.6e6 : 8.64e7) : 0;
      const rows = readAudit(rt.config.audit.path, sinceMs);
      console.log(rest.includes("--json") ? JSON.stringify(rows) : formatReport(rows, rt.config.audit.pricePerMTokUsd));
      return 0;
    }

    case "doctor": {
      let rt;
      try {
        rt = createRuntime(flag(rest, "--config"));
      } catch (e) {
        console.error(`✗ ${(e as Error).message}`);
        return 1;
      }
      const c = rt.config;
      console.log(`✓ config: ${rt.configPath ?? "(defaults, no config file found)"}`);
      console.log(`  mode=${c.mode} profile=${c.profile} redaction=${c.redaction.mode} retrieval=${c.retrieval.enabled}`);
      const h = await ollamaHealth(c.llm);
      if (!h.ok) console.log(`✗ ollama unreachable at ${c.llm.baseUrl} (${h.error}). Summarization will be skipped; pruning + TOON still work.`);
      else if (!h.hasModel) console.log(`✗ ollama is up but model "${c.llm.model}" is not pulled. Run: ollama pull ${c.llm.model}\n  available: ${h.models.join(", ") || "(none)"}`);
      else console.log(`✓ ollama ${c.llm.baseUrl} model ${c.llm.model} ready`);
      return 0;
    }

    case "config": {
      if (rest[0] !== "init") return (console.log(HELP), 2);
      const p = join(HOME_DIR, "config.yaml");
      if (existsSync(p)) return (console.error(`${p} already exists`), 1);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `# mcp-token-optimizer config. Every key is optional; shown values are the defaults.\n# See README for per-tool overrides under \`tools:\`.\n${yamlStringify(defaultConfig())}`);
      console.log(`wrote ${p}`);
      return 0;
    }

    case "--version":
      console.log(JSON.parse(readFileSync(join(dirname(cliPath), "..", "package.json"), "utf8")).version);
      return 0;

    default:
      console.log(HELP);
      return cmd && cmd !== "help" && cmd !== "--help" ? 2 : 0;
  }
}

/**
 * Corporate networks often use a private CA that the OS trusts but Node's bundled list doesn't (browsers and curl
 * work, Node fetch fails with SELF_SIGNED_CERT_IN_CHAIN). `mto serve` re-launches itself with --use-system-ca
 * (Node >= 22.15 / 23.8) so upstream TLS is verified against the OS trust store, never disabled.
 */
function needsSystemCaRelaunch(): boolean {
  if (process.argv[2] !== "serve" || process.env.MTO_NO_SYSTEM_CA || process.execArgv.includes("--use-system-ca")) return false;
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 23 || (maj === 23 && min >= 8) || (maj === 22 && min >= 15);
}

if (needsSystemCaRelaunch()) {
  const child = spawn(process.execPath, ["--use-system-ca", ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  child.on("close", (code) => process.exit(code ?? 0));
} else main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[mto] ${(e as Error).message}`);
    process.exit(1);
  },
);

