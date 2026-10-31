interface Cmd {
  name: string;
  group: string;
  summary: string;
  usage: string[];
  flags?: Array<[string, string]>;
  examples?: string[];
}

const DISCOVERY_FLAGS: Array<[string, string]> = [
  ["--file <path[#keyPath]>", "extra MCP config file (repeatable)"],
  ["--scan <dir>", "find mcp.json-style files under a directory (depth <= 4)"],
  ["--skip <agent>", "ignore a built-in agent (repeatable or comma-separated)"],
  ["--no-builtin", "only the files you name, ignore the built-in agent locations"],
];

export const COMMANDS: Cmd[] = [
  { name: "discover", group: "Set up", summary: "List every MCP config and server found (read-only)", usage: ["mto discover [--scan dir] [--file path[#keyPath]] [--skip agent] [--no-builtin]"], flags: DISCOVERY_FLAGS, examples: ["mto discover", "mto discover --no-builtin --file ~/work/mcp.json"] },
  { name: "init", group: "Set up", summary: "Wrap stdio servers and route http servers through mto", usage: ["mto init [--apply] [--only a,b] [discovery flags] [--config f]"], flags: [["--apply", "write the changes (without it: dry run)"], ["--only <a,b>", "only these server names"], ...DISCOVERY_FLAGS], examples: ["mto init --only github", "mto init --only github --apply"] },
  { name: "uninstall", group: "Set up", summary: "Restore the original server commands and URLs", usage: ["mto uninstall [--apply] [discovery flags]"], flags: [["--apply", "write the changes (without it: dry run)"], ...DISCOVERY_FLAGS] },
  { name: "config", group: "Set up", summary: "Show, change or create the config file", usage: ["mto config path", "mto config get [key]", "mto config set <key> <value>", "mto config edit", "mto config init"], examples: ["mto config get summarize", "mto config set summarize.enabled false", "mto config set mode shadow", 'mto config set tools."github.list_*".maxArrayItems 100'] },
  { name: "models", group: "Set up", summary: "List local Ollama models, choose one, test it, or pull a new one", usage: ["mto models", "mto models use <name>", "mto models test [name]", "mto models pull <name>"], examples: ["mto models", "mto models use granite4:3b", "mto models pull llama3.2:3b", "mto models test"] },
  { name: "wrap", group: "Run", summary: "Run one stdio MCP server through the optimizer (what init installs)", usage: ["mto wrap [--name n] [--config f] -- <cmd> [args...]"], examples: ["mto wrap --name github -- npx -y @modelcontextprotocol/server-github"] },
  { name: "serve", group: "Run", summary: "Run the local daemon: HTTP proxy for remote MCP servers plus the dashboard API", usage: ["mto serve [--port 8787] [--config f]"], flags: [["--port <n>", "listen port (default: ui.port, 8787)"]] },
  { name: "status", group: "Run", summary: "Is the daemon up, which proxies are connected, last-24h savings", usage: ["mto status [--config f]"] },
  { name: "ui", group: "Run", summary: "Start the daemon if needed and open the dashboard", usage: ["mto ui [--no-open]"], flags: [["--no-open", "print the link only"]] },
  { name: "try", group: "Measure", summary: "Optimize a saved tool response and show before/after", usage: ["mto try <file|-> [--tool name] [--server name] [--config f]"], examples: ["mto try examples/github-issues.json"] },
  { name: "capture", group: "Measure", summary: "Record raw (secret-redacted) tool results locally, live", usage: ["mto capture on|off|status"] },
  { name: "bench", group: "Measure", summary: "Replay captures: savings, latency, fact retention", usage: ["mto bench [dir] [--llm] [--models a,b] [--dump prefix] [--cap N]"], examples: ["mto bench --models qwen3:4b,granite4:3b"] },
  { name: "compare", group: "Measure", summary: "Original vs what the agent received (needs capture + active mode)", usage: ["mto compare [--tool glob] [--last N]"] },
  { name: "stats", group: "Measure", summary: "Token savings report from the audit log", usage: ["mto stats [--since 7d|24h] [--json]"] },
  { name: "doctor", group: "Check", summary: "Check config, Ollama and model availability", usage: ["mto doctor [--config f]"] },
  { name: "help", group: "Info", summary: "Overview, per-command help and topics", usage: ["mto help [command|topic]", "mto <command> --help"], examples: ["mto help serve", "mto help local-only"] },
  { name: "docs", group: "Info", summary: "Where each part of the documentation lives", usage: ["mto docs [section] [--open]"], examples: ["mto docs", "mto docs modes --open"] },
  { name: "about", group: "Info", summary: "Version, license, data directory, daemon state", usage: ["mto about"] },
];

export const TOPICS: Record<string, string> = {
  modes: `Modes (config key "mode", overridable per tool under "tools"):
  off      original response, nothing recorded
  shadow   original response, but savings are measured (safe rollout)
  active   optimized response`,
  profiles: `Profiles (config key "profile"): how much JSON noise is pruned.
  conservative  nulls/empties and _links only
  balanced      default: + bookkeeping keys, URI templates, blobs, duplicate blocks
  aggressive    + every *_url key, long arrays truncated (lossy, retrievable via mto_expand)`,
  formats: `Formats (config key "format.default"): auto | json | json-pretty | toon.
  Use json-pretty for large results that the agent saves to a file and parses.`,
  "local-only": `Local only: the optimizer talks only to your own MCP servers and to a local Ollama on 127.0.0.1.
  No telemetry, no cloud model providers. The daemon binds to 127.0.0.1 and requires a per-run token.`,
  security: `Security: loopback bind, Host/Origin checks, per-run bearer token, no CORS, no command execution API.
  Credentials are forwarded to your servers but never stored. The audit log holds sizes only.
  Report issues: see SECURITY.md.`,
};

