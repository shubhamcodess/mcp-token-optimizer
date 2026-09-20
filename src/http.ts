import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadRoutes, ROUTES_FILE } from "./routes.js";
import type { Runtime } from "./runtime.js";
import type { Session } from "./session.js";

const HOP = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive", "upgrade"]);
const DROP_RESP = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"]);
const MAX_BODY = 32 * 1024 * 1024;

const readBody = async (req: IncomingMessage): Promise<string> => {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new Error("request too large");
    parts.push(c as Buffer);
  }
  return Buffer.concat(parts).toString("utf8");
};

/**
 * Local Streamable-HTTP MCP proxy: `http://127.0.0.1:PORT/<route>` -> upstream URL from routes.json.
 * Client headers (API keys, auth) are forwarded verbatim and never logged or stored. Handles JSON and SSE
 * responses (transformed event-by-event, in order) and tracks per-`Mcp-Session-Id` state.
 */
export function startHttpProxy(rt: Runtime, opts: { port: number; routesFile?: string; host?: string }): Promise<Server> {
  const routesFile = opts.routesFile ?? ROUTES_FILE;
  const sessions = new Map<string, Session>();

  const forwardHeaders = (req: IncomingMessage): Record<string, string> => {
    const h: Record<string, string> = { "accept-encoding": "identity" };
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v !== undefined) h[k] = Array.isArray(v) ? v.join(", ") : v;
    return h;
  };

  async function pipeSse(up: Response, res: ServerResponse, session: Session, abort: AbortController): Promise<void> {
    res.on("close", () => abort.abort());
    const dec = new TextDecoder();
    let buf = "";
    const emit = async (block: string) => {
      const lines = block.split(/\r?\n/);
      const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, ""));
      let out = block;
      if (data.length && data.join("\n").trimStart().startsWith("{")) {
        try {
          const msg = JSON.parse(data.join("\n"));
          const t = await session.fromServer(msg);
          if (t !== msg) out = [...lines.filter((l) => !l.startsWith("data:")), `data: ${JSON.stringify(t)}`].join("\n");
        } catch {
          /* fail open: forward the event untouched */
        }
      }
      res.write(out + "\n\n");
    };
    for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        if (block.trim()) await emit(block);
      }
    }
    if (buf.trim()) await emit(buf);
    res.end();
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, body: string, type = "text/plain"): void => {
      res.writeHead(code, { "content-type": type });
      res.end(body);
    };
    // DNS-rebinding guard: only loopback Host headers are served
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? "")) return send(403, "forbidden host");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") return send(200, "ok");
    const name = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ""));
    const route = loadRoutes(routesFile)[name];
    if (!route) return send(404, `unknown route "${name}" (see routes.json)`);

    const sid = (req.headers["mcp-session-id"] as string | undefined) ?? "";
    const session = sessions.get(sid) ?? rt.newSession(name);
    const headers = forwardHeaders(req);
    const abort = new AbortController();
    let body: string | undefined;

    if (req.method === "POST") {
      body = await readBody(req);
      try {
        const msg = JSON.parse(body);
        if (msg && !Array.isArray(msg)) {
          const { forward, reply } = session.fromClient(msg);
          if (reply) return send(200, JSON.stringify(reply), "application/json");
          if (forward && forward !== msg) body = JSON.stringify(forward);
        }
      } catch {
        /* not JSON: pass through */
      }
    } else if (req.method !== "GET" && req.method !== "DELETE") return send(405, "method not allowed");

    const up = await fetch(route.url, { method: req.method, headers, body, signal: abort.signal });
    const newSid = up.headers.get("mcp-session-id");
    if (newSid) sessions.set(newSid, session);
    if (req.method === "DELETE" && sid) sessions.delete(sid);

    const outHeaders: Record<string, string> = {};
    up.headers.forEach((v, k) => !DROP_RESP.has(k) && (outHeaders[k] = v));
    const ctype = up.headers.get("content-type") ?? "";

    if (ctype.includes("text/event-stream") && up.body) {
      res.writeHead(up.status, outHeaders);
      return pipeSse(up, res, session, abort);
    }
    const text = await up.text();
    let out = text;
    if (ctype.includes("json") && up.ok && text) {
      try {
        const msg = JSON.parse(text);
        if (msg && !Array.isArray(msg)) {
          const t = await session.fromServer(msg);
          if (t !== msg) out = JSON.stringify(t);
        }
      } catch {
        /* fail open */
      }
    }
    res.writeHead(up.status, outHeaders);
    res.end(out);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error & { cause?: { code?: string; message?: string } }) => {
      // `fetch failed` alone is useless: surface the underlying cause (DNS, TLS, refused, timeout...)
      const why = e.cause ? `${e.message}: ${e.cause.code ?? ""} ${e.cause.message ?? ""}`.trim() : e.message;
      const hint = /SELF_SIGNED|UNABLE_TO_VERIFY|CERT_/.test(why) ? " (private CA: run mto serve on Node >= 22.15, or set NODE_EXTRA_CA_CERTS=/path/to/ca.pem)" : "";
      process.stderr.write(`[mto:http] upstream error for ${req.url}: ${why}${hint}\n`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`mto proxy error: ${why}${hint}`);
      } else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => resolve(server));
  });
}
