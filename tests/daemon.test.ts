import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Audit } from "../src/audit.js";
import { ConfigSchema } from "../src/config.js";
import { Daemon, readDaemon, writeDaemon, removeDaemon } from "../src/daemon.js";
import { ensureDaemon } from "../src/daemonClient.js";
import { startHttpProxy } from "../src/http.js";
import { Registry } from "../src/registry.js";
import type { Runtime } from "../src/runtime.js";

const dir = mkdtempSync(join(tmpdir(), "mto-daemon-"));
const config = ConfigSchema.parse({ audit: { path: join(dir, "stats.jsonl") } });
const rt = { config, audit: new Audit(config.audit), newSession: () => { throw new Error("unused"); } } as unknown as Runtime;

const row = { ts: new Date().toISOString(), server: "demo", tool: "t", mode: "active", tokensIn: 100, tokensOut: 40, stages: ["prune"], lossy: false, redactions: {}, latencyMs: 3 };

async function boot() {
  let closed = false;
  const daemon = new Daemon(rt, { onShutdown: () => (closed = true), routesFile: join(dir, "routes.json") });
  const srv = await startHttpProxy(rt, { port: 0, daemon, routesFile: join(dir, "routes.json") });
  daemon.port = (srv.address() as { port: number }).port;
  const base = `http://127.0.0.1:${daemon.port}`;
  const api = (path: string, init: RequestInit = {}, token: string | null = daemon.token) =>
    fetch(base + path, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as object), ...(init.body ? { "content-type": "application/json" } : {}) } });
  return { daemon, srv, base, api, wasShutdown: () => closed };
}

// fetch cannot forge Host/Origin, so use raw http for the guard tests
const raw = (port: number, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path, headers, agent: false }, (res) => (res.resume(), resolve({ status: res.statusCode!, headers: res.headers })));
    r.on("error", reject).end();
  });

test("daemon API: token, host and origin guards, no CORS", async () => {
  const { daemon, srv, api } = await boot();
  try {
    assert.equal((await api("/api/status", {}, null)).status, 401);
    assert.equal((await api("/api/status", {}, "wrong-token")).status, 401);
    const ok = await api("/api/status");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
    assert.equal(((await ok.json()) as { mode: string }).mode, "active");

    const auth = { authorization: `Bearer ${daemon.token}` };
    assert.equal((await raw(daemon.port, "/api/status", { ...auth, host: "evil.example.com" })).status, 403);
    assert.equal((await raw(daemon.port, "/api/status", { ...auth, origin: "http://evil.example.com" })).status, 403);
    assert.equal((await raw(daemon.port, "/api/status", { ...auth, origin: `http://127.0.0.1:${daemon.port}` })).status, 200);
    assert.equal((await raw(daemon.port, "/", { host: "evil.example.com" })).status, 403);
    assert.equal((await api("/api/nope")).status, 404);
    // the placeholder page and /health stay reachable without a token and expose nothing
    assert.equal((await fetch(`http://127.0.0.1:${daemon.port}/`)).status, 200);
  } finally {
    srv.close();
  }
});

test("daemon API: register, heartbeat, report, deregister, stats and shutdown", async () => {
  const { daemon, srv, api, wasShutdown } = await boot();
  try {
    const { id } = (await (await api("/api/register", { method: "POST", body: JSON.stringify({ kind: "stdio", server: "github", pid: 123 }) })).json()) as { id: string };
    assert.ok(id);
    assert.equal((await api("/api/heartbeat", { method: "POST", body: JSON.stringify({ id }) })).status, 200);
    assert.equal((await api("/api/heartbeat", { method: "POST", body: JSON.stringify({ id: "nope" }) })).status, 404);

    // a client-reported row is cleaned to known size-only fields and attributed to its proxy
    const dirty = { ...row, secret: "tool output must never travel", content: "x" };
    assert.equal((await api("/api/report", { method: "POST", body: JSON.stringify({ id, row: dirty }) })).status, 200);
    assert.equal((await api("/api/report", { method: "POST", body: JSON.stringify({ row: { tool: "x" } }) })).status, 400);
    const st = (await (await api("/api/status")).json()) as { proxies: { id: string; calls: number; tokensIn: number }[] };
    assert.deepEqual(st.proxies.map((p) => [p.id, p.calls, p.tokensIn]), [[id, 1, 100]]);

    // rows written locally (e.g. by the http proxy in this process) reach the feed too
    const seen: unknown[] = [];
    daemon.events.on("row", (r) => seen.push(r));
    rt.audit.write({ ...row, tool: "local" } as never);
    assert.equal(seen.length, 1);
    assert.ok(!("secret" in (seen[0] as object)));

    const stats = (await (await api("/api/stats")).json()) as { calls: number; saved: number };
    assert.equal(stats.calls, 1);
    assert.equal(stats.saved, 60);

    await api("/api/deregister", { method: "POST", body: JSON.stringify({ id }) });
    assert.equal(((await (await api("/api/status")).json()) as { proxies: unknown[] }).proxies.length, 0);

    await api("/api/shutdown", { method: "POST" });
    await new Promise((r) => setImmediate(r));
    assert.ok(wasShutdown());
  } finally {
    srv.close();
  }
});

test("daemon API: SSE feed replays recent rows then streams live ones", async () => {
  const { daemon, srv, base } = await boot();
  const ctl = new AbortController();
  try {
    daemon.publish({ ...row, tool: "old" } as never);
    const res = await fetch(base + "/api/events", { headers: { authorization: `Bearer ${daemon.token}` }, signal: ctl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += dec.decode((await reader.read()).value);
    };
    await until('"tool":"old"');
    daemon.publish({ ...row, tool: "live" } as never);
    await until('"tool":"live"');
  } finally {
    ctl.abort();
    srv.close();
  }
});

test("registry: entries expire without a heartbeat", () => {
  const reg = new Registry();
  const id = reg.register({ kind: "stdio", server: "a" });
  assert.equal(reg.list().length, 1);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 31_000;
    assert.equal(reg.list().length, 0);
    assert.equal(reg.heartbeat(id), false);
  } finally {
    Date.now = realNow;
  }
});

test("daemon.json: stale files are ignored, removal only deletes our own record", () => {
  const file = join(dir, "daemon.json");
  writeDaemon({ pid: 2_000_000_000, port: 1, token: "t", startedAt: "x" }, file);
  assert.equal(readDaemon(file), undefined); // dead pid
  writeDaemon({ pid: process.pid, port: 1, token: "mine", startedAt: "x" }, file);
  assert.equal(readDaemon(file)?.token, "mine");
  removeDaemon("someone-else", file);
  assert.ok(readDaemon(file));
  removeDaemon("mine", file);
  assert.equal(readDaemon(file), undefined);
});

test("ensureDaemon: opt-outs never spawn anything", async () => {
  const off = ConfigSchema.parse({ ui: { autoStart: false } });
  assert.equal(await ensureDaemon(off, { waitMs: 50, file: join(dir, "none.json") }), undefined);
  process.env.MTO_NO_DAEMON = "1";
  assert.equal(await ensureDaemon(ConfigSchema.parse({}), { waitMs: 50, file: join(dir, "none.json") }), undefined);
});

writeFileSync(join(dir, "routes.json"), "{}");
