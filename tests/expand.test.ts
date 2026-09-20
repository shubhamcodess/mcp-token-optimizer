import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Audit } from "../src/audit.js";
import { diffSample } from "../src/compare.js";
import { ConfigSchema } from "../src/config.js";
import { Pipeline } from "../src/pipeline.js";
import { Session } from "../src/session.js";
import { OriginalStore } from "../src/store.js";

const doc = {
  items: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `n${i}`, node_id: `X${i}`, spec: { replicas: i, image: `img:${i}` } })),
};

test("end to end: prune -> agent calls mto_expand with a path -> gets the exact pruned field; audit records it; compare says pruned-data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-exp-"));
  const cfg = ConfigSchema.parse({ audit: { enabled: true, path: join(dir, "a.jsonl") } });
  const store = new OriginalStore(60_000, 50, join(dir, "s"));
  const pipeline = new Pipeline(cfg, { available: () => false, complete: async () => ({ text: "", truncated: false }) }, store);
  const audit = new Audit(cfg.audit);
  const sess = new Session("kube", cfg, pipeline, audit, store);

  sess.fromClient({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get", arguments: {} } });
  const res = await sess.fromServer({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] } });
  const text: string = res.result.content[0].text;
  assert.doesNotMatch(text.split(/\n\[mto: /)[0], /node_id/);
  const id = /mto_expand \{"id":"([0-9a-f]{12})"/.exec(text)![1];

  assert.match(text, /pruned low-value fields: node_id×30/, "note names exactly what was dropped");
  const outl = sess.fromClient({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "mto_expand", arguments: { id } } }).reply!.result.content[0].text as string;
  assert.match(outl, /Original is JSON/);
  assert.match(outl, /path=/, "id-only expand returns an outline, not a dump");
  assert.ok(outl.length < 2500);
  const full = sess.fromClient({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "mto_expand", arguments: { id, full: true } } }).reply!.result.content[0].text as string;
  assert.equal(JSON.parse(full).items.length, 30);
  const { reply } = sess.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mto_expand", arguments: { id, path: "$.items[3]" } } });
  const got = JSON.parse(reply!.result.content[0].text);
  assert.deepEqual(got, doc.items[3], "pruned node_id is back, exactly");

  const miss = sess.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mto_expand", arguments: { id, path: "$.nope" } } }).reply!;
  assert.equal(miss.result.isError, true);

  const { readAudit } = await import("../src/audit.js");
  const rows = readAudit(cfg.audit.path);
  assert.equal(rows.filter((r) => r.tool === "mto_expand").length, 4);

  const d = diffSample({ ts: "2026-01-01T00:00:00Z", server: "kube", tool: "get", hasOutputSchema: false, result: { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] }, optimized: { content: [{ type: "text", text }] } })!;
  assert.equal(d.verdict, "pruned-data");
  assert.deepEqual(d.dataDropped[0], { path: "$.items[].node_id", count: 30 });
  assert.equal(d.changed, 0);
});

test("per-tool active override under global shadow: note + expand tool still work; shadow tools stay untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mto-mix-"));
  const cfg = ConfigSchema.parse({ mode: "shadow", audit: { enabled: false }, tools: { "kube.get": { mode: "active" } } });
  const store = new OriginalStore(60_000, 50, join(dir, "s"));
  const pipeline = new Pipeline(cfg, { available: () => false, complete: async () => ({ text: "", truncated: false }) }, store);
  const sess = new Session("kube", cfg, pipeline, new Audit(cfg.audit), store);
  sess.fromClient({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const list = await sess.fromServer({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "get" }, { name: "other" }] } });
  assert.ok(list.result.tools.some((t: any) => t.name === "mto_expand"), "expand tool offered when any tool is active");
  const body = JSON.stringify(doc, null, 2);
  sess.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get" } });
  const a = await sess.fromServer({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: body }] } });
  assert.match(a.result.content[0].text, /mto_expand/);
  sess.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "other" } });
  const b = await sess.fromServer({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: body }] } });
  assert.equal(b.result.content[0].text, body, "shadow tool forwarded byte-for-byte");
});
