import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAudit, type AuditRow } from "./audit.js";
import { HOME_DIR } from "./config.js";
import { configPath, setConfigValue } from "./configEdit.js";
import { ollamaModels, pullModel, testModel, validModelName } from "./llm.js";
import { Registry } from "./registry.js";
import { loadRoutes } from "./routes.js";
import type { Runtime } from "./runtime.js";

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

export function summarize(rows: AuditRow[]): { calls: number; tokensIn: number; tokensOut: number; saved: number; savedPct: number } {
  const real = rows.filter((r) => r.mode === "active" && !r.stages.some((s) => s.startsWith("expand")));
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

  constructor(
    private rt: Runtime,
    private opts: { onShutdown?: () => void; routesFile?: string } = {},
  ) {
    this.events.setMaxListeners(100);
    rt.audit.onWrite((row) => this.publish(row));
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
    const isRoot = url.pathname === "/" && req.method === "GET";
    if (!isApi && !isRoot) return false;

    const send = (code: number, body: unknown, type = "application/json"): true => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "referrer-policy": "no-referrer" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
      return true;
    };
    const host = req.headers.host ?? "";
    if (!LOOPBACK_HOST.test(host)) return send(403, { error: "forbidden host" });
    if (isRoot) return send(200, PLACEHOLDER, "text/html; charset=utf-8");

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
          routes: Object.keys(loadRoutes(this.opts.routesFile)).length,
          proxies: this.registry.list(),
        });
      }
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
      default:
        return send(404, { error: "not found" });
    }
  }
}
