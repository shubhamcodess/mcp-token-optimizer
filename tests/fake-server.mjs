// Minimal MCP stdio server used by the e2e test.
import { createInterface } from "node:readline";

const issues = Array.from({ length: 40 }, (_, i) => ({
  id: i, title: `Issue ${i}`, state: "open", body: null, node_id: `N${i}`, assignee: null,
  user: { login: "octo", gravatar_id: "" },
}));

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "list_issues", description: "d", inputSchema: { type: "object", properties: { title: { type: "string", title: "T" } } } }] } });
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] } });
  else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
