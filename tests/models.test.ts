import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Audit } from "../src/audit.js";
import { ConfigSchema } from "../src/config.js";
import { Daemon } from "../src/daemon.js";
import { startHttpProxy } from "../src/http.js";
import { ollamaModels, pullModel, testModel, validModelName } from "../src/llm.js";
import type { Runtime } from "../src/runtime.js";

async function fakeOllama() {
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const j = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen3:4b", size: 2.6e9, details: { family: "qwen3", parameter_size: "4B", quantization_level: "Q4_K_M" } }] }));
      if (req.url === "/api/chat") return void res.end(JSON.stringify({ message: { content: "api-gateway 2.14.1 failed on np-7 with E1137; rolled back to 2.13.9." }, done_reason: "stop", eval_count: 50, eval_duration: 1e9 }));
      if (req.url === "/api/pull") {
        if (j.model === "missing:1b") return void res.end(JSON.stringify({ error: "pull model manifest: file does not exist" }) + "\n");
        res.write(JSON.stringify({ status: "pulling", completed: 50, total: 100 }) + "\n");
        return void res.end(JSON.stringify({ status: "success" }) + "\n");
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, url: `http://127.0.0.1:${(srv.address() as { port: number }).port}` };
}

test("models: list, test and pull against a fake Ollama", async () => {
  const { srv, url } = await fakeOllama();
  try {
    const cfg = ConfigSchema.parse({ llm: { baseUrl: url } }).llm;
    const list = await ollamaModels(cfg);
    assert.deepEqual(list.models.map((m) => [m.name, m.parameterSize]), [["qwen3:4b", "4B"]]);

    const t = await testModel(cfg, "qwen3:4b");
    assert.equal(t.ok, true);
    assert.equal(t.factsKept, 5);
    assert.equal(t.tokensPerSec, 50);

    const seen: string[] = [];
    assert.equal((await pullModel(cfg, "llama3.2:3b", (p) => seen.push(p.status))).ok, true);
    assert.deepEqual(seen, ["pulling", "success"]);
    const bad = await pullModel(cfg, "missing:1b", () => undefined);
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /does not exist/);
    assert.equal((await pullModel(cfg, "bad name; rm -rf", () => undefined)).ok, false);
  } finally {
    srv.close();
  }
});

test("models: names are validated, ollama down is reported", async () => {
  for (const n of ["qwen3:4b", "hf.co/user/model:Q4", "llama3.2:3b"]) assert.ok(validModelName(n), n);
  for (const n of ["", "a b", "x;y", "../etc", "$(id)", 5, undefined]) assert.ok(!validModelName(n as never), String(n));
  const down = await ollamaModels(ConfigSchema.parse({ llm: { baseUrl: "http://127.0.0.1:1" } }).llm);
  assert.equal(down.ok, false);
});

test("daemon: model endpoints list, select (writes config, live) and reject bad names", async () => {
  const { srv: ollama, url } = await fakeOllama();
  const dir = mkdtempSync(join(tmpdir(), "mto-models-"));
  const cfgFile = join(dir, "config.yaml");
  writeFileSync(cfgFile, `llm:\n  baseUrl: ${url}\n`);
  const config = ConfigSchema.parse({ llm: { baseUrl: url }, audit: { path: join(dir, "s.jsonl") } });
  const rt = { config, configPath: cfgFile, audit: new Audit(config.audit) } as unknown as Runtime;
  const daemon = new Daemon(rt, { routesFile: join(dir, "routes.json") });
  const srv = await startHttpProxy(rt, { port: 0, daemon, routesFile: join(dir, "routes.json") });
  daemon.port = (srv.address() as { port: number }).port;
  const api = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${daemon.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try {
    const m = (await (await api("/api/models")).json()) as { models: { name: string }[]; active: string; activePulled: boolean };
    assert.equal(m.models[0].name, "qwen3:4b");
    assert.equal(m.activePulled, true);

    assert.equal((await api("/api/models/select", { model: "x; rm" })).status, 400);
    assert.equal((await api("/api/models/select", { model: "granite4:3b" })).status, 200); // not pulled is allowed
    assert.equal(rt.config.llm.model, "granite4:3b");
    assert.match(readFileSync(cfgFile, "utf8"), /model: granite4:3b/);

    const pull = await (await api("/api/models/pull", { model: "llama3.2:3b" })).text();
    assert.match(pull, /"status":"done"/);
    assert.equal((await api("/api/models/pull", { model: "a b" })).status, 400);
  } finally {
    srv.close();
    ollama.close();
  }
});
