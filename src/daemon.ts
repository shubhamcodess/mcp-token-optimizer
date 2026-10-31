import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isExpandRow, isToolsListRow, readAudit, type AuditRow } from "./audit.js";
import { HOME_DIR } from "./config.js";
import { configPath, setConfigValue } from "./configEdit.js";
import { ollamaModels, pullModel, testModel, validModelName } from "./llm.js";
import { ACTIONS, runAction } from "./actions.js";
import { buildAdvice } from "./advisor.js";
import { CAPTURE_DIR, listCaptures, readCaptures } from "./capture.js";
import { diffSample } from "./compare.js";
import { listConnections } from "./connections.js";
import { describeConfig, readConfigText } from "./configForm.js";
import { configPath as cfgPath } from "./configEdit.js";
import { makeRedactor } from "./redact.js";
import { buildToolTable } from "./tools.js";
import { diffRuns, readRuns } from "./evalHistory.js";
import { acceptDrift, checkDrift, wrapServer, type Finding } from "./drift.js";
import type { AgentTarget } from "./installer.js";
import { buildOverview } from "./overview.js";
import { Registry } from "./registry.js";
import { loadRoutes } from "./routes.js";
import type { Runtime } from "./runtime.js";
import { serveUi } from "./ui.js";
import { captureEnabled } from "./capture.js";

export const DAEMON_FILE = join(HOME_DIR, "daemon.json");
const RECENT_ROWS = 200;
const MAX_API_BODY = 64 * 1024;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The running daemon's connection info, or undefined if none is running (a stale file is ignored). */
export function readDaemon(file = DAEMON_FILE): DaemonInfo | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const d = JSON.parse(readFileSync(file, "utf8")) as DaemonInfo;
    return d && typeof d.pid === "number" && typeof d.port === "number" && typeof d.token === "string" && alive(d.pid) ? d : undefined;
  } catch {
    return undefined;
  }
}

export function writeDaemon(info: DaemonInfo, file = DAEMON_FILE): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(info) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function removeDaemon(token: string, file = DAEMON_FILE): void {
  // only remove our own record, never one a newer daemon wrote
  try {
    if ((JSON.parse(readFileSync(file, "utf8")) as DaemonInfo).token === token) rmSync(file);
  } catch {
    /* already gone */
  }
}

export const packageVersion = (): string => {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
};

