#!/usr/bin/env node
// Self-checking end-to-end smoke test (no Ollama, no agent, no network beyond localhost).
//   npm run build && node scripts/smoke.mjs        → prints PASS/FAIL per check, exits non-zero on any failure
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "mto-smoke-"));
const env = { ...process.env, MTO_HOME: home };
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const cfg = (yaml) => writeFileSync(join(home, "config.yaml"), yaml);
const NOLLM = "summarize:\n  enabled: false\n";
const call = (args, wrapArgs = []) => {
  const r = spawnSync(process.execPath, [join(root, "scripts/mcp-call.mjs"), ...args, "--", process.execPath, join(root, "dist/cli.js"), "wrap", "--name", "demo", ...wrapArgs, "--", process.execPath, join(root, "examples/fake-mcp-server.mjs")], { env, encoding: "utf8", timeout: 60000 });
  const tok = /~(\d+) tokens/.exec(r.stdout)?.[1];
  return { out: r.stdout, err: r.stderr, tokens: tok ? Number(tok) : NaN };
};

// ── modes
cfg(NOLLM);
const active = call(["--tool", "list_issues"]);
check("active: list_issues shrinks >60% (37,355 → ~13k tokens)", active.tokens < 15000, `${active.tokens} tok`);
check("active: TOON table returned", /^\[40\]:/m.test(active.out));
check("active: pruned-field note present with expandable id", /pruned low-value fields: .*node_id.*mto_expand \{"id":"[0-9a-f]{12}"/.test(active.out));

cfg("mode: shadow\n" + NOLLM);
const shadow = call(["--tool", "list_issues"]);
check("shadow: agent receives the ORIGINAL (37,355 tokens)", shadow.tokens > 37000, `${shadow.tokens} tok`);

cfg("mode: off\n");
check("off: transparent pass-through", call(["--tool", "list_issues"]).tokens > 37000);

cfg("mode: shadow\n" + NOLLM + 'tools:\n  "demo.list_issues":\n    mode: active\n');
check("per-tool override: list_issues active, describe_configmap stays shadow", call(["--tool", "list_issues"]).tokens < 15000 && call(["--tool", "describe_configmap"]).tokens > 3500);

// ── profiles / formats
cfg("profile: conservative\n" + NOLLM);
const cons = call(["--tool", "list_issues"]);
check("conservative keeps more than balanced (~28k tokens)", cons.tokens > 25000 && cons.tokens < 31000, `${cons.tokens} tok`);
cfg("profile: aggressive\n" + NOLLM);
check("aggressive shrinks more than balanced (~9.6k tokens)", call(["--tool", "list_issues"]).tokens < 11000);
cfg("format:\n  default: json-pretty\n" + NOLLM);
const pretty = call(["--tool", "list_issues", "--raw"]);
let parsed = false;
try { parsed = Array.isArray(JSON.parse(JSON.parse(pretty.out.slice(0, pretty.out.lastIndexOf("\n── agent")))?.content?.[0]?.text)) || true; } catch { parsed = false; }
check("json-pretty: agent receives valid JSON", parsed);

// ── guardrails
cfg(NOLLM);
const rows = call(["--tool", "get_rows", "--raw"]);
check("structuredContent + outputSchema tool is not altered", /structuredContent present/.test(rows.out) && /"rows"/.test(rows.out));
check("k8s dedupe: describeText replaced by pointer", /lines identical to \$\.manifest\.data/.test(call(["--tool", "describe_configmap", "--raw"]).out));
check("read_file: code is never rewritten (≈ same size)", Math.abs(call(["--tool", "read_file"]).tokens - 6419) < 20);
check("build_log: repeated lines collapse (>95% saved)", call(["--tool", "build_log"]).tokens < 300);

// ── expand
const first = call(["--tool", "list_issues"]);
const id = /mto_expand \{"id":"([0-9a-f]{12})"/.exec(first.out)?.[1];
const ex = call(["--tool", "mto_expand", "--args", JSON.stringify({ id, path: "$[3].node_id" })]);
check("mto_expand path returns the exact pruned value", /I_kwDOAbCdEf3xYz/.test(ex.out), id);
check("mto_expand id-only returns an outline, not a dump", /Original is JSON/.test(call(["--tool", "mto_expand", "--args", JSON.stringify({ id })]).out));
check("mto_expand unknown id → error, not crash", /No stored original/.test(call(["--tool", "mto_expand", "--args", '{"id":"000000000000"}']).out));

// ── redaction
cfg("redaction:\n  mode: redact\n" + NOLLM);
const red = call(["--tool", "get_secrets", "--raw"]);
check("redact mode: secrets replaced", /REDACTED:aws-access-key/.test(red.out) && !/AKIA\w{16}/.test(red.out));
cfg(NOLLM);
check("detect mode (default): text untouched", /AKIA\w{16}/.test(call(["--tool", "get_secrets", "--raw"]).out));

// ── fail-open when Ollama is unreachable
cfg("llm:\n  baseUrl: http://127.0.0.1:9\nsummarize:\n  minTokens: 400\n");
const down = call(["--tool", "fetch_guide"]);
check("Ollama down: request still succeeds (fail-open, deterministic stages only)", down.tokens > 1000 && down.tokens < 2300, `${down.tokens} tok`);

// ── HTTP proxy
cfg(NOLLM);
writeFileSync(join(home, "routes.json"), JSON.stringify({ demo: { url: "http://127.0.0.1:9192/mcp" } }));
const up = spawn(process.execPath, [join(root, "examples/fake-mcp-server.mjs"), "--http", "9192"], { env, stdio: "ignore" });
const px = spawn(process.execPath, [join(root, "dist/cli.js"), "serve", "--port", "9191"], { env, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const h = (extra = []) => spawnSync(process.execPath, [join(root, "scripts/mcp-call.mjs"), "--tool", "list_issues", "--url", "http://127.0.0.1:9191/demo", "--header", "X-API-Key=demo-key", ...extra], { env, encoding: "utf8", timeout: 30000 });
const viaHttp = h();
check("http proxy: JSON response optimized, API-key header forwarded", /~(\d+) tokens/.test(viaHttp.stdout) && Number(/~(\d+) tokens/.exec(viaHttp.stdout)[1]) < 15000);
check("http proxy: SSE response optimized", Number(/~(\d+) tokens/.exec(h(["--sse"]).stdout)?.[1] ?? 1e9) < 15000);
const rebind = await new Promise((res) => {
  const r = httpRequest({ host: "127.0.0.1", port: 9191, path: "/demo", method: "POST", headers: { host: "evil.example.com" } }, (x) => res(x.statusCode));
  r.on("error", () => res(0));
  r.end("{}");
});
check("http proxy: non-loopback Host rejected (403)", rebind === 403, String(rebind));
check("http proxy: unknown route → 404", (await fetch("http://127.0.0.1:9191/nope", { method: "POST", body: "{}" }).then((r) => r.status)) === 404);
up.kill();
await new Promise((r) => setTimeout(r, 300));
const dead = await fetch("http://127.0.0.1:9191/demo", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "demo-key" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
check("http proxy: upstream down → 502 with reason", dead.status === 502 && /ECONNREFUSED/.test(await dead.text()));
px.kill();

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
