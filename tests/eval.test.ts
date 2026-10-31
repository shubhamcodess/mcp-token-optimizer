import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAction } from "../src/actions.js";
import { Audit } from "../src/audit.js";
import { runBench } from "../src/bench.js";
import { defaultConfig } from "../src/config.js";
import { Daemon } from "../src/daemon.js";
import { checkFidelity, checkGates, exampleSamples, jsonPathGet, parseThresholds, runEval, type EvalResult } from "../src/eval.js";
import { diffRuns, readRuns, saveRun } from "../src/evalHistory.js";
import { startHttpProxy } from "../src/http.js";
import type { Runtime } from "../src/runtime.js";

const tmp = (p = "ev") => mkdtempSync(join(tmpdir(), `mto-${p}-`));
const BASELINE = JSON.parse(readFileSync("tests/eval-baseline.json", "utf8"));
const cli = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, MTO_HOME: tmp("home"), MTO_NO_DAEMON: "1", ...env } });

test("regression suite: the synthetic examples match the expected numbers and verdicts", async () => {
  const r = await runEval(exampleSamples(), defaultConfig());
  assert.deepEqual(checkGates(r, { lossless: 100 }, BASELINE), { ok: true, failures: [] });
  assert.equal(r.totals.lossless.ok, 7);
  const issues = r.rows.find((x) => x.key === "demo.list_issues")!;
  assert.equal(issues.verdict, "pruned-data"); // named fields dropped, listed
  assert.ok(issues.dataDropped.some((d) => d.path.endsWith("node_id")));
  assert.equal(r.rows.find((x) => x.key === "demo.get_rows")!.verdict, "unchanged"); // structured result stays a contract
});

test("eval matches bench for the same inputs", async () => {
  const samples = exampleSamples();
  const cfg = defaultConfig();
  const e = await runEval(samples, cfg);
  const b = await runBench(samples, cfg, { llm: false });
  assert.equal(e.totals.tokensIn, b.reduce((a, r) => a + r.tin, 0));
  assert.equal(e.totals.tokensOut, b.reduce((a, r) => a + r.tout, 0));
  for (const row of b) assert.equal(e.rows.find((x) => x.key === row.key)!.tokensOut, row.tout);
});

test("a deliberate regression fails the gates, in code and through the CLI (CI behaviour)", async () => {
  // conservative profile saves much less on the issue list: the baseline catches it
  const bad = await runEval(exampleSamples(), { ...defaultConfig(), profile: "conservative" });
  const gate = checkGates(bad, {}, BASELINE);
  assert.equal(gate.ok, false);
  assert.match(gate.failures.join("\n"), /demo\.list_issues: saved/);

  const dir = tmp("regress");
  writeFileSync(join(dir, "bad.yaml"), "profile: conservative\n");
  const ok = cli(["eval", "--examples", "--baseline", "tests/eval-baseline.json", "--fail-under", "lossless=100"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS/);
  const fail = cli(["eval", "--examples", "--baseline", "tests/eval-baseline.json", "--config", join(dir, "bad.yaml")]);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /FAIL demo\.list_issues/);
  const thr = cli(["eval", "--examples", "--fail-under", "savings=99"]);
  assert.equal(thr.status, 1);
  assert.equal(cli(["eval", "--examples", "--fail-under", "bogus=1"]).status, 2);
  const json = JSON.parse(cli(["eval", "--examples", "--json"]).stdout);
  assert.equal(json.gate.ok, true);
  assert.equal(json.rows.length, 7);
});

test("gates: thresholds for savings, lossless and facts; facts ignored when no text was summarized", () => {
  const r = { samples: 4, totals: { tokensIn: 100, tokensOut: 60, savedPct: 40, lossy: 0, lossless: { ok: 3, total: 4, pct: 75 }, facts: { kept: 9, total: 10, pct: 90 } }, rows: [] } as EvalResult;
  assert.equal(checkGates(r, { savings: 40, lossless: 75, facts: 90 }).ok, true);
  const f = checkGates(r, { savings: 50, lossless: 100, facts: 97 }).failures;
  assert.equal(f.length, 3);
  assert.equal(checkGates({ ...r, totals: { ...r.totals, facts: { kept: 0, total: 0, pct: null } } }, { facts: 99 }).ok, true);
  assert.deepEqual(parseThresholds("savings=60, facts=97"), { savings: 60, facts: 97 });
  assert.throws(() => parseThresholds("savings=abc"));
});

test("fidelity: identical, different with first byte, whitespace-only, JSON path", () => {
  const sample = { ts: "", server: "s", tool: "t", hasOutputSchema: false, result: { content: [{ type: "text", text: JSON.stringify({ a: { "b c": "line1\nline2" }, list: [1, 2] }) }] } };
  assert.equal(checkFidelity(sample, "line1\nline2", '$.a["b c"]').identical, true);
  const d = checkFidelity(sample, "line1\nlineX", '$.a["b c"]');
  assert.deepEqual([d.identical, d.firstDifference], [false, 10]);
  assert.equal(checkFidelity(sample, "line1\r\nline2\n", '$.a["b c"]').whitespaceOnly, true);
  assert.equal(checkFidelity(sample, JSON.stringify([1, 2]), "$.list").identical, true);
  assert.throws(() => jsonPathGet({ a: 1 }, "$.nope"), /path not found/);
});

