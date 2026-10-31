#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import { buildAdvice } from "./advisor.js";
import { dailyStats, formatReport, readAudit, readRollups, rotateAudit } from "./audit.js";
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
import { checkFidelity, checkGates, exampleSamples, formatEval, parseThresholds, runEval, toBaseline, type Baseline } from "./eval.js";
import { discover, planOrApply, type AgentTarget } from "./installer.js";
import { acceptDrift, checkDrift, wrapServer } from "./drift.js";
import { resolveTargets } from "./targets.js";
import { installService, launchdPlist, platformOf, serviceStatus, servicePath, systemdUnit, uninstallService } from "./service.js";
import { runDoctor } from "./doctor.js";
import { ollamaModels, pullModel, testModel, validModelName } from "./llm.js";
import { createRuntime } from "./runtime.js";
import { runStdioWrapper } from "./stdio.js";

function openUrl(url: string): void {
  const [bin, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(bin as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => console.error(`[mto] could not open a browser; visit ${url}`)).unref();
}

function flagAll(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
}

function resolveTargetsCli(rest: string[]): AgentTarget[] {
  return resolveTargets(loadConfig(flag(rest, "--config")).config.discovery, { skip: flagAll(rest, "--skip"), files: flagAll(rest, "--file"), scan: flagAll(rest, "--scan"), noBuiltin: rest.includes("--no-builtin") });
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
      const { found, unparsable, missing } = discover(resolveTargetsCli(rest));
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
        targets: resolveTargetsCli(rest),
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
      const rotate = setInterval(() => rotateAudit(rt.config.audit), 10 * 60_000);
      rotate.unref();
      rt.watch((r) => console.error(r.ok ? "[mto] config reloaded" : `[mto] config change ignored (invalid): ${r.error}`));
      let srv: Awaited<ReturnType<typeof startHttpProxy>>;
      const daemon = new Daemon(rt, { onShutdown: () => srv.close(), targets: () => resolveTargets(rt.config.discovery), cliPath: fileURLToPath(import.meta.url) });
      srv = await startHttpProxy(rt, { port, daemon });
      daemon.port = (srv.address() as { port: number }).port;
      writeDaemon(daemon.info());
      daemon.startDriftWatch((m) => console.error(m));
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
        if (live.drift) console.log(`WARNING: ${live.drift} drift finding(s): run \`mto drift\``);
        if (st) console.log(`last 24h: ${st.calls} calls, ~${st.tokensIn} -> ~${st.tokensOut} tokens, estimated (${st.savedPct}% saved)`);
        return 0;
      }
      const { config } = createRuntime(flag(rest, "--config"));
      const st = summarize(readAudit(config.audit.path, Date.now() - 8.64e7));
      console.log("daemon: DOWN  (start it with `mto serve` or `mto ui`)");
      console.log(`last 24h (from the audit log): ${st.calls} calls, ~${st.tokensIn} -> ~${st.tokensOut} tokens, estimated (${st.savedPct}% saved)`);
      return 1;
    }

    case "ui": {
      const { config } = createRuntime(flag(rest, "--config"));
      const d = await ensureDaemon(config, { force: true });
      if (!d) return (console.error("[mto] could not start the daemon; run `mto serve` to see why"), 1);
      const url = `http://127.0.0.1:${d.port}/`;
      console.log(url);
      // the token travels in the URL fragment: never sent to the server, never logged, removed by the page on load
      if (!rest.includes("--no-open")) openUrl(`${url}#t=${d.token}`);
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
      if (rest.includes("--daily")) {
        const days = dailyStats(rows, readRollups(rt.config.audit.path), sinceMs);
        if (!days.length) return (console.log("No data in that range."), 0);
        console.log(rest.includes("--json") ? JSON.stringify(days) : ["day         calls  tokens_in tokens_out  saved   (token counts are estimates)", ...days.map((d) => `${d.day} ${String(d.calls).padStart(6)} ${String(d.tokensIn).padStart(10)} ${String(d.tokensOut).padStart(10)} ${(d.tokensIn ? (100 * (d.tokensIn - d.tokensOut)) / d.tokensIn : 0).toFixed(1).padStart(5)}%`)].join("\n"));
        return 0;
      }
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
      const d = await runDoctor(rt.config, rt.configPath);
      for (const c of d.checks) console.log(`${c.ok ? "✓" : "✗"} ${c.label}${c.detail ? `\n  ${c.detail}` : ""}`);
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
        return new Promise<number>((resolve) => spawn(`${editor} ${JSON.stringify(p)}`, { stdio: "inherit", shell: true }).on("close", (c) => resolve(c ?? 0)));
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

    case "eval": {
      if (rest[0] === "fidelity") {
        const tool = flag(rest, "--tool");
        const file = flag(rest, "--file");
        if (!tool || !file) return (console.error("usage: mto eval fidelity --tool <tool> --file <file> [--path <JSONPath>] [--dir <captures dir>] [--which N]"), 2);
        const found = readCaptures(flag(rest, "--dir")).filter((x) => x.tool === tool);
        if (!found.length) return (console.error(`no captured samples for tool "${tool}"`), 2);
        const which = flag(rest, "--which");
        const sample = which && which !== "last" ? found[Number(which)] : found[found.length - 1];
        if (!sample) return (console.error("no such sample"), 2);
        try {
          const f = checkFidelity(sample, readFileSync(file, "utf8"), flag(rest, "--path"));
          console.log(`${f.identical ? "IDENTICAL" : "DIFFERENT"}  original=${f.originalBytes}B  file=${f.givenBytes}B${f.identical ? "" : `  first difference at byte ${f.firstDifference}${f.whitespaceOnly ? " (whitespace/newline only)" : ""}`}`);
          return f.identical ? 0 : 1;
        } catch (e) {
          return (console.error(`[mto] ${(e as Error).message}`), 2);
        }
      }
      const useExamples = rest.includes("--examples");
      let samples;
      try {
        samples = useExamples ? exampleSamples() : readCaptures(flag(rest, "--dir"));
      } catch (e) {
        return (console.error(`[mto] ${(e as Error).message}`), 2);
      }
      if (!samples.length) return (console.error(`No samples. Use --examples, or run \`mto capture on\` and use your agent first.`), 2);
      const cfg = useExamples && !flag(rest, "--config") ? defaultConfig() : loadConfig(flag(rest, "--config")).config;
      let thresholds, baseline: Baseline | undefined;
      try {
        thresholds = parseThresholds(flag(rest, "--fail-under") ?? "");
        const bf = flag(rest, "--baseline");
        if (bf) baseline = JSON.parse(readFileSync(bf, "utf8")) as Baseline;
        if (flag(rest, "--tolerance") && baseline) baseline.tolerance = Number(flag(rest, "--tolerance"));
      } catch (e) {
        return (console.error(`[mto] ${(e as Error).message}`), 2);
      }
      const result = await runEval(samples, cfg, { llm: rest.includes("--llm") });
      const wb = flag(rest, "--write-baseline");
      if (wb) (writeFileSync(wb, JSON.stringify(toBaseline(result), null, 2) + "\n"), console.error(`wrote baseline ${wb}`));
      const gate = checkGates(result, thresholds, baseline);
      if (rest.includes("--json")) console.log(JSON.stringify({ ...result, gate }, null, 2));
      else {
        console.log(formatEval(result));
        console.log(gate.ok ? "PASS" : gate.failures.map((f) => `FAIL ${f}`).join("\n"));
      }
      return gate.ok ? 0 : 1;
    }

    case "drift": {
      const { config } = createRuntime(flag(rest, "--config"));
      const targets = resolveTargets(config.discovery, { skip: flagAll(rest, "--skip"), files: flagAll(rest, "--file"), scan: flagAll(rest, "--scan"), noBuiltin: rest.includes("--no-builtin") });
      if (rest[0] === "accept") return (console.log(`accepted the current state (${acceptDrift(targets)} server(s))`), 0);
      if (rest[0] === "wrap") {
        if (!rest[1]) return (console.error("usage: mto drift wrap <server>"), 2);
        const hit = checkDrift({ targets, daemonUp: true }).find((f) => f.server === rest[1] && f.kind !== "dead-proxy");
        if (!hit) return (console.error(`"${rest[1]}" is not in the drift list`), 1);
        for (const c of wrapServer(hit.server, targets, fileURLToPath(import.meta.url))) console.log(`${c.action.padEnd(13)} ${c.server}  (${c.file})`);
        return 0;
      }
      const f = checkDrift({ targets, daemonUp: !!readDaemon() });
      if (!f.length) return (console.log("No drift: every server is accounted for."), 0);
      for (const x of f) console.log(`! ${x.message}${x.kind === "dead-proxy" ? "  (start it with `mto serve`)" : `\n    fix: mto drift wrap ${x.server}   or accept: mto drift accept`}`);
      return 1;
    }

    case "advise": {
      const { config } = createRuntime(flag(rest, "--config"));
      const adv = buildAdvice(readAudit(config.audit.path, Date.now() - 7 * 864e5));
      if (rest.includes("--json")) return (console.log(JSON.stringify(adv, null, 2)), 0);
      if (!adv.length) return (console.log("No recommendations from the last 7 days of measurements."), 0);
      for (const a of adv) {
        console.log(`${a.severity === "warn" ? "!" : "·"} ${a.tool}: ${a.title}\n    ${Object.entries(a.numbers).map(([k, v]) => `${k}=${v}`).join("  ")}${a.apply ? `\n    fix: mto config set '${a.apply.key}' ${a.apply.value}   (${a.apply.label})` : ""}`);
      }
      return 0;
    }

    case "service": {
      const sub = rest[0] ?? "status";
      const platform = platformOf();
      const { config } = createRuntime(flag(rest, "--config"));
      const opts = { node: process.execPath, cli: fileURLToPath(import.meta.url), port: config.ui.port, logPath: join(HOME_DIR, "serve.log") };
      if (sub === "status") {
        const st = serviceStatus();
        const d = readDaemon();
        console.log(`service: ${platform === "unsupported" ? "unsupported on this OS" : st.installed ? (st.running ? "installed, running" : "installed, not running") : "not installed"}${st.file ? `  (${st.file})` : ""}\ndaemon:  ${d ? `up on http://127.0.0.1:${d.port}/ (pid ${d.pid})` : "not running"}`);
        return 0;
      }
      if (sub === "install" || sub === "uninstall") {
        const apply = rest.includes("--apply");
        if (platform === "unsupported") return (console.error(installService(opts).message), 1);
        if (!apply) {
          const file = servicePath(platform);
          console.log(`dry run: would ${sub} ${file}\n${sub === "install" ? `\n${platform === "launchd" ? launchdPlist(opts) : systemdUnit(opts)}` : ""}\nre-run with --apply to do it.`);
          return 0;
        }
        const running = readDaemon();
        if (sub === "install" && running && !serviceStatus().running) console.error(`note: a daemon is already running (pid ${running.pid}). Stop it (Ctrl-C in its terminal) so the service can take port ${opts.port}.`);
        const r = sub === "install" ? installService(opts) : uninstallService();
        (r.ok ? console.log : console.error)(r.message);
        return r.ok ? 0 : 1;
      }
      console.error(commandHelp("service"));
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

