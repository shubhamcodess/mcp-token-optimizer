import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAction } from "../src/actions.js";
import { Audit, type AuditRow } from "../src/audit.js";
import { ConfigSchema } from "../src/config.js";
import { describeConfig } from "../src/configForm.js";
import { listConnections, previewConnection, restoreBackup } from "../src/connections.js";
import { Daemon } from "../src/daemon.js";
import { startHttpProxy } from "../src/http.js";
import type { AgentTarget } from "../src/installer.js";
import { lineDiff } from "../src/lineDiff.js";
import { ROUTES_FILE } from "../src/routes.js";
import type { Runtime } from "../src/runtime.js";
import { buildToolTable } from "../src/tools.js";

const tmp = (p = "scr") => mkdtempSync(join(tmpdir(), `mto-${p}-`));
const CLI = "/opt/mto/dist/cli.js";

test("lineDiff: marks added and removed lines with context, empty when equal", () => {
  assert.equal(lineDiff("a\nb", "a\nb"), "");
  const d = lineDiff("a\nb\nc\nd\ne\nf\ng", "a\nb\nc\nX\ne\nf\ng");
  assert.match(d, /- d/);
  assert.match(d, /\+ X/);
  assert.match(d, /  c/);
});

const JSONC = `{
  // my servers
  "mcpServers": {
    "gh": { "command": "npx", "args": ["-y", "gh-mcp"] }, // keep this comment
    "remote": { "type": "http", "url": "https://up.example/mcp" },
    "ghost": { "type": "http", "url": "http://127.0.0.1:8787/ghost" }
  }
}
`;
const agent = (dir: string): AgentTarget => {
  const file = join(dir, "mcp.json");
  writeFileSync(file, JSONC);
  return { agent: "TestAgent", file, keyPath: "mcpServers" };
};

test("connections: tree with status, dry-run diff that writes nothing, apply keeps JSONC comments, backup restore", async () => {
  const dir = tmp("conn");
  const t = agent(dir);
  const routesBefore = existsSync(ROUTES_FILE) ? readFileSync(ROUTES_FILE, "utf8") : null;
  const cfg = ConfigSchema.parse({ tools: { "gh.*": { mode: "shadow" } } });
  const tree = listConnections([t], cfg, join(dir, "routes.json"));
  const byName = Object.fromEntries(tree.files[0].servers.map((s) => [s.name, s]));
  assert.equal(byName.gh.status, "unprotected");
  assert.equal(byName.ghost.status, "proxy-down"); // routed to the local proxy but no such route
  assert.equal(byName.gh.mode, "shadow"); // from tools."gh.*".mode

  const before = readFileSync(t.file, "utf8");
  const prev = previewConnection("wrap", "gh", [t], CLI);
  assert.deepEqual(prev.changes.map((c) => c.action), ["wrap"]);
  assert.equal(prev.changes[0].file, t.file); // reports the real file, not the temp copy
  assert.match(prev.diffs[0].diff, /\+.*wrap/);
  assert.equal(readFileSync(t.file, "utf8"), before); // dry run wrote nothing
  assert.equal(existsSync(ROUTES_FILE) ? readFileSync(ROUTES_FILE, "utf8") : null, routesBefore); // and no real routes.json

  const rt = { config: cfg, configPath: join(dir, "c.yaml"), audit: new Audit(ConfigSchema.parse({ audit: { enabled: false } }).audit), reload: () => ({ ok: true }) } as unknown as Runtime;
  const env = { targets: () => [t], cliPath: CLI };
  assert.equal((await runAction(rt, "apply-connection", { op: "wrap", server: "gh" }, env)).status, 200);
  const after = readFileSync(t.file, "utf8");
  assert.match(after, /"wrap"/);
  assert.match(after, /\/\/ my servers/);
  assert.match(after, /\/\/ keep this comment/); // JSONC comments survive
  assert.ok(existsSync(t.file + ".mto.bak"));

  assert.equal(restoreBackup("/etc/passwd", [t]).ok, false); // only known agent files
  assert.equal(restoreBackup(t.file, [t]).ok, true);
  assert.equal(readFileSync(t.file, "utf8"), before);
  assert.ok(existsSync(t.file + ".mto.pre-restore"));
});