export function summarize(rowsIn: AuditRow[]): { calls: number; tokensIn: number; tokensOut: number; saved: number; savedPct: number } {
  let rows = rowsIn;
  const real = rows.filter((r) => r.mode === "active" && !isExpandRow(r) && !isToolsListRow(r));
  rows = rows.filter((r) => !isToolsListRow(r));
  const tokensIn = real.reduce((a, r) => a + r.tokensIn, 0);
  const tokensOut = real.reduce((a, r) => a + r.tokensOut, 0);
  return { calls: rows.length, tokensIn, tokensOut, saved: tokensIn - tokensOut, savedPct: tokensIn ? Math.round(((tokensIn - tokensOut) / tokensIn) * 1000) / 10 : 0 };
}

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>mto</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem}code{background:#8882;padding:.1em .3em;border-radius:4px}</style>
<h1>mto daemon is running</h1><p>The dashboard arrives in a later 0.2.0 build. The authenticated API lives under <code>/api/</code>; run <code>mto status</code> for a summary.</p>`;

/** Strip a client-reported audit row down to the known, size-only fields. */
function cleanRow(x: any): AuditRow | undefined {
  if (!x || typeof x !== "object") return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  if (!str(x.server) || !str(x.tool)) return undefined;
  const redactions: Record<string, number> = {};
  if (x.redactions && typeof x.redactions === "object") for (const [k, v] of Object.entries(x.redactions).slice(0, 30)) redactions[k.slice(0, 60)] = num(v);
  return {
    ts: str(x.ts) || new Date().toISOString(),
    server: str(x.server),
    tool: str(x.tool),
    client: str(x.client) || undefined,
    mode: x.mode === "shadow" ? "shadow" : "active",
    tokensIn: num(x.tokensIn),
    tokensOut: num(x.tokensOut),
    stages: Array.isArray(x.stages) ? x.stages.slice(0, 20).map(str) : [],
    lossy: x.lossy === true,
    redactions,
    latencyMs: num(x.latencyMs),
    profile: str(x.profile) || undefined,
    expandOf: str(x.expandOf) || undefined,
    noted: x.noted === true ? true : undefined,
  };
}

/**
 * Local daemon API, mounted on the proxy's HTTP server under `/api/*`. Loopback only (the server binds there),
 * every request needs the per-run bearer token, Host and Origin are checked, no CORS headers are ever sent, and
 * no endpoint accepts a command or a path: there are only fixed, named actions.
 */
export class Daemon {
  readonly token = randomBytes(24).toString("base64url");
  readonly registry = new Registry();
  readonly events = new EventEmitter();
  readonly startedAt = Date.now();
  private recent: AuditRow[] = [];
  port = 0;
  drift: { checkedAt: string | null; findings: Finding[] } = { checkedAt: null, findings: [] };
  private driftTimer?: NodeJS.Timeout;

  constructor(
    private rt: Runtime,
    private opts: { onShutdown?: () => void; routesFile?: string; targets?: () => AgentTarget[]; cliPath?: string; baselineFile?: string; captureDir?: string; evalHistoryFile?: string } = {},
  ) {
    this.events.setMaxListeners(100);
    rt.audit.onWrite((row) => this.publish(row));
  }

  /** Poll the agents' MCP configs for drift (new unwrapped servers, removed wrappers). Opt-in autoWrap wraps matching agents' new servers. */
  startDriftWatch(log: (m: string) => void = () => undefined): () => void {
    const d = this.rt.config.drift;
    if (!d.enabled || !this.opts.targets) return () => undefined;
    const run = () => {
      try {
        const targets = this.opts.targets!();
        let findings = checkDrift({ targets, baselineFile: this.opts.baselineFile, daemonUp: true });
        const auto = this.rt.config.drift.autoWrap.map((a) => a.toLowerCase());
        for (const f of findings.filter((x) => x.kind === "new-unwrapped" && auto.some((a) => x.agent.toLowerCase().includes(a)))) {
          if (this.opts.cliPath && wrapServer(f.server, targets.filter((t) => t.agent === f.agent), this.opts.cliPath).some((c) => c.action === "wrap" || c.action === "wrap-http")) log(`[mto] auto-wrapped "${f.server}" in ${f.agent} (drift.autoWrap)`);
        }
        findings = checkDrift({ targets, baselineFile: this.opts.baselineFile, daemonUp: true });
        this.drift = { checkedAt: new Date().toISOString(), findings };
      } catch {
        /* a broken agent config must never take the daemon down */
      }
    };
    run();
    this.driftTimer = setInterval(run, Math.max(5, this.rt.config.drift.intervalSec) * 1000);
    this.driftTimer.unref();
    return () => clearInterval(this.driftTimer);
  }

  publish(row: AuditRow, id?: string): void {
    this.recent.push(row);
    if (this.recent.length > RECENT_ROWS) this.recent.shift();
    this.registry.count(id, row);
    this.events.emit("row", row);
  }

  info(): DaemonInfo {
    return { pid: process.pid, port: this.port, token: this.token, startedAt: new Date(this.startedAt).toISOString() };
  }

  /** Returns true if the request belonged to the daemon (and was answered). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const isStatic = req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/favicon.svg" || url.pathname === "/theme.js" || url.pathname.startsWith("/assets/"));
    if (!isApi && !isStatic) return false;

    const send = (code: number, body: unknown, type = "application/json"): true => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "referrer-policy": "no-referrer" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
      return true;
    };
    const host = req.headers.host ?? "";
    if (!LOOPBACK_HOST.test(host)) return send(403, { error: "forbidden host" });
    if (isStatic) {
      if (serveUi(url.pathname, res)) return true;
      return url.pathname === "/" ? send(200, PLACEHOLDER, "text/html; charset=utf-8") : send(404, { error: "not found" });
    }

    // Browsers always send Origin on cross-origin requests; only our own origin is acceptable.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return send(403, { error: "forbidden origin" });

    const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    const want = Buffer.from(this.token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return send(401, { error: "missing or invalid token" });

    const route = `${req.method} ${url.pathname}`;
    const body = async (): Promise<any> => {
      const parts: Buffer[] = [];
      let n = 0;
      for await (const c of req) {
        n += (c as Buffer).length;
        if (n > MAX_API_BODY) throw new Error("body too large");
        parts.push(c as Buffer);
      }
      try {
        return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
      } catch {
        return {};
      }
    };

    switch (route) {
      case "GET /api/status": {
        const c = this.rt.config;
        return send(200, {
          version: packageVersion(),
          pid: process.pid,
          port: this.port,
          startedAt: new Date(this.startedAt).toISOString(),
          uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
          mode: c.mode,
          profile: c.profile,
          capture: captureEnabled(),
          drift: this.drift.findings.length,
          configReloadedAt: this.rt.reloadedAt ?? null,
          model: c.llm.model,
          routes: Object.keys(loadRoutes(this.opts.routesFile)).length,
          proxies: this.registry.list(),
        });
      }
      case "GET /api/overview": {
        return send(200, buildOverview(readAudit(this.rt.config.audit.path, Date.now() - 7 * 864e5)));
      }
      case "GET /api/advice":
        return send(200, buildAdvice(readAudit(this.rt.config.audit.path, Date.now() - 7 * 864e5)));
      case "GET /api/connections":
        return send(200, this.opts.targets ? listConnections(this.opts.targets(), this.rt.config, this.opts.routesFile) : { files: [], unparsable: [] });
      case "GET /api/tools":
        return send(200, buildToolTable(readAudit(this.rt.config.audit.path, Date.now() - 7 * 864e5), this.rt.config));
      case "GET /api/traffic": {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
        return send(200, readAudit(this.rt.config.audit.path, Date.now() - 7 * 864e5).slice(-limit).reverse());
      }
      case "GET /api/config/form": {
        const file = cfgPath(this.rt.configPath);
        const readOnly = (p: string) => /^(audit\.path|discovery\.|llm\.baseUrl)/.test(p);
        return send(200, { file, fields: describeConfig(this.rt.config).map((f) => (readOnly(f.path) ? { ...f, readOnly: true } : f)), raw: readConfigText(file) });
      }
      case "GET /api/captures": {
        const dir = this.opts.captureDir ?? CAPTURE_DIR;
        return send(200, { enabled: captureEnabled(), dir, ...listCaptures(dir) });
      }
      case "GET /api/eval/history":
        return send(200, readRuns(this.opts.evalHistoryFile).reverse().map(({ id, ts, label, source, candidate, result }) => ({ id, ts, label, source, candidate, samples: result.samples, totals: result.totals })));
      case "GET /api/eval/diff": {
        const runs = readRuns(this.opts.evalHistoryFile);
        const a = runs.find((r) => r.id === url.searchParams.get("a"));
        const b = runs.find((r) => r.id === url.searchParams.get("b"));
        return a && b ? send(200, diffRuns(a, b)) : send(404, { error: "no such run" });
      }
      case "GET /api/drift":
        return send(200, this.drift);
      case "GET /api/actions":
        return send(200, ACTIONS);
      case "GET /api/config":
        return send(200, this.rt.config);
      case "GET /api/stats": {
        const m = /^(\d+)([hd])$/.exec(url.searchParams.get("since") ?? "");
        const sinceMs = m ? Date.now() - Number(m[1]) * (m[2] === "h" ? 3.6e6 : 8.64e7) : 0;
        return send(200, summarize(readAudit(this.rt.config.audit.path, sinceMs)));
      }
      case "GET /api/events": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
        const write = (row: AuditRow) => res.write(`data: ${JSON.stringify(row)}\n\n`);
        for (const r of this.recent.slice(-50)) write(r);
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        this.events.on("row", write);
        res.on("close", () => {
          clearInterval(ping);
          this.events.off("row", write);
        });
        return true;
      }
      case "POST /api/register": {
        const b = await body();
        const server = typeof b.server === "string" ? b.server.slice(0, 120) : "";
        if (!server) return send(400, { error: "server required" });
        const id = this.registry.register({ kind: b.kind === "http" ? "http" : "stdio", server, client: typeof b.client === "string" ? b.client.slice(0, 120) : undefined, pid: Number.isInteger(b.pid) ? b.pid : undefined, id: typeof b.id === "string" && /^[\w-]{1,40}$/.test(b.id) ? b.id : undefined });
        return send(200, { id });
      }
      case "POST /api/heartbeat": {
        const b = await body();
        return typeof b.id === "string" && this.registry.heartbeat(b.id) ? send(200, { ok: true }) : send(404, { error: "unknown id, register again" });
      }
      case "POST /api/deregister": {
        const b = await body();
        if (typeof b.id === "string") this.registry.remove(b.id);
        return send(200, { ok: true });
      }
      case "POST /api/report": {
        const b = await body();
        const row = cleanRow(b.row);
        if (!row) return send(400, { error: "invalid row" });
        this.publish(row, typeof b.id === "string" ? b.id : undefined);
        return send(200, { ok: true });
      }
      case "GET /api/models": {
        const m = await ollamaModels(this.rt.config.llm);
        return send(200, { ...m, active: this.rt.config.llm.model, baseUrl: this.rt.config.llm.baseUrl, activePulled: m.models.some((x) => x.name === this.rt.config.llm.model || x.name === `${this.rt.config.llm.model}:latest`) });
      }
      case "POST /api/models/select": {
        const b = await body();
        if (!validModelName(b.model)) return send(400, { error: "invalid model name" });
        const r = setConfigValue(configPath(this.rt.configPath), "llm.model", b.model);
        if (!r.ok) return send(400, { error: r.error });
        this.rt.config.llm.model = b.model; // live: the running client reads this object
        return send(200, { ok: true, active: b.model });
      }
      case "POST /api/models/test": {
        const b = await body();
        const model = b.model ?? this.rt.config.llm.model;
        if (!validModelName(model)) return send(400, { error: "invalid model name" });
        return send(200, await testModel(this.rt.config.llm, model));
      }
      case "POST /api/models/pull": {
        const b = await body();
        if (!validModelName(b.model)) return send(400, { error: "invalid model name" });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const r = await pullModel(this.rt.config.llm, b.model, (p) => res.write(`data: ${JSON.stringify(p)}\n\n`), abort.signal);
        res.write(`data: ${JSON.stringify({ status: r.ok ? "done" : "failed", error: r.error })}\n\n`);
        res.end();
        return true;
      }
      case "POST /api/shutdown":
        send(200, { ok: true });
        setImmediate(() => this.opts.onShutdown?.());
        return true;
      default: {
        const run = /^GET \/api\/eval\/runs\/([\w]+)$/.exec(route);
        if (run) {
          const r = readRuns(this.opts.evalHistoryFile).find((x) => x.id === run[1]);
          return r ? send(200, r) : send(404, { error: "no such run" });
        }
        const cap = /^GET \/api\/captures\/(\d+)$/.exec(route);
        if (cap) {
          const sample = readCaptures(this.opts.captureDir ?? CAPTURE_DIR)[Number(cap[1])];
          if (!sample) return send(404, { error: "no such capture" });
          // captures are redacted when written; redact again on display with the current patterns, then cap the size
          const red = makeRedactor({ ...this.rt.config, redaction: { ...this.rt.config.redaction, mode: "redact" } });
          const text = (r?: { content?: { text?: string }[] }) => red((r?.content ?? []).map((c) => c.text ?? "").join("\n")).text.slice(0, 20_000);
          const d = diffSample(sample);
          return send(200, { ts: sample.ts, server: sample.server, tool: sample.tool, original: text(sample.result), received: sample.optimized ? text(sample.optimized) : null, verdict: d?.verdict ?? null, tokensIn: d?.tokensIn ?? null, tokensOut: d?.tokensOut ?? null, dataDropped: d?.dataDropped.slice(0, 10) ?? [] });
        }
        const m = /^POST \/api\/actions\/([\w-]+)$/.exec(route);
        if (m) {
          const a = await body();
          if (m[1] === "drift-accept" && this.opts.targets) {
            acceptDrift(this.opts.targets(), this.opts.baselineFile);
            this.drift = { ...this.drift, findings: [] };
            return send(200, { ok: true });
          }
          const r = await runAction(this.rt, m[1], a, { targets: this.opts.targets, cliPath: this.opts.cliPath, baselineFile: this.opts.baselineFile, captureDir: this.opts.captureDir, evalHistoryFile: this.opts.evalHistoryFile });
          if (r.status === 200 && m[1] === "wrap-server") this.drift = { ...this.drift, findings: this.drift.findings.filter((f) => f.server !== a.server) };
          return send(r.status, r.body);
        }
        return send(404, { error: "not found" });
      }
    }
  }
}