export const DOC_SECTIONS: Record<string, [string, string]> = {
  quickstart: ["quick-start", "Install and first run"],
  "self-host": ["1-self-host-in-15-minutes", "Install, config, daemon, wiring an agent"],
  try: ["2-try-it-without-any-agent-5-minutes", "Demo with sample data"],
  "how-it-works": ["3-how-it-works", "The pipeline and what is lossless"],
  modes: ["4-operating-modes-off--shadow--active", "off / shadow / active"],
  integration: ["5-integration-modes-stdio-wrapper-vs-http-proxy", "stdio wrapper vs HTTP proxy"],
  profiles: ["6-optimization-profiles", "conservative / balanced / aggressive"],
  formats: ["7-output-formats-json-vs-toon", "JSON vs TOON"],
  summarization: ["8-summarization-with-a-local-ollama-model", "Local model summaries"],
  expand: ["9-getting-the-original-back-mto_expand", "mto_expand"],
  redaction: ["10-secret-detection-and-redaction", "Secret detection"],
  tuning: ["11-capture-bench-compare-tuning-on-your-real-data", "Capture, bench, compare"],
  config: ["12-configuration-reference", "Every config key"],
  cli: ["13-cli-reference", "All commands"],
  files: ["14-files-and-environment-variables", "Where state lives"],
  troubleshooting: ["15-troubleshooting", "Symptoms and fixes"],
  security: ["16-security-and-privacy", "What is stored and forwarded"],
  limitations: ["17-known-limitations-and-verification-status", "What was verified"],
  development: ["18-development", "Code layout and checks"],
};

export const REPO_URL = "https://github.com/shubhamcodess/mcp-token-optimizer";

const pad = (s: string, n: number) => s.padEnd(n);

export function overview(): string {
  const groups = [...new Set(COMMANDS.map((c) => c.group))];
  const out = ["mto - MCP Token Optimizer", "", "Usage: mto <command> [options]     (mto help <command> for details)", ""];
  for (const g of groups) {
    out.push(`${g}:`);
    for (const c of COMMANDS.filter((x) => x.group === g)) out.push(`  ${pad(c.name, 11)}${c.summary}`);
    out.push("");
  }
  out.push(`Topics: ${Object.keys(TOPICS).join(", ")}   (mto help <topic>)`, "init/uninstall are dry-runs unless --apply is given. Configs are backed up as <file>.mto.bak.");
  return out.join("\n");
}

export function commandHelp(name: string): string | undefined {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) return undefined;
  const out = [`mto ${c.name}: ${c.summary}`, "", "Usage:", ...c.usage.map((u) => `  ${u}`)];
  if (c.flags?.length) out.push("", "Options:", ...c.flags.map(([f, d]) => `  ${pad(f, 26)}${d}`));
  if (c.examples?.length) out.push("", "Examples:", ...c.examples.map((e) => `  ${e}`));
  return out.join("\n");
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest known command (or topic) to a mistyped word, if it is plausibly a typo. */
export function suggest(word: string, pool = COMMANDS.map((c) => c.name)): string | undefined {
  const w = word.toLowerCase();
  const scored = pool.map((p) => [p, p.startsWith(w) && w.length >= 2 ? 0 : distance(w, p)] as const).sort((a, b) => a[1] - b[1]);
  return scored[0] && scored[0][1] <= Math.max(2, Math.floor(w.length / 3)) ? scored[0][0] : undefined;
}

export function helpFor(arg?: string): { text: string; code: number } {
  if (!arg) return { text: overview(), code: 0 };
  const cmd = commandHelp(arg);
  if (cmd) return { text: cmd, code: 0 };
  if (TOPICS[arg]) return { text: TOPICS[arg], code: 0 };
  const s = suggest(arg, [...COMMANDS.map((c) => c.name), ...Object.keys(TOPICS)]);
  return { text: `mto help: no command or topic "${arg}".${s ? ` Did you mean "${s}"?` : ""}\nRun \`mto help\` for the list.`, code: 2 };
}

export function docsHelp(section?: string): { text: string; url?: string; code: number } {
  const readme = `${REPO_URL}#readme`;
  if (!section) {
    return { text: ["Documentation sections (mto docs <section> [--open]):", ...Object.entries(DOC_SECTIONS).map(([k, [, d]]) => `  ${pad(k, 16)}${d}`), "", `Full README: ${readme}`, "Also: TESTING.md, CONTRIBUTING.md, CHANGELOG.md, SECURITY.md in the repository."].join("\n"), url: readme, code: 0 };
  }
  const hit = DOC_SECTIONS[section];
  if (!hit) {
    const s = suggest(section, Object.keys(DOC_SECTIONS));
    return { text: `mto docs: no section "${section}".${s ? ` Did you mean "${s}"?` : ""} Run \`mto docs\` for the list.`, code: 2 };
  }
  const url = `${REPO_URL}#${hit[0]}`;
  return { text: `${hit[1]}\n${url}`, url, code: 0 };
}
