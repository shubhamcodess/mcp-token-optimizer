import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dailyStats, readAudit, readRollups, rotateAudit, rollupPath, type AuditRow } from "../src/audit.js";
import { applyInPlace, createRuntime } from "../src/runtime.js";
import { installService, launchdPlist, platformOf, servicePath, systemdUnit } from "../src/service.js";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `mto-${p}-`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("applyInPlace keeps nested object identity and drops removed keys", () => {
  const llm = { model: "a", options: { x: 1 } };
  const target: any = { llm, mode: "active", gone: 1 };
  applyInPlace(target, { llm: { model: "b", options: { y: 2 } }, mode: "shadow" });
  assert.equal(target.llm, llm); // same object: holders of config.llm see the change
  assert.equal(llm.model, "b");
  assert.deepEqual(llm.options, { y: 2 });
  assert.equal(target.mode, "shadow");
  assert.ok(!("gone" in target));
});

test("hot reload: valid change applies live, invalid change is ignored, watcher picks up edits", async () => {
  const dir = tmp("reload");
  const file = join(dir, "config.yaml");
  const base = `audit:\n  path: ${join(dir, "s.jsonl")}\n`;
  writeFileSync(file, `${base}mode: active\nllm:\n  model: qwen3:4b\n`);
  const rt = createRuntime(file);
  const llmRef = rt.config.llm;
  assert.equal(rt.config.mode, "active");

  writeFileSync(file, `${base}mode: shadow\nllm:\n  model: granite4:3b\n`);
  assert.equal(rt.reload().ok, true);
  assert.equal(rt.config.mode, "shadow");
  assert.equal(llmRef.model, "granite4:3b"); // the LLM client's own config object changed

  writeFileSync(file, `${base}mode: banana\n`);
  const bad = rt.reload();
  assert.equal(bad.ok, false);
  assert.equal(rt.config.mode, "shadow"); // old config kept

  const seen: boolean[] = [];
  const stop = rt.watch((r) => seen.push(r.ok), 40);
  await sleep(100);
  writeFileSync(file, `${base}mode: off\n`);
  await sleep(250);
  stop();
  assert.deepEqual(seen, [true]);
  assert.equal(rt.config.mode, "off");
});

const row = (o: Partial<AuditRow>): AuditRow => ({ ts: new Date().toISOString(), server: "s", tool: "t", mode: "active", tokensIn: 100, tokensOut: 40, stages: ["prune"], lossy: false, redactions: {}, latencyMs: 1, ...o });
const writeRows = (path: string, rows: AuditRow[]) => writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const DAY = 864e5;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

test("audit rotation: old rows become daily rollups, recent rows stay, small logs are untouched", () => {
  const path = join(tmp("rot"), "stats.jsonl");
  const cfg = { path, maxMb: 0.0001, keepDays: 90 };
  writeRows(path, [row({ ts: iso(30), tokensIn: 1000, tokensOut: 400 }), row({ ts: iso(30), tokensIn: 500, tokensOut: 100 }), row({ ts: iso(30), tool: "mto_expand", stages: ["expand"], tokensIn: 0, tokensOut: 9 }), row({ ts: iso(1) }), row({ ts: iso(0) })]);
  const r = rotateAudit(cfg);
  assert.deepEqual([r.rotated, r.rolledUp], [true, 3]);
  assert.equal(readAudit(path).length, 2);
  assert.ok(!existsSync(path + ".rotating"));
  const roll = readRollups(path);
  const old = roll.find((x) => x.tool === "t")!;
  assert.deepEqual([old.calls, old.tokensIn, old.tokensOut], [2, 1500, 500]);
  assert.equal(roll.find((x) => x.tool === "mto_expand")!.expands, 1);
  assert.ok(existsSync(rollupPath(path)));

  // a second pass merges into the same day rows and a tiny log below the cap does nothing
  writeRows(path, [row({ ts: iso(30), tokensIn: 10, tokensOut: 5 })]);
  assert.equal(rotateAudit({ ...cfg, maxMb: 50 }).rotated, false);
  rotateAudit(cfg);
  assert.equal(readRollups(path).find((x) => x.tool === "t" && x.day === iso(30).slice(0, 10))!.calls, 3);
});

test("audit rotation: when everything is recent the older half is rolled up; ancient rollups expire", () => {
  const path = join(tmp("rot2"), "stats.jsonl");
  writeRows(path, Array.from({ length: 10 }, (_, i) => row({ ts: new Date(Date.now() - (10 - i) * 1000).toISOString() })));
  const r = rotateAudit({ path, maxMb: 0.0001, keepDays: 90 });
  assert.equal(r.rolledUp, 5);
  assert.equal(readAudit(path).length, 5);

  writeFileSync(rollupPath(path), JSON.stringify({ day: iso(400).slice(0, 10), server: "s", tool: "t", mode: "active", calls: 1, tokensIn: 1, tokensOut: 1, lossy: 0, expands: 0 }) + "\n");
  appendFileSync(path, JSON.stringify(row({ ts: iso(30) })) + "\n");
  rotateAudit({ path, maxMb: 0.0001, keepDays: 90 });
  assert.ok(readRollups(path).every((x) => x.day >= iso(90).slice(0, 10)));
});

test("dailyStats merges rollups with raw rows and skips shadow/expand", () => {
  const rollups = [{ day: iso(20).slice(0, 10), server: "s", tool: "t", mode: "active" as const, calls: 4, tokensIn: 400, tokensOut: 100, lossy: 0, expands: 0 }];
  const rows = [row({ ts: iso(0) }), row({ ts: iso(0), mode: "shadow" }), row({ ts: iso(0), stages: ["expand"] })];
  const d = dailyStats(rows, rollups);
  assert.deepEqual(d.map((x) => [x.calls, x.tokensIn]), [[4, 400], [1, 100]]);
});

test("service: unit files, paths, unsupported platforms", () => {
  const o = { node: "/usr/local/bin/node", cli: "/opt/my tools/mto/dist/cli.js", port: 8787, logPath: "/tmp/x.log" };
  const plist = launchdPlist(o);
  assert.match(plist, /<string>serve<\/string>/);
  assert.match(plist, /<string>\/opt\/my tools\/mto\/dist\/cli.js<\/string>/);
  assert.match(systemdUnit(o), /ExecStart=\/usr\/local\/bin\/node "\/opt\/my tools\/mto\/dist\/cli.js" serve --port 8787/);
  assert.equal(platformOf("win32"), "unsupported");
  assert.match(servicePath("launchd", "/h"), /\/h\/Library\/LaunchAgents\/com\.mto\.serve\.plist$/);
  assert.match(servicePath("systemd", "/h"), /\/h\/\.config\/systemd\/user\/mto-serve\.service$/);
  assert.equal(installService(o, "unsupported").ok, false);
});
