import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { globToRegex, type Config } from "./config.js";
import { discover, planOrApply, type AgentTarget, type Change } from "./installer.js";
import { lineDiff } from "./lineDiff.js";
import { loadRoutes } from "./routes.js";

export type ServerMode = "off" | "shadow" | "active" | "default";

export interface ConnServer {
  name: string;
  kind: "stdio" | "http" | "sse" | "other";
  wrapped: boolean;
  /** protected = behind mto; proxy-down = routed to the local proxy but the route is missing */
  status: "protected" | "unprotected" | "proxy-down" | "unsupported";
  /** Soft-disconnect state: the per-server mode rule (`tools."<server>.*".mode`), or the global default. */
  mode: ServerMode;
}

export interface ConnFile {
  agent: string;
  file: string;
  keyPath: string;
  backup?: { file: string; modifiedAt: string };
  servers: ConnServer[];
}

const serverMode = (cfg: Config, server: string): ServerMode => {
  for (const [glob, rule] of Object.entries(cfg.tools)) if (rule.mode && globToRegex(glob).test(`${server}.*`) && glob.endsWith(".*")) return rule.mode;
  return "default";
};

/** Agent -> file -> server tree with protection status, per-server mode and backups. Read-only. */
export function listConnections(targets: AgentTarget[], cfg: Config, routesFile?: string): { files: ConnFile[]; unparsable: { agent: string; file: string }[] } {
  const routes = loadRoutes(routesFile);
  const { found, unparsable } = discover(targets);
  const files = found.map((d): ConnFile => {
    const bak = `${d.file}.mto.bak`;
    return {
      agent: d.agent,
      file: d.file,
      keyPath: d.keyPath,
      backup: existsSync(bak) ? { file: bak, modifiedAt: statSync(bak).mtime.toISOString() } : undefined,
      servers: d.servers.map((s) => ({
        name: s.name,
        kind: s.kind,
        wrapped: s.wrapped,
        status: s.kind === "sse" || s.kind === "other" ? "unsupported" : s.route && !routes[s.route] ? "proxy-down" : s.wrapped ? "protected" : "unprotected",
        mode: serverMode(cfg, s.name),
      })),
    };
  });
  return { files, unparsable };
}

export interface ConnectionPreview {
  changes: Change[];
  diffs: Array<{ file: string; diff: string }>;
  note: string;
}

/**
 * Dry run with a real diff: the affected files are copied to a temp folder, the SAME planOrApply code used by
 * `mto init/uninstall` is applied there (JSONC comments preserved), and the copies are diffed against the originals.
 * Nothing real is written.
 */
export function previewConnection(op: "wrap" | "unwrap", server: string, targets: AgentTarget[], cliPath: string): ConnectionPreview {
  const dir = mkdtempSync(join(tmpdir(), "mto-preview-"));
  const copies = targets.filter((t) => existsSync(t.file)).map((t, i) => ({ orig: t, copy: { ...t, file: join(dir, `${i}-${basename(t.file)}`) } }));
  for (const c of copies) copyFileSync(c.orig.file, c.copy.file);
  const routesFile = join(dir, "routes.json");
  const changes = planOrApply({ mode: op, apply: true, cliPath, only: [server], targets: copies.map((c) => c.copy), routesFile });
  const back = (f: string) => copies.find((c) => c.copy.file === f)?.orig.file ?? f;
  const diffs = copies.flatMap((c) => {
    const diff = lineDiff(readFileSync(c.orig.file, "utf8"), readFileSync(c.copy.file, "utf8"));
    return diff ? [{ file: c.orig.file, diff }] : [];
  });
  return { changes: changes.map((c) => ({ ...c, file: back(c.file) })), diffs, note: "The agent must restart this server for the change to take effect." };
}

export function applyConnection(op: "wrap" | "unwrap", server: string, targets: AgentTarget[], cliPath: string): Change[] {
  return planOrApply({ mode: op, apply: true, cliPath, only: [server], targets });
}

/** Restore a file from its `.mto.bak`. The current file is kept as `.mto.pre-restore` first. */
export function restoreBackup(file: string, targets: AgentTarget[]): { ok: boolean; error?: string } {
  if (!targets.some((t) => t.file === file)) return { ok: false, error: "not one of the known agent config files" };
  const bak = `${file}.mto.bak`;
  if (!existsSync(bak)) return { ok: false, error: "no backup for that file" };
  if (existsSync(file)) copyFileSync(file, `${file}.mto.pre-restore`);
  copyFileSync(bak, file);
  return { ok: true };
}