test("connection actions: servers must exist, modes validated, soft-disconnect writes the config", async () => {
  const dir = tmp("conn2");
  const t = agent(dir);
  const cfgFile = join(dir, "config.yaml");
  writeFileSync(cfgFile, "# top\nmode: active\n");
  const config = ConfigSchema.parse({});
  const rt = { config, configPath: cfgFile, audit: new Audit(ConfigSchema.parse({ audit: { enabled: false } }).audit), reload: () => ({ ok: true }) } as unknown as Runtime;
  const env = { targets: () => [t], cliPath: CLI };
  assert.equal((await runAction(rt, "plan-connection", { op: "wrap", server: "nope" }, env)).status, 404);
  assert.equal((await runAction(rt, "plan-connection", { op: "rm", server: "gh" }, env)).status, 400);
  assert.equal((await runAction(rt, "set-server-mode", { server: "gh", mode: "banana" }, env)).status, 400);
  assert.equal((await runAction(rt, "restore-backup", { file: "/etc/hosts" }, env)).status, 400);
  assert.equal((await runAction(rt, "set-server-mode", { server: "gh", mode: "off" }, env)).status, 200);
  assert.match(readFileSync(cfgFile, "utf8"), /# top/);
  assert.match(readFileSync(cfgFile, "utf8"), /gh\.\*[\s\S]*mode: off/);
  assert.equal((await runAction(rt, "set-server-mode", { server: "gh", mode: "default" }, env)).status, 200);
  assert.ok(!/mode: off/.test(readFileSync(cfgFile, "utf8")));
});

const rtFor = (cfgText: string) => {
  const dir = tmp("cfg");
  const file = join(dir, "config.yaml");
  writeFileSync(file, cfgText);
  const config = ConfigSchema.parse({ audit: { enabled: false } });
  return { file, rt: { config, configPath: file, audit: new Audit(config.audit), reload: () => ({ ok: true }) } as unknown as Runtime };
};

test("config form: generated from the schema, every section present, protected keys read-only; set/reset/raw are validated", async () => {
  const cfg = ConfigSchema.parse({});
  const fields = describeConfig(cfg);
  const sections = new Set(fields.map((f) => f.section));
  for (const s of Object.keys(ConfigSchema.shape)) assert.ok(sections.has(s), `section ${s}`);
  assert.deepEqual(fields.find((f) => f.path === "mode")!.options, ["active", "shadow", "off"]);
  assert.equal(fields.find((f) => f.path === "summarize.enabled")!.kind, "boolean");
  assert.equal(fields.find((f) => f.path === "prune.dropKeys")!.kind, "string-list");
  assert.equal(fields.find((f) => f.path === "tools")!.readOnly, true);

  const { file, rt } = rtFor("# keep me\nmode: active # inline\n");
  assert.equal((await runAction(rt, "config-set", { path: "summarize.enabled", value: false })).status, 200);
  assert.equal((await runAction(rt, "config-set", { path: "mode", value: "banana" })).status, 400);
  for (const p of ["audit.path", "llm.baseUrl", "discovery.files", "tools.x.mode", "no.such.key"]) assert.equal((await runAction(rt, "config-set", { path: p, value: "x" })).status, 400, p);
  assert.match(readFileSync(file, "utf8"), /# keep me/);
  assert.match(readFileSync(file, "utf8"), /# inline/);

  assert.equal((await runAction(rt, "config-reset", { section: "summarize" })).status, 200);
  assert.ok(!/summarize/.test(readFileSync(file, "utf8")));
  assert.match(readFileSync(file, "utf8"), /# keep me/);
  assert.equal((await runAction(rt, "config-reset", { section: "nope" })).status, 400);

  const bad = (await runAction(rt, "config-raw-preview", { yaml: "mode: banana\n" })).body as { ok: boolean; error?: string };
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /mode/);
  assert.equal(((await runAction(rt, "config-raw-preview", { yaml: "mode: [unclosed" })).body as { ok: boolean }).ok, false);
  const good = (await runAction(rt, "config-raw-preview", { yaml: "# keep me\nmode: shadow\n" })).body as { ok: boolean; diff: string };
  assert.ok(good.ok && /\+ mode: shadow/.test(good.diff));
  assert.equal((await runAction(rt, "config-raw-save", { yaml: "mode: banana" })).status, 400);
  assert.equal((await runAction(rt, "config-raw-save", { yaml: "# keep me\nmode: shadow\n" })).status, 200);
  assert.match(readFileSync(file, "utf8"), /mode: shadow/);
});

const row = (o: Partial<AuditRow>): AuditRow => ({ ts: new Date().toISOString(), server: "gh", tool: "list", mode: "active", tokensIn: 1000, tokensOut: 400, stages: ["prune"], lossy: false, redactions: {}, latencyMs: 10, ...o });

test("tool rules: edit the matching existing glob, validate, clear with null; table shows rule and expands", async () => {
  const { file, rt } = rtFor('tools:\n  "gh.*":\n    mode: shadow\n');
  rt.config.tools = { "gh.*": { mode: "shadow" } } as never;
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "gh.list", field: "maxArrayItems", value: 50 })).status, 200);
  assert.match(readFileSync(file, "utf8"), /"gh\.\*":[\s\S]*maxArrayItems: 50/); // went to the existing glob, not a new key
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "other.tool", field: "format", value: "json-pretty" })).status, 200);
  assert.match(readFileSync(file, "utf8"), /other\.tool/);
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "gh.list", field: "format", value: "xml" })).status, 400);
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "gh.list", field: "command", value: "x" })).status, 400);
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "bad name!", field: "mode", value: "off" })).status, 400);
  assert.equal((await runAction(rt, "set-tool-rule", { tool: "gh.list", field: "maxArrayItems", value: null })).status, 200);
  assert.ok(!/maxArrayItems/.test(readFileSync(file, "utf8")));

  const table = buildToolTable([row({}), row({ lossy: true }), row({ tool: "mto_expand", stages: ["expand"], expandOf: "list", tokensIn: 0 }), row({ tool: "tools/list", stages: ["tools-list"] })], rt.config);
  assert.equal(table.length, 1);
  assert.deepEqual([table[0].tool, table[0].calls, table[0].expands, table[0].lossyPct, table[0].ruleKey], ["gh.list", 2, 1, 50, "gh.*"]);
});

