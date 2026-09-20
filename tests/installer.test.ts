import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planOrApply } from "../src/installer.js";

test("init wraps stdio servers, wraps stdio + http, backs up; uninstall restores exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-inst-"));
  const file = join(dir, "mcp.json");
  const original = { mcpServers: { gh: { command: "npx", args: ["-y", "srv-github"], env: { T: "1" } }, remote: { url: "https://x/mcp" } } };
  writeFileSync(file, JSON.stringify(original, null, 2));
  const targets = [{ agent: "test", file, keyPath: "mcpServers" }];
  const base = { cliPath: "/opt/mto/cli.js", targets, routesFile: join(dir, "routes.json") };

  const dry = planOrApply({ ...base, mode: "wrap", apply: false });
  assert.deepEqual(dry.map((c) => c.action).sort(), ["wrap", "wrap-http"]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), original, "dry run must not write");

  planOrApply({ ...base, mode: "wrap", apply: true });
  const wrapped = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(wrapped.mcpServers.gh.command, process.execPath);
  assert.deepEqual(wrapped.mcpServers.gh.args, ["/opt/mto/cli.js", "wrap", "--name", "gh", "--", "npx", "-y", "srv-github"]);
  assert.deepEqual(wrapped.mcpServers.gh.env, { T: "1" });
  assert.deepEqual(wrapped.mcpServers.remote, { url: "http://127.0.0.1:8787/remote" });
  assert.ok(existsSync(`${file}.mto.bak`));

  assert.equal(planOrApply({ ...base, mode: "wrap", apply: true }).filter((c) => c.action === "wrap").length, 0, "idempotent");

  planOrApply({ ...base, mode: "unwrap", apply: true });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), original);
});

test("JSONC (VS Code mcp.json): comments + trailing commas survive wrap and unwrap", async () => {
  const { parse } = await import("jsonc-parser");
  const dir = mkdtempSync(join(tmpdir(), "mto-jsonc-"));
  const file = join(dir, "mcp.json");
  const original = `{
\t"servers": {
\t\t// "legacy": { "type": "sse", "url": "https://old" },
\t\t"shadcn": {
\t\t\t"command": "npx",
\t\t\t"args": ["shadcn@latest", "mcp"], // keep me
\t\t\t"type": "stdio",
\t\t},
\t\t"dev": { "command": "npm", "args": ["run", "dev"], "cwd": "/proj" },
\t\t"bare": { "command": "tool" },
\t\t"remote_api": { "type": "http", "url": "https://up/api/mcp", "headers": { "X-API-Key": "k" } },
\t},
\t"inputs": [],
}
`;
  writeFileSync(file, original);
  const o = { cliPath: "/x/cli.js", targets: [{ agent: "vscode", file, keyPath: "servers" }], routesFile: join(dir, "routes.json") };
  planOrApply({ ...o, mode: "wrap", apply: true });
  const wrapped = readFileSync(file, "utf8");
  assert.match(wrapped, /\/\/ "legacy"/, "commented-out block preserved");
  assert.match(wrapped, /\/\/ keep me/, "trailing comment preserved");
  const w: any = parse(wrapped);
  assert.equal(w.servers.dev.cwd, "/proj");
  assert.equal(w.servers.shadcn.type, "stdio");
  assert.equal(w.servers.remote_api.url, "http://127.0.0.1:8787/remote_api");
  assert.deepEqual(w.servers.remote_api.headers, { "X-API-Key": "k" });
  assert.equal(w.servers.bare.args.at(-1), "tool");

  planOrApply({ ...o, mode: "unwrap", apply: true });
  const restored = readFileSync(file, "utf8");
  assert.match(restored, /\/\/ "legacy"/);
  assert.match(restored, /\/\/ keep me/);
  assert.deepEqual(parse(restored), parse(original));
  assert.equal("args" in (parse(restored) as any).servers.bare, false, "args key not left behind");
});

test("unparsable files are reported and never modified", () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-bad-"));
  const file = join(dir, "mcp.json");
  writeFileSync(file, "{ servers: [ oops");
  const ch = planOrApply({ mode: "wrap", apply: true, cliPath: "/x/cli.js", targets: [{ agent: "t", file, keyPath: "servers" }], routesFile: join(dir, "r.json") });
  assert.equal(ch[0].action, "unparsable");
  assert.equal(readFileSync(file, "utf8"), "{ servers: [ oops");
});

test("discovery: explicit file with auto key path, ~ and env expansion, and scan", async () => {
  const { discover, parseTargetSpec, scanForConfigs, planOrApply: plan } = await import("../src/installer.js");
  const dir = mkdtempSync(join(tmpdir(), "mto-disc-"));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "proj", "deep"), { recursive: true });
  mkdirSync(join(dir, "proj", "node_modules", "x"), { recursive: true });
  const a = join(dir, "proj", "deep", "mcp.json");
  const b = join(dir, "proj", "settings.json");
  writeFileSync(a, JSON.stringify({ mcpServers: { s1: { command: "x" } } }));
  writeFileSync(b, `{ // vscode settings\n "editor.tabSize": 2, "mcp": { "servers": { "s2": { "type": "http", "url": "https://u/mcp" } } } }`);
  writeFileSync(join(dir, "proj", "node_modules", "x", "mcp.json"), "{}");
  assert.deepEqual(scanForConfigs(dir), [a], "scan finds mcp.json, skips node_modules");
  process.env.MTO_TEST_DIR = dir;
  const t1 = parseTargetSpec("$MTO_TEST_DIR/proj/deep/mcp.json");
  const t2 = parseTargetSpec(`${b}`);
  const d = discover([t1, t2]);
  assert.deepEqual(d.found.map((x) => [x.keyPath, x.servers.map((s) => s.name + ":" + s.kind)]), [["mcpServers", ["s1:stdio"]], ["mcp.servers", ["s2:http"]]]);
  plan({ mode: "wrap", apply: true, cliPath: "/x/cli.js", targets: [t1, t2], routesFile: join(dir, "r.json") });
  assert.match(readFileSync(b, "utf8"), /\/\/ vscode settings/);
  assert.match(readFileSync(b, "utf8"), /127\.0\.0\.1:8787\/s2/);
  assert.match(readFileSync(a, "utf8"), /"wrap"/);
});

test("config: ~ and $VARS in audit.path are expanded", async () => {
  const { loadConfig } = await import("../src/config.js");
  const dir = mkdtempSync(join(tmpdir(), "mto-cfg-"));
  const f = join(dir, "c.yaml");
  writeFileSync(f, "audit:\n  path: ~/.mto-test/stats.jsonl\n");
  const { homedir } = await import("node:os");
  assert.equal(loadConfig(f).config.audit.path, join(homedir(), ".mto-test/stats.jsonl"));
});
