import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { DEFAULT_PORT, loadRoutes, saveRoutes, type Routes } from "./routes.js";

/** Where each supported agent keeps its MCP server list, and which JSON key holds the servers. */
export interface AgentTarget {
  agent: string;
  file: string;
  /** Dotted path to the servers map ("*" fans out over Claude Code's per-project entries). Omit or "auto" to detect. */
  keyPath?: string;
}

export function expandPath(p: string, cwd = process.cwd()): string {
  const withEnv = p.replace(/\$\{?(\w+)\}?/g, (_m, v: string) => process.env[v] ?? "").replace(/^~(?=$|\/)/, homedir());
  return resolve(cwd, withEnv);
}

/** "path" or "path#keyPath" -> target with auto/explicit key path. */
export function parseTargetSpec(spec: string, cwd = process.cwd(), agent = "custom"): AgentTarget {
  const [file, keyPath] = spec.split("#");
  return { agent: `${agent}: ${basename(file)}`, file: expandPath(file, cwd), keyPath: keyPath || "auto" };
}

const CONFIG_NAME = /^(?:\.?mcp|mcp[_-]?config|mcp[_-]?settings|claude_desktop_config|cline_mcp_settings|mcp_settings)\.json$/i;

/** Finds MCP config files under `dir` (depth <= 4, skipping node_modules/.git). */
export function scanForConfigs(dir: string, depth = 4): string[] {
  const out: string[] = [];
  const walk = (d: string, n: number) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules" || name === ".git" || name === ".Trash") continue;
      const f = join(d, name);
      let st;
      try {
        st = statSync(f);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (n > 0) walk(f, n - 1);
      } else if (CONFIG_NAME.test(name)) out.push(f);
    }
  };
  walk(resolve(dir), depth);
  return out;
}

export function agentTargets(cwd = process.cwd()): AgentTarget[] {
  const h = homedir();
  const appSupport = platform() === "darwin" ? join(h, "Library", "Application Support") : platform() === "win32" ? (process.env.APPDATA ?? join(h, "AppData", "Roaming")) : join(h, ".config");
  const vscodeUserDirs = ["Code", "Code - Insiders", "VSCodium", "Cursor"].map((d) => join(appSupport, d, "User", "mcp.json"));
  return [
    { agent: "Claude Code (user)", file: join(h, ".claude.json"), keyPath: "mcpServers" },
    { agent: "Claude Code (projects)", file: join(h, ".claude.json"), keyPath: "projects.*.mcpServers" },
    { agent: "Claude Code (.mcp.json)", file: join(cwd, ".mcp.json"), keyPath: "mcpServers" },
    { agent: "Claude Desktop", file: join(appSupport, "Claude", "claude_desktop_config.json"), keyPath: "mcpServers" },
    { agent: "GitHub Copilot / VS Code (workspace)", file: join(cwd, ".vscode", "mcp.json"), keyPath: "servers" },
    ...vscodeUserDirs.map((file) => ({ agent: `GitHub Copilot / VS Code (user: ${file.split("/").slice(-3, -2)[0]})`, file, keyPath: "servers" })),
    { agent: "Cursor", file: join(h, ".cursor", "mcp.json"), keyPath: "mcpServers" },
    { agent: "Windsurf", file: join(h, ".codeium", "windsurf", "mcp_config.json"), keyPath: "mcpServers" },
    { agent: "Gemini CLI", file: join(h, ".gemini", "settings.json"), keyPath: "mcpServers" },
    { agent: "Cline", file: join(appSupport, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), keyPath: "mcpServers" },
    { agent: "Roo Code", file: join(appSupport, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), keyPath: "mcpServers" },
    { agent: "VS Code settings.json (mcp.servers)", file: join(appSupport, "Code", "User", "settings.json"), keyPath: "mcp.servers" },
  ];
}

type Server = { command?: string; args?: string[]; url?: string; type?: string; [k: string]: unknown };
type Path = (string | number)[];

/** Concrete JSON paths to every servers map matched by keyPath. */
function serverMaps(root: any, keyPath: string): { path: Path; map: Record<string, Server> }[] {
  let level: { path: Path; node: any }[] = [{ path: [], node: root }];
  for (const p of keyPath.split(".")) {
    const next: typeof level = [];
    for (const { path, node } of level) {
      if (!node || typeof node !== "object") continue;
      if (p === "*") for (const [k, v] of Object.entries(node)) next.push({ path: [...path, k], node: v });
      else next.push({ path: [...path, p], node: node[p] });
    }
    level = next;
  }
  return level.filter((l) => l.node && typeof l.node === "object" && !Array.isArray(l.node)).map((l) => ({ path: l.path, map: l.node }));
}

const CANDIDATE_KEYPATHS = ["mcpServers", "servers", "mcp.servers", "projects.*.mcpServers", "mcp"];

/** Key paths in `root` that hold a non-empty map of server entries (objects with command/url). */
export function guessKeyPaths(root: any): string[] {
  return CANDIDATE_KEYPATHS.filter((kp) =>
    serverMaps(root, kp).some(({ map }) => Object.values(map).some((s) => s && typeof s === "object" && ("command" in s || "url" in s))),
  );
}

export interface Discovered {
  agent: string;
  file: string;
  keyPath: string;
  servers: { name: string; kind: "stdio" | "http" | "sse" | "other"; wrapped: boolean }[];
}