test("captures: listed, redacted on display, deleted for real; only .jsonl files in the captures folder", async () => {
  const dir = tmp("cap");
  const capDir = join(dir, "captures");
  mkdirSync(capDir);
  const sample = (text: string, optimized?: string) => JSON.stringify({ ts: new Date().toISOString(), server: "gh", tool: "get", hasOutputSchema: false, result: { content: [{ type: "text", text }] }, ...(optimized ? { optimized: { content: [{ type: "text", text: optimized }] } } : {}) });
  writeFileSync(join(capDir, "gh.jsonl"), sample('{"a":1,"key":"AKIAIOSFODNN7EXAMPLE"}', '{"a":1}') + "\n" + sample("plain") + "\n");
  writeFileSync(join(capDir, "notes.txt"), "keep");

  const config = ConfigSchema.parse({ audit: { path: join(dir, "s.jsonl") } });
  const rt = { config, configPath: join(dir, "c.yaml"), audit: new Audit(config.audit) } as unknown as Runtime;
  const daemon = new Daemon(rt, { captureDir: capDir, routesFile: join(dir, "r.json") });
  const srv = await startHttpProxy(rt, { port: 0, daemon, routesFile: join(dir, "r.json") });
  daemon.port = (srv.address() as { port: number }).port;
  const call = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${daemon.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try {
    const list = (await (await call("/api/captures")).json()) as { total: number; items: { id: number }[] };
    assert.equal(list.total, 2);
    const detail = (await (await call(`/api/captures/${list.items.find((i) => i.id === 0)!.id}`)).json()) as { original: string; received: string; verdict: string };
    assert.ok(!detail.original.includes("AKIAIOSFODNN7EXAMPLE")); // redacted on display
    assert.match(detail.original, /REDACTED/);
    assert.ok(detail.verdict);
    assert.equal((await call("/api/captures/99")).status, 404);

    const del = (await (await call("/api/actions/delete-captures", {})).json()) as { deleted: number };
    assert.equal(del.deleted, 1);
    assert.deepEqual(readdirSync(capDir), ["notes.txt"]); // the capture file is really gone; nothing else touched
    assert.equal(((await (await call("/api/captures")).json()) as { total: number }).total, 0);

    assert.equal((await call("/api/traffic")).status, 200);
    assert.equal((await call("/api/connections")).status, 200);
    assert.equal(((await (await call("/api/config/form")).json()) as { fields: unknown[] }).fields.length > 30, true);
  } finally {
    srv.close();
  }
  assert.ok(statSync(capDir).isDirectory());
});
