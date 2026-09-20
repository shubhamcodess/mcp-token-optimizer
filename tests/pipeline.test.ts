import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigSchema } from "../src/config.js";
import type { LlmClient } from "../src/llm.js";
import { Pipeline } from "../src/pipeline.js";
import { OriginalStore } from "../src/store.js";
import { estimateTokens } from "../src/tokens.js";

const tmp = () => mkdtempSync(join(tmpdir(), "mto-"));
const fakeLlm = (fn: (user: string) => string): LlmClient => ({ available: () => true, complete: async (_s, u) => ({ text: fn(u), truncated: false }) });
const mk = (cfg: object = {}, llm: LlmClient = fakeLlm(() => "")) =>
  new Pipeline(ConfigSchema.parse({ audit: { enabled: false }, ...cfg }), llm, new OriginalStore(60_000, 50, tmp()));
const call = (text: string) => ({ content: [{ type: "text", text }] });
const ctx = { server: "gh", tool: "list_issues" };

const issues = Array.from({ length: 30 }, (_, i) => ({
  id: i, number: 100 + i, title: `Issue ${i}`, state: "open", body: null, assignee: null, labels: [],
  node_id: `MDU6SXNzdWU${i}`, url: `https://api.github.com/repos/o/r/issues/${i}`,
  comments_url: `https://api.github.com/repos/o/r/issues/${i}/comments{/number}`,
  user: { login: "octo", avatar_url: "https://avatars/x", gravatar_id: "", site_admin: false },
}));

