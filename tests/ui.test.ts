import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAction } from "../src/actions.js";
import { Audit, type AuditRow } from "../src/audit.js";
import { ConfigSchema } from "../src/config.js";
import { Daemon } from "../src/daemon.js";
import { runDoctor } from "../src/doctor.js";
import { startHttpProxy } from "../src/http.js";
import { buildOverview } from "../src/overview.js";
import type { Runtime } from "../src/runtime.js";
import { CSP, serveUi } from "../src/ui.js";

const uiDir = mkdtempSync(join(tmpdir(), "mto-ui-"));
mkdirSync(join(uiDir, "assets"));
writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>x</title>");
writeFileSync(join(uiDir, "assets", "app.js"), "console.log(1)");
writeFileSync(join(uiDir, "assets", "evil.exe"), "x");
writeFileSync(join(uiDir, "..", "secret.txt"), "top secret");

const get = (port: number, path: string) =>
  new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    // raw http so the path is sent exactly as written (fetch normalizes ../)
    request({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c)).on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    })
      .on("error", reject)
      .end();
  });

test("ui static: serves built files with a strict CSP, rejects traversal and unknown types", async () => {
  const srv = createServer((req, res) => {
    const p = new URL(req.url!, "http://x").pathname;
    if (!serveUi(p, res, uiDir)) res.writeHead(418).end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    const root = await get(port, "/");
    assert.equal(root.status, 200);
    assert.match(String(root.headers["content-type"]), /text\/html/);
    assert.equal(root.headers["content-security-policy"], CSP);
    assert.match(CSP, /script-src 'self'/);
    assert.ok(!/unsafe-inline.*script|script-src[^;]*unsafe/.test(CSP));
    assert.equal(root.headers["cache-control"], "no-store");

    const js = await get(port, "/assets/app.js");
    assert.equal(js.status, 200);
    assert.match(String(js.headers["cache-control"]), /immutable/);

    for (const p of ["/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/evil.exe", "/assets/missing.js", "/assets/%00.js"]) {
      const r = await get(port, p);
      assert.ok(r.status === 404 || r.status === 418, `${p} -> ${r.status}`);
      assert.ok(!r.body.includes("top secret"), p);
    }
    assert.equal((await get(port, "/api/status")).status, 418); // not a dashboard path
  } finally {
    srv.close();
  }
});

const row = (o: Partial<AuditRow>): AuditRow => ({ ts: new Date().toISOString(), server: "s", tool: "t", mode: "active", tokensIn: 100, tokensOut: 40, stages: ["prune"], lossy: false, redactions: {}, latencyMs: 1, ...o });

test("overview: totals, zero-filled 7-day series, top tools, expand rate; shadow rows excluded", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  const rows = [
    row({ ts: "2026-10-31T10:00:00Z", tool: "a", tokensIn: 1000, tokensOut: 400 }),
    row({ ts: "2026-10-31T11:00:00Z", tool: "a", tokensIn: 1000, tokensOut: 500 }),
    row({ ts: "2026-10-29T11:00:00Z", tool: "b", tokensIn: 200, tokensOut: 100 }),
    row({ ts: "2026-10-30T11:00:00Z", tool: "c", mode: "shadow", tokensIn: 9999, tokensOut: 9999 }),
    row({ ts: "2026-10-31T11:30:00Z", tool: "mto_expand", tokensIn: 0, tokensOut: 50, stages: ["expand"] }),
    row({ ts: "2026-10-31T11:31:00Z", tool: "mto_expand", tokensIn: 0, tokensOut: 5, stages: ["expand-miss"] }),
  ];
  const o = buildOverview(rows, now);
  assert.equal(o.totals.calls, 3);
  assert.equal(o.totals.tokensIn, 2200);
  assert.equal(o.totals.saved, 1200);
  assert.equal(o.daily.length, 7);
  assert.equal(o.daily.at(-1)!.day, "2026-10-31");
  assert.equal(o.daily.at(-1)!.calls, 2);
  assert.equal(o.daily[0].calls, 0);
  assert.equal(o.topTools[0].tool, "s.a");
  assert.equal(o.expand.calls, 2);
  assert.equal(o.expand.misses, 1);
});

function rtWith(dir: string, extra: object = {}): Runtime {
  const config = ConfigSchema.parse({ audit: { path: join(dir, "s.jsonl") }, llm: { baseUrl: "http://127.0.0.1:1" }, ...extra });
  return { config, configPath: join(dir, "config.yaml"), audit: new Audit(config.audit) } as unknown as Runtime;
}

test("actions: fixed allowlist, validated arguments, live mode switch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-act-"));
  const rt = rtWith(dir);
  assert.equal((await runAction(rt, "rm-rf", {})).status, 404);
  assert.equal((await runAction(rt, "set-mode", { mode: "banana" })).status, 400);
  assert.equal((await runAction(rt, "set-mode", {})).status, 400);
  assert.equal((await runAction(rt, "capture", { state: "maybe" })).status, 400);
  assert.equal((await runAction(rt, "model-test", { model: "x; id" })).status, 400);

  const ok = await runAction(rt, "set-mode", { mode: "shadow" });
  assert.equal(ok.status, 200);
  assert.equal(rt.config.mode, "shadow");
  assert.match(readFileSync(join(dir, "config.yaml"), "utf8"), /mode: shadow/);
});

test("doctor: structured result, flags an unreachable Ollama", async () => {
  const rt = rtWith(mkdtempSync(join(tmpdir(), "mto-doc-")));
  const d = await runDoctor(rt.config, rt.configPath);
  assert.equal(d.ok, false);
  assert.deepEqual(d.checks.map((c) => [c.id, c.ok]), [["config", true], ["ollama", false]]);
});

test("daemon: actions and overview are token-gated; action names come from the allowlist only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-dmn-"));
  const rt = rtWith(dir);
  const daemon = new Daemon(rt, { routesFile: join(dir, "routes.json") });
  const srv = await startHttpProxy(rt, { port: 0, daemon, routesFile: join(dir, "routes.json") });
  daemon.port = (srv.address() as { port: number }).port;
  const call = (path: string, body?: unknown, auth = true) =>
    fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: body ? "POST" : "GET", headers: { ...(auth ? { authorization: `Bearer ${daemon.token}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call("/api/overview", undefined, false)).status, 401);
    assert.equal((await call("/api/actions/doctor", {}, false)).status, 401);
    assert.equal((await call("/api/overview")).status, 200);
    const names = ((await (await call("/api/actions")).json()) as { name: string }[]).map((a) => a.name);
    assert.deepEqual(names.sort(), ["apply-advice", "apply-connection", "capture", "config-raw-preview", "config-raw-save", "config-reset", "config-set", "delete-captures", "doctor", "drift-accept", "eval-fidelity", "eval-run", "model-test", "plan-connection", "restore-backup", "set-mode", "set-server-mode", "set-tool-rule", "wrap-server"]);
    assert.ok(!names.some((n) => /shell|exec|cmd|command/.test(n)));
    assert.equal((await call("/api/actions/shell", { cmd: "id" })).status, 404);
    assert.equal(((await (await call("/api/actions/doctor", {})).json()) as { ok: boolean }).ok, false);
  } finally {
    srv.close();
  }
});