const result = (savedPct: number, tokensOut: number, verdict = "pruned-data"): EvalResult => ({ samples: 1, totals: { tokensIn: 100, tokensOut, savedPct, lossy: 0, lossless: { ok: 1, total: 1, pct: 100 }, facts: { kept: 0, total: 0, pct: null } }, rows: [{ key: "s.t", n: 1, tokensIn: 100, tokensOut, savedPct, lossy: 0, avgMs: 1, verdict: verdict as never, dataDropped: [], factsKept: 0, factsTotal: 0 }] });

test("history: persisted across restarts, capped at 50, runs can be diffed", () => {
  const file = join(tmp("hist"), "eval-history.jsonl");
  const a = saveRun({ label: "base", source: "examples", candidate: {}, result: result(40, 60) }, file);
  const b = saveRun({ label: "cand", source: "examples", candidate: { profile: "aggressive" }, result: result(55, 45, "pruned-data") }, file);
  assert.deepEqual(readRuns(file).map((r) => r.label), ["base", "cand"]); // a fresh read = a restart
  const d = diffRuns(a, b);
  assert.deepEqual([d.totals.savedPctDelta, d.totals.tokensOutDelta, d.rows[0].delta], [15, -15, 15]);
  for (let i = 0; i < 55; i++) saveRun({ label: `r${i}`, source: "examples", candidate: {}, result: result(1, 99) }, file);
  assert.equal(readRuns(file).length, 50);
  assert.equal(readRuns(file).at(-1)!.label, "r54");
});

test("dashboard actions: eval-run saves a run, candidate settings validated, fidelity against a capture; API lists history", async () => {
  const dir = tmp("evd");
  const capDir = join(dir, "captures");
  mkdirSync(capDir);
  const sample = { ts: new Date().toISOString(), server: "gh", tool: "get", hasOutputSchema: false, result: { content: [{ type: "text", text: "exact original text" }] } };
  writeFileSync(join(capDir, "gh.jsonl"), JSON.stringify(sample) + "\n");
  const historyFile = join(dir, "hist.jsonl");
  const config = defaultConfig();
  const rt = { config, configPath: join(dir, "c.yaml"), audit: new Audit({ ...config.audit, enabled: false }) } as unknown as Runtime;
  const env = { captureDir: capDir, evalHistoryFile: historyFile };

  assert.equal((await runAction(rt, "eval-run", { source: "nope" }, env)).status, 400);
  assert.equal((await runAction(rt, "eval-run", { source: "examples", profile: "wild" }, env)).status, 400);
  assert.equal((await runAction(rt, "eval-run", { source: "examples", prettyJsonAboveTokens: -5 }, env)).status, 400);
  const base = await runAction(rt, "eval-run", { source: "examples", label: "base" }, env);
  const cand = await runAction(rt, "eval-run", { source: "examples", profile: "aggressive", label: "cand" }, env);
  assert.equal(base.status, 200);
  assert.equal((cand.body as { candidate: { profile: string } }).candidate.profile, "aggressive");
  assert.equal(rt.config.profile, "balanced"); // the candidate was tried in memory only
  assert.equal((await runAction(rt, "eval-run", { source: "captures" }, env)).status, 200);
  assert.equal((await runAction({ ...rt } as Runtime, "eval-run", { source: "captures" }, { ...env, captureDir: join(dir, "empty") })).status, 400); // no samples

  assert.deepEqual((await runAction(rt, "eval-fidelity", { id: 0, text: "exact original text" }, env)).body, { identical: true, originalBytes: 19, givenBytes: 19 });
  assert.equal(((await runAction(rt, "eval-fidelity", { id: 0, text: "exact original TEXT" }, env)).body as { identical: boolean }).identical, false);
  assert.equal((await runAction(rt, "eval-fidelity", { id: 9, text: "x" }, env)).status, 404);

  const daemon = new Daemon(rt, { captureDir: capDir, evalHistoryFile: historyFile, routesFile: join(dir, "r.json") });
  const srv = await startHttpProxy(rt, { port: 0, daemon, routesFile: join(dir, "r.json") });
  daemon.port = (srv.address() as { port: number }).port;
  const get = async (p: string) => (await fetch(`http://127.0.0.1:${daemon.port}${p}`, { headers: { authorization: `Bearer ${daemon.token}` } })).json() as Promise<any>;
  try {
    const hist = await get("/api/eval/history");
    assert.deepEqual(hist.map((h: { label: string }) => h.label), ["captures", "cand", "base"]); // newest first
    const d = await get(`/api/eval/diff?a=${hist[2].id}&b=${hist[1].id}`);
    assert.ok(d.totals.savedPctDelta > 0); // aggressive saves more than balanced on the examples
    assert.equal((await get(`/api/eval/runs/${hist[1].id}`)).result.rows.length, 7);
    assert.equal((await get("/api/eval/diff?a=x&b=y")).error, "no such run");
  } finally {
    srv.close();
  }
});
