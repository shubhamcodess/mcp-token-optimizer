#!/usr/bin/env node
// Minimal MCP client for testing. Prints what the AGENT would receive, plus a token estimate.
//   stdio:  node scripts/mcp-call.mjs --tool list_issues -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs
//   http:   node scripts/mcp-call.mjs --tool list_issues --url http://127.0.0.1:8787/demo --header X-API-Key=demo-key [--sse]
// Flags: --list (show tools/list) · --tool NAME · --args '{"json":"args"}' · --quiet (only the summary line) · --raw (print JSON-RPC result)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opts = sep >= 0 ? argv.slice(0, sep) : argv;
const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
const flag = (n) => (opts.includes(n) ? opts[opts.indexOf(n) + 1] : undefined);
const has = (n) => opts.includes(n);
const { estimateTokens } = require("../dist/tokens.js");

let send;
let close = () => {};
if (flag("--url")) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  for (const h of opts.flatMap((a, i) => (a === "--header" ? [opts[i + 1]] : []))) headers[h.split("=")[0]] = h.split("=").slice(1).join("=");
  if (has("--sse")) headers["x-mode"] = "sse";
  let sid;
  send = async (msg) => {
    const res = await fetch(flag("--url"), { method: "POST", headers: { ...headers, ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify(msg) });
    sid = res.headers.get("mcp-session-id") ?? sid;
    const text = await res.text();
    if (msg.id === undefined) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    if ((res.headers.get("content-type") ?? "").includes("event-stream")) {
      const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      return data.map((d) => JSON.parse(d)).find((m) => m.id === msg.id);
    }
    return JSON.parse(text);
  };
} else {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (l) => {
    try {
      const m = JSON.parse(l);
      waiting.get(m.id)?.(m);
    } catch {}
  });
  send = (msg) => (msg.id === undefined ? (child.stdin.write(JSON.stringify(msg) + "\n"), Promise.resolve(null)) : new Promise((r) => (waiting.set(msg.id, r), child.stdin.write(JSON.stringify(msg) + "\n"))));
  close = () => child.stdin.end();
}

const out = (s) => !has("--quiet") && console.log(s);
try {
  const init = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-call", version: "1" } } });
  await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  if (has("--list")) {
    const l = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    console.log("tools:", l.result.tools.map((t) => t.name).join(", "));
    console.log("instructions:", init.result.instructions ? init.result.instructions.slice(0, 160) + "…" : "(none)");
  }
  if (flag("--tool")) {
    const r = await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: flag("--tool"), arguments: JSON.parse(flag("--args") ?? "{}") } });
    if (r.error) throw new Error(JSON.stringify(r.error));
    const text = (r.result.content ?? []).map((c) => c.text ?? "").join("\n");
    out(has("--raw") ? JSON.stringify(r.result, null, 2) : text.length > 2000 ? `${text.slice(0, 1300)}\n… [${text.length - 1800} chars not shown] …\n${text.slice(-500)}` : text);
    console.log(`\n── agent received: ${text.length} chars, ~${estimateTokens(text)} tokens${r.result.structuredContent ? " · structuredContent present" : ""}${r.result.isError ? " · isError" : ""}`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
