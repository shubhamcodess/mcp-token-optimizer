import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AuditRow } from "./audit.js";
import { readDaemon, type DaemonInfo } from "./daemon.js";
import type { Config } from "./config.js";
import type { Runtime } from "./runtime.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authenticated call to the running daemon. Resolves undefined on any failure: callers must never depend on it. */
export async function callDaemon(info: DaemonInfo, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 1500): Promise<any | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}${path}`, { method, headers: { authorization: `Bearer ${info.token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start the daemon (`mto serve`) detached if none is running. Single instance: `serve` itself refuses to start a
 * second one. Never opens a browser. `force` ignores `ui.autoStart` (used by the explicit `mto ui`).
 */
export async function ensureDaemon(cfg: Config, opts: { force?: boolean; waitMs?: number; file?: string } = {}): Promise<DaemonInfo | undefined> {
  const running = readDaemon(opts.file);
  if (running) return running;
  if (!opts.force && (!cfg.ui.autoStart || process.env.MTO_NO_DAEMON)) return undefined;
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  try {
    const child = spawn(process.execPath, [cli, "serve", "--port", String(cfg.ui.port)], { detached: true, stdio: "ignore", env: process.env });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    return undefined;
  }
  const deadline = Date.now() + (opts.waitMs ?? 4000);
  while (Date.now() < deadline) {
    const d = readDaemon(opts.file);
    if (d) return d;
    await sleep(150);
  }
  return undefined;
}

/**
 * Register this wrapper with the daemon, heartbeat, and mirror audit rows to its live feed. Entirely best-effort:
 * if the daemon is absent or restarts, the wrapper keeps working exactly as before.
 */
export function attachToDaemon(rt: Runtime, server: string): () => Promise<void> {
  let info: DaemonInfo | undefined;
  let id: string | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let client: string | undefined;

  const register = async (): Promise<void> => {
    info = readDaemon();
    if (!info) return void (id = undefined);
    id = (await callDaemon(info, "POST", "/api/register", { kind: "stdio", server, pid: process.pid, client, id }))?.id ?? id;
  };
  const beat = async (): Promise<void> => {
    if (stopped) return;
    if (!info || !id || !(await callDaemon(info, "POST", "/api/heartbeat", { id }))) await register();
  };

  rt.audit.onWrite((row: AuditRow) => {
    client = row.client ?? client;
    if (info && id) void callDaemon(info, "POST", "/api/report", { id, row });
  });

  void (async () => {
    info = await ensureDaemon(rt.config);
    if (stopped) return;
    await register();
    timer = setInterval(() => void beat(), 10_000);
    timer.unref();
  })();

  return async () => {
    stopped = true;
    if (timer) clearInterval(timer);
    if (info && id) await callDaemon(info, "POST", "/api/deregister", { id }, 500);
  };
}