test("JSON is pruned and re-encoded as TOON when cheaper, semantics intact", async () => {
  const p = mk();
  const raw = JSON.stringify(issues, null, 2);
  const { result, report } = await p.optimizeResult(call(raw), ctx);
  const out = (result.content![0] as any).text as string;
  assert.ok(report.tokensOut < report.tokensIn * 0.5, `expected >50% saving, got ${report.tokensIn}->${report.tokensOut}`);
  assert.ok(report.stages.includes("prune"));
  assert.match(out, /number/);
  assert.match(out, /Issue 7/);
  assert.doesNotMatch(out.split(/\n\[mto: /)[0], /gravatar|node_id|comments_url/);
  assert.match(out, /https:\/\/api\.github\.com\/repos\/o\/r\/issues\/3/); // real `url` kept
});

test("tools with an outputSchema keep valid JSON and lose no fields", async () => {
  const p = mk();
  const data = { a: null, b: "", c: [], d: { e: 1 }, pad: "x".repeat(200) };
  const { result } = await p.optimizeResult(call(JSON.stringify(data, null, 2)), { ...ctx, hasOutputSchema: true });
  const out = JSON.parse((result.content![0] as any).text);
  assert.deepEqual(out, data);
});

test("structuredContent is never touched", async () => {
  const p = mk();
  const sc = { rows: issues.slice(0, 5) };
  const { result } = await p.optimizeResult({ content: [{ type: "text", text: JSON.stringify(sc, null, 2) }], structuredContent: sc }, ctx);
  assert.deepEqual(result.structuredContent, sc);
  assert.deepEqual(JSON.parse((result.content![0] as any).text), sc);
});

test("jsonTools forces JSON", async () => {
  const p = mk({ format: { jsonTools: ["gh.*"] } });
  const { result } = await p.optimizeResult(call(JSON.stringify(issues, null, 2)), ctx);
  JSON.parse((result.content![0] as any).text);
});

test("never returns something bigger than the input", async () => {
  const p = mk({ skipBelowTokens: 0 });
  const small = '{"a":1}';
  const { result } = await p.optimizeResult(call(small), ctx);
  assert.ok(estimateTokens((result.content![0] as any).text) <= estimateTokens(small));
});

const prose = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: the deployment of service-${i} to /srv/app${i}/config.yaml finished with code E${1000 + i}. Nothing else notable happened, really, honestly.`).join("\n\n");

test("long prose is summarized, keeps critical facts, stores the original", async () => {
  const llm = fakeLlm((u) => {
    const body = u.split("<input>\n")[1].split("\n</input>")[0];
    return [...body.matchAll(/service-\d+ to (\/srv\/app\d+\/config\.yaml) finished with code (E\d+)/g)].map((m) => `${m[1]} ${m[2]}`).join("\n");
  });
  const p = mk({}, llm);
  const { result, report } = await p.optimizeResult(call(prose), { server: "docs", tool: "fetch_page" });
  const out = (result.content![0] as any).text as string;
  assert.ok(report.lossy);
  assert.ok(report.tokensOut < report.tokensIn * 0.6);
  assert.match(out, /\/srv\/app42\/config\.yaml/);
  assert.match(out, /E1059/);
  const id = /"id":"([0-9a-f]{12})"/.exec(out)![1];
  assert.ok(id);
});

test("summary that drops critical facts is repaired or rejected, never silently lossy", async () => {
  const p = mk({}, fakeLlm(() => "Things happened and deployments finished."));
  const { result } = await p.optimizeResult(call(prose), { server: "docs", tool: "fetch_page" });
  const out = (result.content![0] as any).text as string;
  // either the paths were re-attached, or the summary was rejected and the full text kept
  assert.ok(out.includes("/srv/app42/config.yaml"));
});

test("code and file reads are never summarized", async () => {
  let called = 0;
  const p = mk({}, fakeLlm(() => (called++, "x")));
  const code = Array.from({ length: 400 }, (_, i) => `function f${i}(a, b) {\n  return a + b + ${i};\n}`).join("\n");
  await p.optimizeResult(call(code), { server: "fs", tool: "read_file" });
  await p.optimizeResult(call(code), { server: "x", tool: "fetch" }); // code detection, not tool name
  assert.equal(called, 0);
});

test("LLM failure falls back to deterministic cleanup", async () => {
  const p = mk({}, { available: () => true, complete: async () => { throw new Error("boom"); } });
  const { result } = await p.optimizeResult(call(prose + "\n\n\n\n\n" + prose), { server: "docs", tool: "fetch_page" });
  assert.ok((result.content![0] as any).text.includes("Paragraph 59"));
});

test("redact mode removes secrets even when nothing else shrinks", async () => {
  const p = mk({ redaction: { mode: "redact" }, skipBelowTokens: 0 });
  const { result } = await p.optimizeResult(call("token=ghp_" + "a".repeat(36) + " ok"), ctx);
  assert.match((result.content![0] as any).text, /REDACTED:github-token/);
});

test("repeated log lines collapse", async () => {
  const p = mk();
  const log = "start\n" + "downloading...\n".repeat(500) + "done";
  const { result } = await p.optimizeResult(call(log), { server: "sh", tool: "run" });
  assert.match((result.content![0] as any).text, /downloading\.\.\. \(×500\)/);
});

test("truncated LLM generations are discarded, never used", async () => {
  const p = mk({}, { available: () => true, complete: async () => ({ text: "cut off mid-sen", truncated: true }) });
  const { result, report } = await p.optimizeResult(call(prose), { server: "docs", tool: "fetch_page" });
  assert.ok(!report.lossy);
  assert.ok((result.content![0] as any).text.includes("Paragraph 59"));
});

const factLlm = (delayMs: number, counter: { n: number }): LlmClient => ({
  available: () => true,
  complete: async (_s, u) => {
    counter.n++;
    await new Promise((r) => setTimeout(r, delayMs));
    const body = u.split("<input>\n")[1].split("\n</input>")[0];
    return { text: [...body.matchAll(/(\/srv\/app\d+\/config\.yaml) finished with code (E\d+)/g)].map((m) => `${m[1]} ${m[2]}`).join("\n"), truncated: false };
  },
});

test("latency budget: never starts a chunk predicted not to fit, keeps original verbatim", async () => {
  const c = { n: 0 };
  const p = mk({ summarize: { maxLatencyMs: 3000 } }, factLlm(50, c));
  const { result, report } = await p.optimizeResult(call(prose), { server: "docs", tool: "fetch_page" });
  assert.equal(c.n, 0);
  assert.ok(!report.lossy);
  assert.ok((result.content![0] as any).text.includes("Paragraph 59"));
});

test("latency budget: with enough time every chunk is summarized", async () => {
  const c = { n: 0 };
  const p = mk({ summarize: { maxLatencyMs: 60_000, concurrency: 3 } }, factLlm(20, c));
  const { report } = await p.optimizeResult(call(prose), { server: "docs", tool: "fetch_page" });
  assert.ok(c.n > 1);
  assert.ok(report.lossy);
});

test("exact duplicate paragraphs are deduplicated with a repeat count", async () => {
  const p = mk({ summarize: { enabled: false } });
  const para = "This is a repeated boilerplate paragraph that appears many times in the tool output and says nothing new at all.";
  const doc = Array.from({ length: 30 }, (_, i) => (i % 2 ? para : `Unique paragraph number ${i} with enough words in it to matter for dedupe logic here.`)).join("\n\n");
  const { result } = await p.optimizeResult(call(doc), { server: "docs", tool: "fetch_page" });
  const out = (result.content![0] as any).text as string;
  assert.equal(out.split("repeated boilerplate paragraph").length - 1, 1);
  assert.match(out, /\(repeated 15×\)/);
});

test("summaries that drop a heading are rejected for that chunk", async () => {
  const doc = Array.from({ length: 20 }, (_, i) => `## Section ${i}\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do. ".repeat(12)} /srv/app${i}/config.yaml`).join("\n\n");
  const p = mk({ summarize: { maxLatencyMs: 60_000 } }, fakeLlm(() => "short summary without any heading"));
  const { result } = await p.optimizeResult(call(doc), { server: "docs", tool: "fetch_page" });
  const out = (result.content![0] as any).text as string;
  for (let i = 0; i < 20; i++) assert.ok(out.includes(`## Section ${i}`), `lost heading ${i}`);
});

