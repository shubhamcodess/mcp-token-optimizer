import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Runtime } from "./runtime.js";

/**
 * `mto wrap --name github -- npx -y @modelcontextprotocol/server-github`
 * The agent launches THIS process as if it were the MCP server; we launch the real server and sit in the middle.
 * MCP stdio framing is newline-delimited JSON. Responses are optimized concurrently but emitted in order.
 */
export function runStdioWrapper(rt: Runtime, name: string, command: string, args: string[]): Promise<number> {
  const session = rt.newSession(name);
  void rt.warm(); // load the local model in the background so the first summarization isn't a cold start
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, MTO_WRAPPED: "1" } });

  const toClient = (obj: unknown) => process.stdout.write(typeof obj === "string" ? obj + "\n" : JSON.stringify(obj) + "\n");
  const toServer = (obj: unknown) => child.stdin.write(typeof obj === "string" ? obj + "\n" : JSON.stringify(obj) + "\n");

  // client -> server (cheap, synchronous)
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return void toServer(line);
    }
    if (Array.isArray(msg)) return void toServer(line); // JSON-RPC batches: pass through untouched
    const { forward, reply } = session.fromClient(msg);
    if (reply) toClient(reply);
    if (forward) toServer(forward === msg ? line : forward);
  });
  process.stdin.on("end", () => child.stdin.end());

  // server -> client: compute concurrently, emit in arrival order
  let tail: Promise<void> = Promise.resolve();
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    const work: Promise<string> = (async () => {
      try {
        const msg = JSON.parse(line);
        if (Array.isArray(msg)) return line;
        const out = await session.fromServer(msg);
        return out === msg ? line : JSON.stringify(out);
      } catch {
        return line; // fail open
      }
    })();
    tail = tail.then(async () => {
      toClient(await work);
    });
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));

  return new Promise((resolve) => {
    child.on("error", (e) => {
      process.stderr.write(`[mto] failed to start "${command}": ${e.message}\n`);
      resolve(127);
    });
    child.on("close", (code) => void tail.then(() => resolve(code ?? 0)));
  });
}
