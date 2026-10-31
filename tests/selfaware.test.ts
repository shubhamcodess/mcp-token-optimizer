import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAction } from "../src/actions.js";
import { buildAdvice } from "../src/advisor.js";
import { Audit, formatReport, toolDefinitionCosts, type AuditRow } from "../src/audit.js";
import { clientProfile, ConfigSchema } from "../src/config.js";
import { Daemon } from "../src/daemon.js";
import { acceptDrift, checkDrift, wrapServer } from "../src/drift.js";
import type { AgentTarget } from "../src/installer.js";
import { Pipeline } from "../src/pipeline.js";
import { buildOverview } from "../src/overview.js";
import type { Runtime } from "../src/runtime.js";
import { Session } from "../src/session.js";
import { OriginalStore } from "../src/store.js";
import { estimateTokens } from "../src/tokens.js";

const tmp = (p = "sa") => mkdtempSync(join(tmpdir(), `mto-${p}-`));

// ---------- #33 client profiles

test("client profiles: built-in VS Code entry, user entries win, empty entry disables", () => {
  const cfg = ConfigSchema.parse({});
  assert.equal(clientProfile(cfg, "Visual Studio Code")?.profile.prettyJsonAboveTokens, 8000);
  assert.match(clientProfile(cfg, "Visual Studio Code - Insiders")?.source ?? "", /README section 7/); // cites its measurement
  assert.equal(clientProfile(cfg, "claude-code"), undefined);
  assert.equal(clientProfile(cfg, undefined), undefined);
  const custom = ConfigSchema.parse({ clients: { "claude-*": { profile: "conservative" }, "visual studio code*": {} } });
  assert.equal(clientProfile(custom, "claude-code")?.profile.profile, "conservative");
  assert.equal(clientProfile(custom, "Visual Studio Code"), undefined); // built-in switched off
});

const bigList = Array.from({ length: 300 }, (_, i) => ({ id: i, number: i, title: `Issue number ${i} with some words`, state: "open", node_id: `MDU6SXNzdWU${i}`, user: { login: "octo", avatar_url: "https://a/x", gravatar_id: "" } }));

function sessionFor(client: string, rows: AuditRow[]) {
  const dir = tmp();
  const config = ConfigSchema.parse({ audit: { enabled: false }, summarize: { enabled: false } });
  const audit = new Audit(config.audit);
  audit.onWrite(() => undefined);
  (audit as any).write = (r: AuditRow) => rows.push(r); // capture rows without touching disk
  const store = new OriginalStore(60_000, 50, join(dir, "store"));
  const pipeline = new Pipeline(config, { available: () => false, complete: async () => ({ text: "", truncated: false }) }, store);
  const s = new Session("gh", config, pipeline, audit, store);
  s.fromClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: client } } });
  return s;
}
const callTool = async (s: Session, id: number, tool = "list_issues") => {
  s.fromClient({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool } });
  const out = await s.fromServer({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(bigList) }] } });
  return (out.result as any).content[0].text as string;
};

test("per-client format: the same tool result differs between VS Code and another client; the row names the profile", async () => {
  const rowsA: AuditRow[] = [];
  const rowsB: AuditRow[] = [];
  const vscode = await callTool(sessionFor("Visual Studio Code", rowsA), 2);
  const other = await callTool(sessionFor("some-other-agent", rowsB), 2);
  assert.notEqual(vscode, other);
  assert.doesNotThrow(() => JSON.parse(vscode)); // pretty JSON an agent can json.load
  assert.ok(vscode.includes('\n  '));
  assert.throws(() => JSON.parse(other)); // default auto picks TOON here
  assert.equal(rowsA.at(-1)!.profile, "visual studio code*");
  assert.equal(rowsB.at(-1)!.profile, undefined);
});

// ---------- #37 tools/list cost