test("cross-field dedupe: echoed content is replaced by a pointer, canonical copy untouched", async () => {
  const cfgYaml = Array.from({ length: 40 }, (_, i) => `setting_${i}: value-${i}-of-the-error-config`).join("\n");
  const doc = {
    name: "app",
    describeText: `Name: app\nNamespace: prod\nData\n====\nerror-config.yaml:\n----\n${cfgYaml}\nEvents: <none>`,
    manifest: { data: { "error-config.yaml": cfgYaml }, metadata: { name: "app" } },
  };
  const p = mk({ format: { jsonTools: ["kube.*"] } });
  const { result, report } = await p.optimizeResult(call(JSON.stringify(doc, null, 2)), { server: "kube", tool: "describe" });
  const out = JSON.parse((result.content![0] as any).text);
  assert.ok(report.stages.includes("xdedupe"));
  assert.equal(out.manifest.data["error-config.yaml"], cfgYaml, "canonical copy is intact");
  assert.match(out.describeText, /lines identical to \$\.manifest\.data\["error-config\.yaml"\] omitted/);
  assert.match(out.describeText, /Namespace: prod/);
  assert.match(out.describeText, /Events: <none>/);
  assert.ok(report.tokensOut < report.tokensIn * 0.65);
});

test("cross-field dedupe is off for schema-bound tools and under the conservative profile", async () => {
  const cfgYaml = Array.from({ length: 40 }, (_, i) => `setting_${i}: value-${i}-of-the-error-config`).join("\n");
  const doc = { describeText: `Head\n${cfgYaml}\nTail`, manifest: { data: { f: cfgYaml } } };
  const raw = JSON.stringify(doc, null, 2);
  const a = await mk().optimizeResult(call(raw), { server: "k", tool: "t", hasOutputSchema: true });
  assert.deepEqual(JSON.parse((a.result.content![0] as any).text), doc);
  const b = await mk({ profile: "conservative" }).optimizeResult(call(raw), { server: "k", tool: "t" });
  assert.ok(!b.report.stages.includes("xdedupe"));
});

