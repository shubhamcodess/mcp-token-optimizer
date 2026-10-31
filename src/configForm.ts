import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { ConfigSchema, defaultConfig, type Config } from "./config.js";
import { getConfigValue } from "./configEdit.js";
import { lineDiff } from "./lineDiff.js";

export interface Field {
  path: string;
  section: string;
  kind: "boolean" | "number" | "string" | "enum" | "string-list" | "json";
  options?: string[];
  value: unknown;
  default: unknown;
  description?: string;
  /** Not editable in the form (shown for reference). */
  readOnly?: boolean;
}

/** Short help for the keys people touch most; every key still appears, described or not. */
const HELP: Record<string, string> = {
  mode: "off: untouched · shadow: measure only · active: optimize",
  profile: "How much JSON noise is pruned",
  skipBelowTokens: "Results smaller than this are forwarded untouched",
  "llm.model": "Local Ollama model used for summaries",
  "llm.baseUrl": "Ollama endpoint (local)",
  "llm.keepAlive": "How long Ollama keeps the model loaded",
  "llm.timeoutMs": "Per-request ceiling",
  "llm.think": "Disable thinking mode of reasoning models",
  "summarize.enabled": "false = never call the LLM",
  "summarize.minTokens": "Only text above this is considered",
  "summarize.maxLatencyMs": "Hard budget per tool result",
  "summarize.minCoverage": "Fraction of key facts that must survive",
  "format.default": "auto | json | json-pretty | toon",
  "format.prettyJsonAboveTokens": "Large results become pretty JSON (0 = off). Recommended 8000 for clients that save results to files",
  "format.announceToon": "Explain TOON and notes in the MCP initialize instructions",
  "prune.dropKeys": "Extra key-name globs dropped everywhere",
  "prune.keepKeys": "Key-name globs never dropped",
  "prune.maxArrayItems": "Truncate longer arrays (0 = unlimited)",
  "redaction.mode": "off | detect | redact",
  "retrieval.enabled": "Store originals and expose mto_expand",
  "retrieval.ttlMinutes": "How long originals are kept",
  "audit.enabled": "Size-only log per tool call",
  "audit.maxMb": "Roll up and trim the log beyond this size",
  "ui.autoStart": "Wrappers start the daemon when it is not running",
  "drift.enabled": "Watch agent configs for new or unwrapped servers",
  "drift.autoWrap": "Agents (name substrings) whose new servers are wrapped automatically",
  tools: "Per-tool rules: edit on the Traffic page",
  clients: "Per-client overrides by clientInfo.name glob",
};

const inner = (s: any): any => {
  let cur = s;
  for (;;) {
    const t = cur?._def?.typeName;
    if (t === "ZodDefault" || t === "ZodOptional" || t === "ZodNullable") cur = cur._def.innerType;
    else if (t === "ZodEffects") cur = cur._def.schema;
    else return cur;
  }
};

/** Form descriptors generated from the zod schema: type, enum options, default and current value for every key. */
export function describeConfig(config: Config): Field[] {
  const defaults = defaultConfig();
  const out: Field[] = [];
  const walk = (schema: any, path: string[]) => {
    const s = inner(schema);
    const t = s?._def?.typeName as string;
    const key = path.join(".");
    const base = { path: key, section: path[0], value: getConfigValue(config, key), default: getConfigValue(defaults, key), description: HELP[key] };
    if (t === "ZodObject") for (const [k, v] of Object.entries(s.shape as Record<string, unknown>)) walk(v, [...path, k]);
    else if (t === "ZodBoolean") out.push({ ...base, kind: "boolean" });
    else if (t === "ZodNumber") out.push({ ...base, kind: "number" });
    else if (t === "ZodString") out.push({ ...base, kind: "string" });
    else if (t === "ZodEnum") out.push({ ...base, kind: "enum", options: s._def.values });
    else if (t === "ZodLiteral") out.push({ ...base, kind: "string", readOnly: true });
    else if (t === "ZodArray" && inner(s._def.type)?._def?.typeName === "ZodString") out.push({ ...base, kind: "string-list" });
    else out.push({ ...base, kind: "json", readOnly: path[0] === "tools" });
  };
  walk(ConfigSchema, []);
  return out;
}

export const readConfigText = (file: string): string => (existsSync(file) ? readFileSync(file, "utf8") : "");

/** Validate raw YAML against the schema and diff it against the file on disk. Writes nothing. */
export function previewRaw(file: string, yaml: string): { ok: boolean; error?: string; diff?: string } {
  try {
    const res = ConfigSchema.safeParse(parse(yaml) ?? {});
    if (!res.success) return { ok: false, error: res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  } catch (e) {
    return { ok: false, error: `YAML error: ${(e as Error).message}` };
  }
  return { ok: true, diff: lineDiff(readConfigText(file), yaml) };
}

export function saveRaw(file: string, yaml: string): { ok: boolean; error?: string } {
  const p = previewRaw(file, yaml);
  if (!p.ok) return p;
  writeFileSync(file, yaml.endsWith("\n") ? yaml : yaml + "\n");
  return { ok: true };
}