/** Read-only inventory of every MCP server list reachable from `targets`. */
export function discover(targets: AgentTarget[], proxyBase = `http://127.0.0.1:${DEFAULT_PORT}`): { found: Discovered[]; unparsable: { agent: string; file: string }[]; missing: AgentTarget[] } {
  const found: Discovered[] = [];
  const unparsable: { agent: string; file: string }[] = [];
  const missing: AgentTarget[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (!existsSync(t.file)) {
      missing.push(t);
      continue;
    }
    const errors: ParseError[] = [];
    const root = parse(readFileSync(t.file, "utf8"), errors, { allowTrailingComma: true });
    if (errors.length || !root || typeof root !== "object") {
      unparsable.push({ agent: t.agent, file: t.file });
      continue;
    }
    for (const kp of !t.keyPath || t.keyPath === "auto" ? guessKeyPaths(root) : [t.keyPath]) {
      const id = `${t.file}#${kp}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const servers = serverMaps(root, kp).flatMap(({ map }) =>
        Object.entries(map).map(([name, s]) => ({
          name,
          kind: (s.command ? "stdio" : typeof s.url === "string" ? (s.type === "sse" ? "sse" : "http") : "other") as "stdio" | "http" | "sse" | "other",
          wrapped: isWrapped(s) || (typeof s.url === "string" && s.url.startsWith(proxyBase + "/")),
        })),
      );
      if (servers.length) found.push({ agent: t.agent, file: t.file, keyPath: kp, servers });
    }
  }
  return { found, unparsable, missing };
}

export const isWrapped = (s: Server) => s.args?.[1] === "wrap" && s.args.includes("--") && /cli\.(?:js|ts)$/.test(s.args[0]);

export interface Change {
  agent: string;
  file: string;
  server: string;
  action: "wrap" | "unwrap" | "wrap-http" | "unwrap-http" | "skip-remote" | "skip-wrapped" | "unparsable";
  detail?: string;
}

const FMT = { tabSize: 2, insertSpaces: true };

/**
 * Plans (or applies) wrapping. Files are edited IN PLACE with jsonc-parser so comments, trailing commas and
 * formatting (VS Code's mcp.json is JSONC) survive; a `.mto.bak` copy is written once per file.
 */
export function planOrApply(opts: { mode: "wrap" | "unwrap"; apply: boolean; cliPath: string; configPath?: string; only?: string[]; cwd?: string; targets?: AgentTarget[]; proxyBase?: string; routesFile?: string }): Change[] {
  const changes: Change[] = [];
  const base = opts.proxyBase ?? `http://127.0.0.1:${DEFAULT_PORT}`;
  const routes: Routes = loadRoutes(opts.routesFile);
  let routesTouched = false;
  const texts = new Map<string, string>();
  const dirty = new Set<string>();

  for (const t of opts.targets ?? agentTargets(opts.cwd)) {
    if (!existsSync(t.file)) continue;
    if (!texts.has(t.file)) texts.set(t.file, readFileSync(t.file, "utf8"));
    const errors: ParseError[] = [];
    const root = parse(texts.get(t.file)!, errors, { allowTrailingComma: true });
    if (errors.length || !root || typeof root !== "object") {
      if (!changes.some((c) => c.file === t.file && c.action === "unparsable")) changes.push({ agent: t.agent, file: t.file, server: "-", action: "unparsable", detail: `${errors.length} parse error(s)` });
      continue;
    }
    const set = (path: Path, value: unknown) => {
      texts.set(t.file, applyEdits(texts.get(t.file)!, modify(texts.get(t.file)!, path, value, { formattingOptions: FMT })));
      dirty.add(t.file);
    };

    const keyPaths = !t.keyPath || t.keyPath === "auto" ? guessKeyPaths(root) : [t.keyPath];
    for (const { path, map } of keyPaths.flatMap((kp) => serverMaps(root, kp))) {
      for (const [name, s] of Object.entries(map)) {
        if (opts.only?.length && !opts.only.includes(name)) continue;
        const at = [...path, name];
        const rec = (action: Change["action"]) => changes.push({ agent: t.agent, file: t.file, server: name, action });

        if (opts.mode === "wrap") {
          if (!s.command) {
            if (typeof s.url !== "string" || s.type === "sse") rec("skip-remote"); // legacy SSE transport isn't proxied
            else if (s.url.startsWith(base + "/")) rec("skip-wrapped");
            else {
              rec("wrap-http");
              if (opts.apply) {
                // same name+url reuses its route; a different upstream under the same name gets a stable suffix
                let key = name;
                if (routes[key] && routes[key].url !== s.url) key = `${name}-${createHash("sha1").update(s.url).digest("hex").slice(0, 6)}`;
                routes[key] = { url: s.url };
                routesTouched = true;
                set([...at, "url"], `${base}/${encodeURIComponent(key)}`);
              }
            }
            continue;
          }
          if (isWrapped(s)) {
            rec("skip-wrapped");
            continue;
          }
          rec("wrap");
          if (opts.apply) {
            const extra = opts.configPath ? ["--config", resolve(opts.configPath)] : [];
            set([...at, "command"], process.execPath);
            set([...at, "args"], [opts.cliPath, "wrap", "--name", name, ...extra, "--", s.command, ...(s.args ?? [])]);
          }
        } else if (!s.command && typeof s.url === "string" && s.url.startsWith(base + "/")) {
          const key = decodeURIComponent(s.url.slice(base.length + 1));
          rec("unwrap-http");
          if (opts.apply && routes[key]) set([...at, "url"], routes[key].url);
        } else if (isWrapped(s)) {
          rec("unwrap");
          if (opts.apply) {
            const [command, ...args] = s.args!.slice(s.args!.indexOf("--") + 1);
            set([...at, "command"], command);
            set([...at, "args"], args.length ? args : undefined);
          }
        }
      }
    }
  }

  if (opts.apply) {
    if (routesTouched) saveRoutes(routes, opts.routesFile);
    for (const file of dirty) {
      const bak = `${file}.mto.bak`;
      if (!existsSync(bak)) copyFileSync(file, bak);
      writeFileSync(file, texts.get(file)!);
    }
  }
  return changes;
}
