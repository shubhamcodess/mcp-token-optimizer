import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { ConfigSchema, defaultConfig, findConfigPath, HOME_DIR, type Config } from "./config.js";

/** Where `config set` writes: the file the loader would use, or the default location if none exists yet. */
export const configPath = (explicit?: string): string => explicit ?? findConfigPath() ?? join(HOME_DIR, "config.yaml");

/** `a.b."c.d".e` -> ["a","b","c.d","e"] (quote a segment that contains dots, e.g. a tool glob). */
export function splitKey(key: string): string[] {
  return [...key.matchAll(/"([^"]+)"|([^.]+)/g)].map((m) => m[1] ?? m[2]);
}

export function getConfigValue(cfg: Config, key?: string): unknown {
  if (!key) return cfg;
  let cur: any = cfg;
  for (const seg of splitKey(key)) {
    if (cur === null || typeof cur !== "object" || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export const formatValue = (v: unknown): string => (v !== null && typeof v === "object" ? stringify(v).trimEnd() : String(v));

export type SetResult = { ok: true; path: string; value: unknown } | { ok: false; error: string };

/**
 * Set one key in the YAML config, keeping comments and layout. The result is validated against the full schema before
 * anything is written; unknown keys are rejected so a typo never silently does nothing.
 */
export function setConfigValue(file: string, key: string, raw: string): SetResult {
  const path = splitKey(key);
  if (!path.length) return { ok: false, error: "empty key" };
  // typo guard: everything except entries under `tools` (and free-form llm.options) must already exist in the defaults
  const freeForm = path[0] === "tools" || (path[0] === "llm" && path[1] === "options");
  if (!freeForm) {
    const parent = path.length > 1 ? getConfigValue(defaultConfig(), path.slice(0, -1).map((s) => (s.includes(".") ? `"${s}"` : s)).join(".")) : defaultConfig();
    if (parent === null || typeof parent !== "object" || !(path[path.length - 1] in (parent as object))) return { ok: false, error: `unknown config key "${key}" (see \`mto config get\` for valid keys)` };
  }
  let value: unknown;
  try {
    value = parse(raw);
  } catch {
    value = raw;
  }
  const doc = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
  if (doc.errors.length) return { ok: false, error: `${file} is not valid YAML: ${doc.errors[0].message}` };
  if (!doc.contents) doc.contents = doc.createNode({}) as never;
  doc.setIn(path, value);
  const check = ConfigSchema.safeParse(doc.toJS());
  if (!check.success) return { ok: false, error: check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, String(doc));
  return { ok: true, path: file, value };
}

/** Remove one key (or a whole section) so it falls back to its default. Validated before writing; comments elsewhere survive. */
export function unsetConfigValue(file: string, key: string): SetResult {
  const path = splitKey(key);
  if (!path.length || !existsSync(file)) return { ok: true, path: file, value: undefined };
  const doc = parseDocument(readFileSync(file, "utf8"));
  if (doc.errors.length) return { ok: false, error: `${file} is not valid YAML: ${doc.errors[0].message}` };
  doc.deleteIn(path);
  const check = ConfigSchema.safeParse(doc.toJS() ?? {});
  if (!check.success) return { ok: false, error: check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  writeFileSync(file, String(doc));
  return { ok: true, path: file, value: undefined };
}
