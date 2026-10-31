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
import { configPath, formatValue, getConfigValue, setConfigValue } from "./configEdit.js";
import { REPO_URL, commandHelp, docsHelp, helpFor, suggest } from "./help.js";
import { Daemon, packageVersion, readDaemon, removeDaemon, summarize, writeDaemon } from "./daemon.js";
import { callDaemon, ensureDaemon } from "./daemonClient.js";
import { startHttpProxy } from "./http.js";
import { DEFAULT_PORT, ROUTES_FILE, loadRoutes } from "./routes.js";
import { agentTargets, discover, parseTargetSpec, planOrApply, scanForConfigs, expandPath, type AgentTarget } from "./installer.js";
import { ollamaHealth, ollamaModels, pullModel, testModel, validModelName } from "./llm.js";
import { createRuntime } from "./runtime.js";
import { runStdioWrapper } from "./stdio.js";

function openUrl(url: string): void {
  const [bin, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(bin as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => console.error(`[mto] could not open a browser; visit ${url}`)).unref();
}

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
  if (cmd && cmd !== "wrap" && (rest.includes("--help") || rest.includes("-h"))) {
    const h = commandHelp(cmd);
    if (h) return (console.log(h), 0);
  }
  if (cmd === "--help" || cmd === "-h") return (console.log(helpFor().text), 0);
  if (cmd === "-v") return (console.log(packageVersion()), 0);

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
      const existing = readDaemon();
      if (existing) return (console.error(`[mto] already running (pid ${existing.pid}) at http://127.0.0.1:${existing.port}/`), 1);
      const rt = createRuntime(flag(rest, "--config"));
      const port = Number(flag(rest, "--port") ?? rt.config.ui.port ?? DEFAULT_PORT);
      void rt.warm();
      let srv: Awaited<ReturnType<typeof startHttpProxy>>;
      const daemon = new Daemon(rt, { onShutdown: () => srv.close() });
      srv = await startHttpProxy(rt, { port, daemon });
      daemon.port = (srv.address() as { port: number }).port;
      writeDaemon(daemon.info());
      const cleanup = () => removeDaemon(daemon.token);
      process.on("exit", cleanup);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => (cleanup(), srv.close(), process.exit(0)));
      const routes = Object.entries(loadRoutes());
      console.error(`[mto] http proxy on http://127.0.0.1:${daemon.port}  (${routes.length} route(s) from ${ROUTES_FILE})`);
      console.error(`[mto] dashboard: http://127.0.0.1:${daemon.port}/   (open it with \`mto ui\`)`);
      for (const [n, r] of routes) console.error(`  /${n} -> ${new URL(r.url).origin}${new URL(r.url).pathname}`);
      return new Promise<number>((resolve) => srv.on("close", () => resolve(0)));
    }

    case "status": {
      const d = readDaemon();
      const live = d ? await callDaemon(d, "GET", "/api/status") : undefined;
      if (live) {
        const st = await callDaemon(d!, "GET", "/api/stats?since=24h");
        console.log(`daemon: UP  pid ${live.pid}  http://127.0.0.1:${live.port}/  uptime ${live.uptimeSec}s  v${live.version}`);
        console.log(`mode=${live.mode} profile=${live.profile} routes=${live.routes}`);
        console.log(live.proxies.length ? `connected (${live.proxies.length}):` : "connected: none");
        for (const p of live.proxies) console.log(`  ${p.kind.padEnd(5)} ${p.server.padEnd(20)} ${p.client ?? "-"}  ${p.calls} call(s)  pid ${p.pid ?? "-"}`);
        if (st) console.log(`last 24h: ${st.calls} calls, ${st.tokensIn} -> ${st.tokensOut} tokens (${st.savedPct}% saved)`);
        return 0;
      }
      const { config } = createRuntime(flag(rest, "--config"));
      const st = summarize(readAudit(config.audit.path, Date.now() - 8.64e7));
      console.log("daemon: DOWN  (start it with `mto serve` or `mto ui`)");
      console.log(`last 24h (from the audit log): ${st.calls} calls, ${st.tokensIn} -> ${st.tokensOut} tokens (${st.savedPct}% saved)`);
      return 1;
    }

    case "ui": {
      const { config } = createRuntime(flag(rest, "--config"));
      const d = await ensureDaemon(config, { force: true });
      if (!d) return (console.error("[mto] could not start the daemon; run `mto serve` to see why"), 1);
      const url = `http://127.0.0.1:${d.port}/`;
      console.log(url);
      if (!rest.includes("--no-open")) openUrl(url);
      return 0;
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
      const sub = rest[0];
      const explicit = flag(rest, "--config");
      if (sub === "init") {
        const p = join(HOME_DIR, "config.yaml");
        if (existsSync(p)) return (console.error(`${p} already exists`), 1);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, `# mcp-token-optimizer config. Every key is optional; shown values are the defaults.\n# See README for per-tool overrides under \`tools:\`.\n${yamlStringify(defaultConfig())}`);
        console.log(`wrote ${p}`);
        return 0;
      }
      if (sub === "path") return (console.log(configPath(explicit)), 0);
      if (sub === "get") {
        const key = rest[1] && !rest[1].startsWith("--") ? rest[1] : undefined;
        const v = getConfigValue(loadConfig(explicit).config, key);
        if (v === undefined) return (console.error(`unknown config key "${key}"`), 1);
        console.log(formatValue(v));
        return 0;
      }
      if (sub === "set") {
        if (rest.length < 3) return (console.error("usage: mto config set <key> <value>"), 2);
        const r = setConfigValue(configPath(explicit), rest[1], rest[2]);
        if (!r.ok) return (console.error(`[mto] ${r.error}`), 1);
        console.log(`${rest[1]} = ${formatValue(r.value)}   (${r.path})${readDaemon() ? "\nrestart `mto serve` for the daemon to pick it up" : ""}`);
        return 0;
      }
      if (sub === "edit") {
        const p = configPath(explicit);
        if (!existsSync(p)) return (console.error(`${p} does not exist yet; run \`mto config init\``), 1);
        const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
        return new Promise<number>((resolve) => spawn(editor, [p], { stdio: "inherit", shell: true }).on("close", (c) => resolve(c ?? 0)));
      }
      console.error(commandHelp("config"));
      return 2;
    }

    case "models": {
      const { config, configPath: cfgFile } = createRuntime(flag(rest, "--config"));
      const sub = rest[0] && !rest[0].startsWith("--") ? rest[0] : "list";
      const name = rest[1] && !rest[1].startsWith("--") ? rest[1] : undefined;
      if (sub === "list") {
        const m = await ollamaModels(config.llm);
        if (!m.ok) return (console.error(`✗ ollama unreachable at ${config.llm.baseUrl} (${m.error})`), 1);
        const gb = (b: number) => (b ? `${(b / 1e9).toFixed(1)} GB` : "-");
        for (const x of m.models) console.log(`${x.name === config.llm.model || x.name === `${config.llm.model}:latest` ? "*" : " "} ${x.name.padEnd(28)} ${gb(x.sizeBytes).padEnd(8)} ${[x.family, x.parameterSize, x.quantization].filter(Boolean).join(" ")}`);
        if (!m.models.some((x) => x.name === config.llm.model || x.name === `${config.llm.model}:latest`)) console.log(`\nactive model "${config.llm.model}" is not pulled: mto models pull ${config.llm.model}`);
        return 0;
      }
      if (sub === "use") {
        if (!validModelName(name)) return (console.error("usage: mto models use <name>"), 2);
        const d = readDaemon();
        const live = d ? await callDaemon(d, "POST", "/api/models/select", { model: name }) : undefined;
        if (!live) {
          const r = setConfigValue(configPath(cfgFile), "llm.model", name);
          if (!r.ok) return (console.error(`[mto] ${r.error}`), 1);
        }
        const m = await ollamaModels(config.llm);
        console.log(`llm.model = ${name}${live ? " (daemon updated live)" : ""}`);
        if (m.ok && !m.models.some((x) => x.name === name || x.name === `${name}:latest`)) console.log(`not pulled yet: mto models pull ${name}`);
        return 0;
      }
      if (sub === "test") {
        const model = name ?? config.llm.model;
        if (!validModelName(model)) return (console.error("invalid model name"), 2);
        console.log(`testing ${model} ...`);
        const r = await testModel(config.llm, model);
        if (!r.ok) return (console.error(`✗ ${r.error}`), 1);
        console.log(`${r.factsKept}/${r.factsTotal} key facts kept · ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s${r.tokensPerSec ? ` · ${r.tokensPerSec} tok/s` : ""}${r.truncated ? " · TRUNCATED" : ""}\n${r.summary}`);
        return r.factsKept === r.factsTotal ? 0 : 1;
      }
      if (sub === "pull") {
        if (!validModelName(name)) return (console.error("usage: mto models pull <name>"), 2);
        let last = "";
        const r = await pullModel(config.llm, name, (p) => {
          const line = p.total && p.completed ? `${p.status} ${Math.round((p.completed / p.total) * 100)}%` : p.status;
          if (line !== last && process.stderr.isTTY) process.stderr.write(`\r${line.padEnd(60)}`);
          last = line;
        });
        process.stderr.write("\n");
        if (!r.ok) return (console.error(`✗ pull failed: ${r.error}`), 1);
        console.log(`pulled ${name}. Use it: mto models use ${name}`);
        return 0;
      }
      console.error(commandHelp("models"));
      return 2;
    }

    case "about": {
      const d = readDaemon();
      console.log(`mcp-token-optimizer ${packageVersion()}\nLossless-first MCP tool-response compression. Local only: no telemetry, no cloud models.\nlicense:  Apache-2.0\nrepo:     ${REPO_URL}\ndata dir: ${HOME_DIR}\nnode:     ${process.version}\ndaemon:   ${d ? `up on http://127.0.0.1:${d.port}/ (pid ${d.pid})` : "not running"}`);
      return 0;
    }

    case "docs": {
      const section = rest.find((a) => !a.startsWith("--"));
      const r = docsHelp(section);
      console.log(r.text);
      if (r.url && rest.includes("--open")) openUrl(r.url);
      return r.code;
    }

    case "help": {
      const r = helpFor(rest[0]);
      (r.code ? console.error : console.log)(r.text);
      return r.code;
    }

    case "--version":
      console.log(JSON.parse(readFileSync(join(dirname(cliPath), "..", "package.json"), "utf8")).version);
      return 0;

    default: {
      if (!cmd) return (console.log(helpFor().text), 0);
      const near = suggest(cmd);
      console.error(`mto: unknown command "${cmd}".${near ? ` Did you mean "${near}"?` : ""} Run \`mto help\` for the list.`);
      return 2;
    }
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

