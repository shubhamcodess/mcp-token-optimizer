import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createInterface } from "node:readline";

test("stdio wrapper: optimizes tool results, injects mto_expand, answers it locally", async () => {
  const home = mkdtempSync(join(tmpdir(), "mto-e2e-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "wrap", "--name", "fake", "--", process.execPath, "tests/fake-server.mjs"], {
    env: { ...process.env, MTO_HOME: home },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (m: any) => void>();
  createInterface({ input: child.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  const rpc = (id: number, method: string, params: object = {}) =>
    new Promise<any>((res) => {
      waiting.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  try {
  const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "test" }, capabilities: {} });
  assert.match(init.result.instructions, /TOON/);

  const list = await rpc(2, "tools/list");
  assert.ok(list.result.tools.some((t: any) => t.name === "mto_expand"));

  const res = await rpc(3, "tools/call", { name: "list_issues", arguments: {} });
  const text: string = res.result.content[0].text;
  assert.match(text, /^\[40\]/);
  const [data, note = ""] = text.split(/\n\[mto: /);
  assert.doesNotMatch(data, /node_id|gravatar/, "pruned fields are gone from the data");
  assert.match(note, /pruned low-value fields: .*node_id/, "...and named in the note");

  const miss = await rpc(4, "tools/call", { name: "mto_expand", arguments: { id: "000000000000" } });
  assert.equal(miss.result.isError, true);

  } finally {
    child.stdin.end();
    setTimeout(() => child.kill(), 3000).unref();
    await new Promise((r) => child.on("close", r));
  }
});
