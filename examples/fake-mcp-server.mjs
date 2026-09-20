#!/usr/bin/env node
// Demo MCP server serving the synthetic files in examples/. Two transports:
//   stdio (default):   node examples/fake-mcp-server.mjs
//   HTTP:              node examples/fake-mcp-server.mjs --http 9100     (POST http://127.0.0.1:9100/mcp)
// Tools: get_secrets, get_page, list_issues, describe_configmap, fetch_guide, build_log, read_file, get_rows (has outputSchema + structuredContent)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");
const TOOLS = {
  list_issues: () => ({ content: [{ type: "text", text: read("github-issues.json") }] }),
  describe_configmap: () => ({ content: [{ type: "text", text: read("k8s-configmap.json") }] }),
  fetch_guide: () => ({ content: [{ type: "text", text: read("deploy-guide.md") }] }),
  build_log: () => ({ content: [{ type: "text", text: read("build.log") }] }),
  get_secrets: () => ({ content: [{ type: "text", text: read("secrets.txt") }] }),
  get_page: () => ({ content: [{ type: "text", text: read("page.html") }] }),
  read_file: () => ({ content: [{ type: "text", text: read("source.ts") }] }),
  get_rows: () => JSON.parse(read("structured-result.json")),
};
const listing = Object.keys(TOOLS).map((name) => ({
  name,
  description: `Demo tool ${name}`,
  inputSchema: { type: "object", properties: { title: { type: "string", title: "A parameter that is literally called title" } } },
  ...(name === "get_rows" ? { outputSchema: { type: "object", properties: { rows: { type: "array" } } } } : {}),
}));

function handle(m) {
  if (m.id === undefined) return null;
  const ok = (result) => ({ jsonrpc: "2.0", id: m.id, result });
  if (m.method === "initialize") return ok({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1.0.0" } });
  if (m.method === "tools/list") return ok({ tools: listing });
  if (m.method === "tools/call") {
    const t = TOOLS[m.params?.name];
    return t ? ok(t()) : { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } };
  }
  return ok({});
}

const httpPort = process.argv.includes("--http") ? Number(process.argv[process.argv.indexOf("--http") + 1]) : 0;
if (httpPort) {
  createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-api-key"] !== "demo-key") return res.writeHead(401, { "content-type": "application/json" }).end('{"error":"Missing or wrong X-API-Key"}');
      if (req.method !== "POST") return res.writeHead(405).end();
      const r = handle(JSON.parse(body));
      if (!r) return res.writeHead(202).end();
      const headers = { "mcp-session-id": "demo-session" };
      if (req.headers["x-mode"] === "sse") {
        res.writeHead(200, { ...headers, "content-type": "text/event-stream" });
        return res.end(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      }
      res.writeHead(200, { ...headers, "content-type": "application/json" }).end(JSON.stringify(r));
    });
  }).listen(httpPort, "127.0.0.1", () => console.error(`fake MCP (HTTP, needs header X-API-Key: demo-key) on http://127.0.0.1:${httpPort}/mcp`));
} else {
  createInterface({ input: process.stdin }).on("line", (l) => {
    const r = handle(JSON.parse(l));
    if (r) process.stdout.write(JSON.stringify(r) + "\n");
  });
}
