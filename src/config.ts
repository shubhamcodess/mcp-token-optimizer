import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const HOME_DIR = process.env.MTO_HOME ?? join(homedir(), ".mcp-token-optimizer");

/** json = minified, json-pretty = 2-space indented (safe when a client saves big results to a file and parses/reads them by line). */
const Format = z.enum(["auto", "json", "json-pretty", "toon"]);
const Profile = z.enum(["conservative", "balanced", "aggressive"]);

const ToolRule = z
  .object({
    mode: z.enum(["active", "shadow", "off"]).optional(),
    format: Format.optional(),
    summarize: z.boolean().optional(),
    dropKeys: z.array(z.string()).optional(),
    keepKeys: z.array(z.string()).optional(),
    maxArrayItems: z.number().int().min(0).optional(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    /** active: rewrite responses. shadow: measure only, forward originals. off: transparent pass-through. */
    mode: z.enum(["active", "shadow", "off"]).default("active"),
    profile: Profile.default("balanced"),
    llm: z
      .object({
        provider: z.literal("ollama").default("ollama"),
        baseUrl: z.string().default("http://127.0.0.1:11434"),
        model: z.string().default("qwen3:4b"),
        /** Passed straight to Ollama `options` (temperature, num_ctx, top_p, num_predict, ...). */
        options: z.record(z.unknown()).default({ temperature: 0.1, top_p: 0.9, num_ctx: 8192, num_predict: 1024 }),
        keepAlive: z.string().default("10m"),
        /** Per-request ceiling. Effective timeout is also capped by summarize.maxLatencyMs. */
        timeoutMs: z.number().int().positive().default(30_000),
        /** Disable "thinking" for reasoning models (faster, deterministic summaries). */
        think: z.boolean().default(false),
      })
      .default({}),
    summarize: z
      .object({
        enabled: z.boolean().default(true),
        /** Only text above this many (estimated) tokens is sent to the local LLM. */
        minTokens: z.number().int().positive().default(1200),
        /** Hard wall-clock budget for summarizing one tool result. Chunks not finished in time stay verbatim. */
        maxLatencyMs: z.number().int().positive().default(20_000),
        /** Parallel chunk requests. Only helps if Ollama runs with OLLAMA_NUM_PARALLEL > 1. */
        concurrency: z.number().int().min(1).max(8).default(1),
        /** Target output size relative to input. */
        targetRatio: z.number().min(0.05).max(0.9).default(0.35),
        /** Fraction of "critical tokens" (ids, numbers, paths, urls...) that must survive. */
        minCoverage: z.number().min(0).max(1).default(0.97),
        /** Tools whose output is never summarized (file reads, diffs, edits...). Glob on `server.tool`. */
        neverTools: z
          .array(z.string())
          .default(["*read_file*", "*read_text_file*", "*read_multiple_files*", "*get_file_contents*", "*edit*", "*write*", "*diff*", "*patch*"]),
      })
      .default({}),
    format: z
      .object({
        default: Format.default("auto"),
        /** Tools that must keep JSON (e.g. output is machine-parsed). Glob on `server.tool`. */
        jsonTools: z.array(z.string()).default([]),
        /**
         * Results bigger than this many (estimated) tokens are emitted as pretty JSON instead of TOON: clients such as
         * VS Code Copilot offload large results to a file and then parse it with json.load or read it by line range.
         * 0 = off.
         */
        prettyJsonAboveTokens: z.number().int().min(0).default(0),
        /** Hint the agent that TOON may appear (added to MCP `initialize.instructions`). */
        announceToon: z.boolean().default(true),
      })
      .default({}),
    prune: z
      .object({
        dropNull: z.boolean().optional(),
        dropEmpty: z.boolean().optional(),
        dropKeys: z.array(z.string()).default([]),
        keepKeys: z.array(z.string()).default([]),
        maxArrayItems: z.number().int().min(0).optional(),
        stripBlobsOverBytes: z.number().int().min(0).optional(),
        /** Replace long runs of lines that repeat verbatim in another field with a pointer (default: on unless profile=conservative). */
        dedupeAcrossFields: z.boolean().optional(),
      })
      .default({}),
    toolDefinitions: z
      .object({
        /** Also slim `tools/list` (drops $schema/title/examples...). Off by default: schemas are contracts. */
        enabled: z.boolean().default(false),
        stripKeys: z.array(z.string()).default(["$schema", "title", "examples", "$comment"]),
      })
      .default({}),
    redaction: z
      .object({
        /** detect: log-only. redact: replace secrets with [REDACTED:type]. off: skip. */
        mode: z.enum(["off", "detect", "redact"]).default("detect"),
        extraPatterns: z.array(z.object({ name: z.string(), regex: z.string() })).default([]),
      })
      .default({}),
    retrieval: z
      .object({
        /** Expose `mto_expand` so the agent can pull any lossy-trimmed original back on demand. */
        enabled: z.boolean().default(true),
        ttlMinutes: z.number().int().positive().default(240),
        maxEntries: z.number().int().positive().default(500),
      })
      .default({}),
    /** Where `mto init`/`discover` look for MCP server lists, beyond the built-in agent locations. */
    discovery: z
      .object({
        /** Extra config files: "path" (key path auto-detected) or "path#keyPath". `~` and $ENV vars expand. */
        files: z.array(z.string()).default([]),
        /** Directories scanned (depth <= 4) for mcp.json / .mcp.json / *mcp*.json style files. */
        scanDirs: z.array(z.string()).default([]),
        /** Include the built-in agent locations (Claude, VS Code, Cursor, …). false = only files you name yourself. */
        builtin: z.boolean().default(true),
        /** Built-in agents to ignore, matched as a case-insensitive substring of the agent name. */
        skip: z.array(z.string()).default([]),
      })
      .default({}),
    /** Skip everything for responses smaller than this (tokens). */
    skipBelowTokens: z.number().int().min(0).default(40),
    cache: z.object({ enabled: z.boolean().default(true), maxEntries: z.number().int().default(200) }).default({}),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        path: z.string().default(join(HOME_DIR, "stats.jsonl")),
        pricePerMTokUsd: z.number().default(3),
      })
      .default({}),
    /** Per `server.tool` glob overrides. First match wins. */
    tools: z.record(ToolRule).default({}),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type ToolRuleT = z.infer<typeof ToolRule>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function findConfigPath(explicit?: string): string | undefined {
  const candidates = [explicit, process.env.MTO_CONFIG, resolve("mto.config.yaml"), join(HOME_DIR, "config.yaml")];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

export function loadConfig(explicit?: string): { config: Config; path?: string } {
  const path = findConfigPath(explicit);
  if (!path) return { config: defaultConfig() };
  const raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  const res = ConfigSchema.safeParse(raw);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid config ${path}:\n${msg}`);
  }
  // `~` and $VARS are expanded so users can write portable paths
  const expand = (v: string) => v.replace(/\$\{?(\w+)\}?/g, (_m, n: string) => process.env[n] ?? "").replace(/^~(?=$|\/)/, homedir());
  res.data.audit.path = expand(res.data.audit.path);
  return { config: res.data, path };
}

export function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

export function matchesAny(globs: string[], subject: string): boolean {
  return globs.some((g) => globToRegex(g).test(subject));
}

export function toolRule(cfg: Config, subject: string): ToolRuleT {
  for (const [glob, rule] of Object.entries(cfg.tools)) if (globToRegex(glob).test(subject)) return rule;
  return {};
}
