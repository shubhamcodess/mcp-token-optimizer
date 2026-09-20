import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Audit } from "../src/audit.js";
import { ConfigSchema } from "../src/config.js";
import { startHttpProxy } from "../src/http.js";
import { Pipeline } from "../src/pipeline.js";
import type { Runtime } from "../src/runtime.js";
import { Session } from "../src/session.js";
import { OriginalStore } from "../src/store.js";

const issues = Array.from({ length: 40 }, (_, i) => ({ id: i, title: `Issue ${i}`, state: "open", body: null, node_id: `N${i}` }));

test("http proxy: forwards headers, optimizes JSON + SSE, injects mto_expand, guards host & routes", async () => {
  const seen: Record<string, string | undefined>[] = [];
  const upstream = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ key: req.headers["x-api-key"] as string, sid: req.headers["mcp-session-id"] as string });
      const m = JSON.parse(raw);
      const reply = (result: unknown, sse = false) => {
        const payload = JSON.stringify({ jsonrpc: "2.0", id: m.id, result });
        if (sse) {
          res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "S1" });
          res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\n`);
          res.end(`event: message\nid: 7\ndata: ${payload}\n\n`);
        } else {
          res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "S1" });
          res.end(payload);
        }
      };
      if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "u", version: "1" } });
      else if (m.method === "tools/list") reply({ tools: [{ name: "list_issues", inputSchema: { type: "object" } }] });
      else if (m.method === "tools/call") reply({ content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] }, req.headers["x-mode"] === "sse");
      else (res.writeHead(202), res.end());
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = (upstream.address() as { port: number }).port;

  const dir = mkdtempSync(join(tmpdir(), "mto-http-"));
  const routesFile = join(dir, "routes.json");
  writeFileSync(routesFile, JSON.stringify({ demo: { url: `http://127.0.0.1:${upPort}/api/mcp` } }));
  const config = ConfigSchema.parse({ audit: { enabled: false } });
  const store = new OriginalStore(60_000, 50, join(dir, "store"));
  const pipeline = new Pipeline(config, { available: () => false, complete: async () => ({ text: "", truncated: false }) }, store);
  const audit = new Audit(config.audit);
  const rt: Runtime = { config, pipeline, store, audit, newSession: (n) => new Session(n, config, pipeline, audit, store), warm: async () => {} };
  const proxy = await startHttpProxy(rt, { port: 0, routesFile });
  const base = `http://127.0.0.1:${(proxy.address() as { port: number }).port}/demo`;

  const post = (body: object, headers: Record<string, string> = {}) =>
    fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": "SECRET", ...headers }, body: JSON.stringify(body) });

  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.match((await init.json() as any).result.instructions, /TOON/);
  assert.equal(seen[0].key, "SECRET", "client headers must reach upstream");

  const list = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "S1" })).json() as any;
  assert.ok(list.result.tools.some((t: any) => t.name === "mto_expand"));
  assert.equal(seen[1].sid, "S1");

  const j = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_issues" } }, { "mcp-session-id": "S1" })).json() as any;
  assert.match(j.result.content[0].text, /^\[40\]/);
  assert.doesNotMatch(j.result.content[0].text.split(/\n\[mto: /)[0], /node_id/);

  const sseRes = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_issues" } }, { "mcp-session-id": "S1", "x-mode": "sse" });
  assert.match(sseRes.headers.get("content-type")!, /event-stream/);
  const sse = await sseRes.text();
  assert.match(sse, /notifications\/progress/, "non-response events pass through");
  assert.match(sse, /id: 7/, "SSE metadata preserved");
  assert.doesNotMatch(sse.split("[mto: ")[0], /node_id/);
  assert.match(sse, /\\"?\[40\]|\[40\]/);

  const local = await (await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "mto_expand", arguments: { id: "000000000000" } } }, { "mcp-session-id": "S1" })).json() as any;
  assert.equal(local.result.isError, true);
  assert.equal(seen.length, 5 - 1, "mto_expand is answered locally, not forwarded");

  const badRoute = await fetch(base.replace("demo", "nope"), { method: "POST", body: "{}" });
  assert.equal(badRoute.status, 404);
  const rebind = await new Promise<number>((res) => {
    import("node:http").then(({ request }) => {
      const r = request({ host: "127.0.0.1", port: (proxy.address() as { port: number }).port, path: "/demo", method: "POST", headers: { host: "evil.example.com" } }, (x) => res(x.statusCode!));
      r.end("{}");
    });
  });
  assert.equal(rebind, 403);

  proxy.close();
  upstream.close();
});

test("init: repoints http servers at the proxy, keeps headers, is reversible; sse type skipped", async () => {
  const { planOrApply } = await import("../src/installer.js");
  const { readFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "mto-http-init-"));
  const file = join(dir, "mcp.json");
  const original = { servers: { demo: { type: "http", url: "https://up.example.com/api/mcp", headers: { "X-API-Key": "k" } }, old: { type: "sse", url: "https://x/sse" } } };
  writeFileSync(file, JSON.stringify(original, null, 2));
  const o = { cliPath: "/x/cli.js", targets: [{ agent: "vscode", file, keyPath: "servers" }], routesFile: join(dir, "routes.json") };
  planOrApply({ ...o, mode: "wrap", apply: true });
  const w = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(w.servers.demo.url, "http://127.0.0.1:8787/demo");
  assert.deepEqual(w.servers.demo.headers, { "X-API-Key": "k" });
  assert.deepEqual(w.servers.old, original.servers.old);
  planOrApply({ ...o, mode: "unwrap", apply: true });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), original);
});