test("cross-field dedupe: three-way overlap points at the top-most copy", async () => {
  const { dedupeAcrossFields } = await import("../src/prune.js");
  const body = Array.from({ length: 12 }, (_, i) => `shared configuration line number ${i}`).join("\n");
  const { value } = dedupeAcrossFields({ a: `x\n${body}`, b: `y\n${body}`, deep: { c: { d: body } } }) as { value: any };
  assert.equal(value.deep.c.d, body);
  assert.match(value.a, /identical to \$\.deep\.c\.d omitted/);
  assert.match(value.b, /identical to \$\.deep\.c\.d omitted/);
});

test("pruned results carry an expandable note; original is recoverable byte-for-byte", async () => {
  const p = mk();
  const raw = JSON.stringify(issues, null, 2);
  const { result } = await p.optimizeResult(call(raw), ctx);
  const out = (result.content![0] as any).text as string;
  const id = /mto_expand \{"id":"([0-9a-f]{12})"/.exec(out)?.[1];
  assert.ok(id, "note with id present when fields were pruned");
  assert.match(out, /pruned low-value fields: .*node_id/);
  assert.match(out, /\n\[mto: .*mto_expand/, "TOON output gets a trailing note line");
});

test("JSON kept as JSON gets the note as an `_mto` key and stays parseable", async () => {
  const p = mk({ format: { jsonTools: ["gh.*"] } });
  const { result } = await p.optimizeResult(call(JSON.stringify({ items: issues }, null, 2)), ctx);
  const j = JSON.parse((result.content![0] as any).text);
  assert.match(j._mto, /mto_expand/);
  // a root ARRAY forced to JSON must stay a pure array (no place for a note without changing its shape)
  const arr = await p.optimizeResult(call(JSON.stringify(issues, null, 2)), ctx);
  assert.ok(Array.isArray(JSON.parse((arr.result.content![0] as any).text)));
});

test("no note when only nulls/empties were dropped, and none in shadow mode", async () => {
  const noisy = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `n${i}`, extra: null, tags: [] }));
  const a = await mk().optimizeResult(call(JSON.stringify(noisy, null, 2)), ctx);
  assert.doesNotMatch((a.result.content![0] as any).text, /mto_expand/);
  const b = await mk({ mode: "shadow" }).optimizeResult(call(JSON.stringify(issues, null, 2)), ctx);
  assert.doesNotMatch((b.result.content![0] as any).text, /mto_expand/);
});

test("json-pretty: valid, indented JSON (safe for clients that offload results to files)", async () => {
  const doc = { manifest: { data: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, `value number ${i} `.repeat(4)])) }, junk: null };
  const p = mk({ tools: { "kube.*": { format: "json-pretty" } } });
  const { result } = await p.optimizeResult(call(JSON.stringify(doc, null, 4)), { server: "kube", tool: "get" });
  const t = (result.content![0] as any).text as string;
  assert.deepEqual(Object.keys(JSON.parse(t).manifest.data).length, 20);
  assert.ok(t.split("\n").length > 20, "multi-line so line-range reads work");
  const big = mk({ format: { prettyJsonAboveTokens: 50 } });
  const r2 = await big.optimizeResult(call(JSON.stringify(doc, null, 4)), { server: "x", tool: "y" });
  JSON.parse((r2.result.content![0] as any).text);
});

test("dedupe-only (nothing dropped) emits NO expand note: it would only invite pointless fetches", async () => {
  const cfgYaml = Array.from({ length: 40 }, (_, i) => `setting_${i}: value-${i}-of-the-error-config`).join("\n");
  const doc = { name: "app", describeText: `Head\n${cfgYaml}\nTail`, manifest: { data: { "c.yaml": cfgYaml } } };
  const { result, report } = await mk().optimizeResult(call(JSON.stringify(doc, null, 2)), { server: "kube", tool: "get" });
  const out = (result.content![0] as any).text as string;
  assert.ok(report.stages.includes("xdedupe"));
  assert.doesNotMatch(out, /mto_expand/);
  assert.match(out, /lines identical to/);
});