test("tools/list cost is recorded from the real payload and definitions are not modified", async () => {
  const rows: AuditRow[] = [];
  const s = sessionFor("x", rows);
  const tools = [{ name: "a", description: "Does a thing", inputSchema: { type: "object", properties: { q: { type: "string", title: "Q" } } } }, { name: "b", description: "Other", inputSchema: { type: "object" } }];
  s.fromClient({ jsonrpc: "2.0", id: 5, method: "tools/list" });
  const out = await s.fromServer({ jsonrpc: "2.0", id: 5, result: { tools } });
  const r = rows.find((x) => x.stages.includes("tools-list"))!;
  assert.equal(r.tokensIn, estimateTokens(JSON.stringify(tools)));
  assert.deepEqual((out.result as any).tools.slice(0, 2), tools); // untouched (mto_expand is appended after them)
  assert.deepEqual(toolDefinitionCosts(rows), [{ server: "gh", tokens: r.tokensIn, client: "x" }]);
  // not counted as a tool call anywhere
  assert.equal(buildOverview(rows).totals.calls, 0);
  assert.equal(buildOverview(rows).toolDefinitions[0].tokens, r.tokensIn);
  assert.match(formatReport(rows.concat({ ...r, stages: ["prune"], tool: "t" }), 3), /Tool definitions \(tools\/list/);
});

// ---------- expand attribution + #35 advisor

test("expand rows are attributed to the tool whose note carried the id", async () => {
  const rows: AuditRow[] = [];
  const s = sessionFor("x", rows);
  const text = await callTool(s, 2, "list_issues");
  const id = /mto_expand \{\\*"id\\*":\\*"([0-9a-f]+)/.exec(text)?.[1];
  assert.ok(id, "result carries a note id");
  s.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mto_expand", arguments: { id } } });
  assert.equal(rows.find((r) => r.tool === "mto_expand")!.expandOf, "list_issues");
});

const row = (o: Partial<AuditRow>): AuditRow => ({ ts: new Date().toISOString(), server: "gh", tool: "t", mode: "active", tokensIn: 1000, tokensOut: 400, stages: ["prune"], lossy: false, redactions: {}, latencyMs: 5, ...o });
const expandRow = (tool: string, out = 100): AuditRow => row({ tool: "mto_expand", stages: ["expand"], tokensIn: 0, tokensOut: out, expandOf: tool });

test("advisor: deterministic rules with the numbers behind each recommendation", () => {
  const calls = (tool: string, n: number, o: Partial<AuditRow> = {}) => Array.from({ length: n }, () => row({ tool, ...o }));
  const rows = [
    ...calls("heavy", 6), ...Array.from({ length: 4 }, () => expandRow("heavy")), // 4 of 6 expanded, still net positive
    ...calls("loss", 5, { tokensIn: 500, tokensOut: 400 }), ...Array.from({ length: 3 }, () => expandRow("loss", 900)), // expands cost more than saved
    ...calls("slow", 4, { stages: ["summarize(m)"], latencyMs: 9000 }),
    ...calls("fine", 8), expandRow("fine"),
    ...calls("few", 2), expandRow("few"), expandRow("few"),
    ...calls("shadowed", 6, { mode: "shadow" }),
    row({ tool: "tools/list", stages: ["tools-list"], tokensIn: 4500, tokensOut: 4600, server: "big" }),
  ];
  const adv = buildAdvice(rows);
  const byId = Object.fromEntries(adv.map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(byId).sort(), ["high-expand:gh.heavy", "negative-net:gh.loss", "slow-summarize:gh.slow", "tool-definitions:big"]);
  assert.equal(byId["high-expand:gh.heavy"].numbers.expands, 4);
  assert.equal(byId["high-expand:gh.heavy"].numbers.calls, 6);
  assert.deepEqual(byId["high-expand:gh.heavy"].apply, { key: 'tools."gh.heavy".profile', value: "conservative", label: "Use the conservative profile for this tool" });
  assert.equal(byId["negative-net:gh.loss"].numbers.netSaved, 5 * 100 - 3 * 900);
  assert.equal(byId["negative-net:gh.loss"].apply?.value, "shadow");
  assert.equal(byId["tool-definitions:big"].apply, undefined);
  assert.equal(adv[0].severity, "warn"); // warnings first
  assert.deepEqual(buildAdvice([]), []);
});

test("apply-advice only applies a recommendation the advisor currently produces", async () => {
  const dir = tmp("adv");
  const audit = join(dir, "s.jsonl");
  const rows = [...Array.from({ length: 6 }, () => row({ tool: "heavy" })), ...Array.from({ length: 4 }, () => expandRow("heavy"))];
  writeFileSync(audit, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const config = ConfigSchema.parse({ audit: { path: audit } });
  const cfgFile = join(dir, "config.yaml");
  writeFileSync(cfgFile, `audit:\n  path: ${audit}\n`);
  const rt = { config, configPath: cfgFile, audit: new Audit(config.audit), reload: () => ({ ok: true }) } as unknown as Runtime;
  assert.equal((await runAction(rt, "apply-advice", { id: "nope" })).status, 404);
  assert.equal((await runAction(rt, "apply-advice", { id: "x", key: "mode", value: "off" })).status, 404); // client cannot supply key/value
  const ok = await runAction(rt, "apply-advice", { id: "high-expand:gh.heavy" });
  assert.equal(ok.status, 200);
  assert.match(readFileSync(cfgFile, "utf8"), /gh\.heavy[\s\S]*profile: conservative/);
});

// ---------- #34 drift

const agentFile = (dir: string, name: string, servers: object): AgentTarget => {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
  return { agent: name, file, keyPath: "mcpServers" };
};
const setServers = (t: AgentTarget, servers: object) => writeFileSync(t.file, JSON.stringify({ mcpServers: servers }, null, 2));
const CLI = "/opt/mto/dist/cli.js";
const wrapped = (name: string) => ({ command: "node", args: [CLI, "wrap", "--name", name, "--", "npx", name] });

test("drift: baseline, new unwrapped server, removed wrapper, dead proxy, accept; agent configs are never touched", () => {
  const dir = tmp("drift");
  const baselineFile = join(dir, "baseline.json");
  const t = agentFile(dir, "agentA", { one: { command: "npx", args: ["one"] }, two: wrapped("two") });
  const before = readFileSync(t.file, "utf8");
  const check = (daemonUp = true) => checkDrift({ targets: [t], baselineFile, daemonUp });

  assert.deepEqual(check(), []); // first run records the baseline
  assert.deepEqual(check(), []);
  setServers(t, { one: { command: "npx", args: ["one"] }, two: wrapped("two"), three: { command: "npx", args: ["three"] } });
  assert.deepEqual(check().map((f) => [f.kind, f.server]), [["new-unwrapped", "three"]]);
  assert.deepEqual(check().map((f) => f.kind), ["new-unwrapped"]); // keeps reporting until handled

  setServers(t, { one: { command: "npx", args: ["one"] }, two: { command: "npx", args: ["two"] } }); // agent update stripped the wrapper
  assert.deepEqual(check().map((f) => [f.kind, f.server]), [["wrapper-removed", "two"]]);

  assert.equal(acceptDrift([t], baselineFile), 2);
  assert.deepEqual(check(), []);

  setServers(t, { remote: { type: "http", url: "http://127.0.0.1:8787/remote" } });
  acceptDrift([t], baselineFile);
  assert.deepEqual(check(true), []);
  assert.deepEqual(check(false).map((f) => f.kind), ["dead-proxy"]);
  assert.notEqual(readFileSync(t.file, "utf8"), before); // (only because this test rewrote it above)
});

test("drift: wrapServer wraps on request and makes a backup; findings clear", () => {
  const dir = tmp("drift2");
  const baselineFile = join(dir, "baseline.json");
  const t = agentFile(dir, "agentB", { one: wrapped("one") });
  checkDrift({ targets: [t], baselineFile, daemonUp: true });
  setServers(t, { one: wrapped("one"), fresh: { command: "npx", args: ["fresh"] } });
  assert.equal(checkDrift({ targets: [t], baselineFile, daemonUp: true }).length, 1);
  const changes = wrapServer("fresh", [t], CLI);
  assert.deepEqual(changes.map((c) => c.action), ["wrap"]);
  assert.ok(existsSync(t.file + ".mto.bak"));
  assert.deepEqual(checkDrift({ targets: [t], baselineFile, daemonUp: true }), []);
});

test("daemon drift: watcher reports findings; autoWrap is opt-in per agent; wrap-server only for listed servers", async () => {
  const dir = tmp("drift3");
  const baselineFile = join(dir, "baseline.json");
  const a = agentFile(dir, "Alpha Agent", { base: wrapped("base") });
  const b = agentFile(dir, "Beta Agent", { base: wrapped("base") });
  checkDrift({ targets: [a, b], baselineFile, daemonUp: true });
  setServers(a, { base: wrapped("base"), newA: { command: "npx", args: ["a"] } });
  setServers(b, { base: wrapped("base"), newB: { command: "npx", args: ["b"] } });

  const config = ConfigSchema.parse({ audit: { path: join(dir, "s.jsonl") }, drift: { autoWrap: ["alpha"] } });
  const rt = { config, configPath: join(dir, "c.yaml"), audit: new Audit(config.audit) } as unknown as Runtime;
  const d = new Daemon(rt, { targets: () => [a, b], cliPath: CLI, baselineFile });
  const log: string[] = [];
  const stop = d.startDriftWatch((m) => log.push(m));
  stop();
  assert.match(log.join(), /auto-wrapped "newA" in Alpha Agent/);
  assert.match(readFileSync(a.file, "utf8"), /"wrap"/); // opted-in agent was wrapped
  assert.ok(!/"wrap"/.test(readFileSync(b.file, "utf8").split("newB")[1] ?? "")); // other agent untouched
  assert.deepEqual(d.drift.findings.map((f) => f.server), ["newB"]);

  assert.equal((await runAction(rt, "wrap-server", { server: "not-listed" }, { targets: () => [a, b], cliPath: CLI, baselineFile })).status, 404);
  assert.equal((await runAction(rt, "wrap-server", { server: "newB" }, { targets: () => [a, b], cliPath: CLI, baselineFile })).status, 200);
  assert.match(readFileSync(b.file, "utf8").split("newB")[1], /"wrap"/);
});
