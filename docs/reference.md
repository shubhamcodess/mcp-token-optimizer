# Reference

Every configuration key, CLI command, and file or environment variable.

## 12. Configuration reference

> Every property: its default, what it does, and an example.

File: `--config FILE` → `$MTO_CONFIG` → `./mto.config.yaml` → `~/.mcp-token-optimizer/config.yaml`. Every key is optional; unknown **top-level** keys (and unknown keys inside `tools` rules) are rejected with a clear error (`mto doctor` shows it), so typos there don't fail silently. `~` and `$VARS` in `audit.path`/discovery paths are expanded. A complete commented sample is in [`mto.config.example.yaml`](../mto.config.example.yaml).

### Top level

| Key | Default | Meaning |
|---|---|---|
| `mode` | `active` | `active` \| `shadow` \| `off`. See [section 4](how-it-works.md#4-operating-modes-off--shadow--active) |
| `profile` | `balanced` | `conservative` \| `balanced` \| `aggressive`. See [section 6](tuning.md#6-optimization-profiles) |
| `skipBelowTokens` | `40` | results smaller than this are forwarded untouched |
| `tools` | `{}` | per-tool overrides (below) |

### `llm`: the local model

| Key | Default | Meaning |
|---|---|---|
| `provider` | `ollama` | only Ollama is supported |
| `baseUrl` | `http://127.0.0.1:11434` | Ollama endpoint |
| `model` | `qwen3:4b` | any pulled model (`ollama list`) |
| `options` | `{temperature:0.1, top_p:0.9, num_ctx:8192, num_predict:1024}` | passed verbatim as Ollama `options`. Low temperature = faithful summaries. `num_predict` caps output per request (also capped per chunk automatically) |
| `keepAlive` | `10m` | how long Ollama keeps the model in memory |
| `timeoutMs` | `30000` | per-request ceiling (also limited by `summarize.maxLatencyMs`) |
| `think` | `false` | disable "thinking" mode of reasoning models (faster, deterministic) |

### `summarize`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` = never call the LLM |
| `minTokens` | `1200` | only text above this (after cleanup) is considered |
| `maxLatencyMs` | `20000` | hard budget per tool result; unfinished chunks stay verbatim |
| `concurrency` | `1` | parallel chunk requests (helps only if Ollama runs with `OLLAMA_NUM_PARALLEL>1`; on the author's machine it did not help) |
| `targetRatio` | `0.35` | requested output size relative to input |
| `minCoverage` | `0.97` | fraction of critical facts that must survive, otherwise re-attached or the summary is rejected |
| `neverTools` | file reads/edits/writes/diffs/patches globs | `server.tool` globs whose output is never summarized |

### `format`

| Key | Default | Meaning |
|---|---|---|
| `default` | `auto` | `auto` \| `json` \| `json-pretty` \| `toon`. See [section 7](tuning.md#7-output-formats-json-vs-toon) |
| `jsonTools` | `[]` | `server.tool` globs that must stay minified JSON |
| `prettyJsonAboveTokens` | `0` (off) | results larger than this become pretty JSON instead of TOON. **Recommended for VS Code Copilot: `8000`** |
| `announceToon` | `true` | add the TOON/notes explanation to MCP `initialize.instructions` |

### `prune`

| Key | Default | Meaning |
|---|---|---|
| `dropNull` | `true` | remove `null` values |
| `dropEmpty` | `true` | remove `""`, `[]`, `{}` |
| `dropKeys` | `[]` | extra key-name globs dropped everywhere |
| `keepKeys` | `[]` | key-name globs never dropped (`url`, `html_url`, `clone_url`, `ssh_url`, `web_url`, `permalink`, `href`, `uri` are always kept) |
| `maxArrayItems` | `0` (aggressive: `200`) | truncate longer arrays (lossy: note + expand) |
| `stripBlobsOverBytes` | `4096` (conservative: `0`) | replace base64 blobs larger than this |
| `dedupeAcrossFields` | on unless `conservative` | replace repeated line-blocks with pointers to the deeper canonical field |

### `toolDefinitions`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | also slim `tools/list` schemas. Off by default: schemas are contracts |
| `stripKeys` | `[$schema, title, examples, $comment]` | schema annotation keywords removed. Parameter *names* (e.g. a parameter called `title`) are never removed |

### `redaction`

| Key | Default | Meaning |
|---|---|---|
| `mode` | `detect` | `off` \| `detect` \| `redact`. See [section 10](../SECURITY.md#10-secret-detection-and-redaction) |
| `extraPatterns` | `[]` | `[{name, regex}]` JavaScript regexes |

### `retrieval`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | store originals, add notes, expose `mto_expand` |
| `ttlMinutes` | `240` | how long originals are kept |
| `maxEntries` | `500` | max stored originals |

### `discovery`

| Key | Default | Meaning |
|---|---|---|
| `files` | `[]` | extra config files: `"path"` or `"path#keyPath"` |
| `scanDirs` | `[]` | directories scanned for `mcp.json`-style files (depth ≤ 4, skips `node_modules`) |
| `builtin` | `true` | include the built-in agent locations. `false` = only files you name (same as `--no-builtin`) |
| `skip` | `[]` | built-in agents to ignore (substring of the name shown by `discover`; `--skip` may be repeated or comma-separated) |

### `ui`: the daemon

| Key | Default | Meaning |
|---|---|---|
| `autoStart` | `true` | stdio wrappers start `mto serve` if no daemon is running (single instance, never opens a browser) |
| `port` | `8787` | port the auto-started daemon listens on (`mto serve --port` overrides) |

### `clients`: per-client overrides

Keyed by a case-insensitive glob on the client's `clientInfo.name`; first match wins and your entries come before the built-ins. Each entry may set `format`, `profile` and `prettyJsonAboveTokens`; tool rules (`tools:`) still win over it. One profile ships, with the measurement behind it: `visual studio code*` → `prettyJsonAboveTokens: 8000` ([section 7](tuning.md#7-output-formats-json-vs-toon)). An empty entry switches a built-in off:

```yaml
clients:
  "claude-*": { profile: conservative }
  "visual studio code*": {}          # disable the built-in
```

The audit row, the live feed and `mto stats` show which profile applied.

### `drift`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | the daemon watches your agents' MCP configs for new unwrapped servers and wrappers that were removed |
| `intervalSec` | `60` | how often (minimum 5) |
| `autoWrap` | `[]` | agents (case-insensitive name substrings) whose new servers are wrapped automatically. Empty = mto never edits a config on its own |

### `cache`, `audit`

| Key | Default | Meaning |
|---|---|---|
| `cache.enabled` / `cache.maxEntries` | `true` / `200` | in-memory result cache keyed by content hash |
| `audit.enabled` | `true` | append a size-only row per tool call to the audit log (never content) |
| `audit.path` | `~/.mcp-token-optimizer/stats.jsonl` | log location |
| `audit.pricePerMTokUsd` | `3` | $ per million input tokens, used by `mto stats` for the estimate |
| `audit.maxMb` | `20` | past this size, rows older than 7 days are rolled up into `stats-daily.jsonl` and trimmed |
| `audit.keepDays` | `90` | daily rollups older than this are dropped |

### `tools`: per-tool overrides

First matching glob wins. Globs match `server.tool` (case-insensitive, `*` and `?`).

| Key | Meaning |
|---|---|
| `mode` | `active` \| `shadow` \| `off` for this tool |
| `format` | `auto` \| `json` \| `json-pretty` \| `toon` |
| `summarize` | `false` to never summarize this tool |
| `dropKeys` / `keepKeys` | extra prune globs for this tool |
| `maxArrayItems` | array truncation for this tool |
| `profile` | `conservative` \| `balanced` \| `aggressive` for this tool only |

```yaml
tools:
  "github.list_*":        { maxArrayItems: 100 }
  "postgres.query":       { format: json, summarize: false }
  "filesystem.*":         { mode: off }
  "k8s.kube_get_*": { format: json-pretty }
```

## 13. CLI reference

> All commands and flags.

```
mto discover [--scan dir] [--file path[#keyPath]] [--skip agent] [--no-builtin]   List every MCP config + server found (read-only)
mto init      [--apply] [--only a,b] [--file f] [--scan d] [--skip agent] [--no-builtin] [--config f]   Wrap stdio servers, route http servers
mto uninstall [--apply] [same discovery flags]                       Restore original commands/URLs
mto wrap [--name n] [--config f] -- <cmd> [args…]                     Run one stdio MCP server through the optimizer
mto serve [--port 8787] [--config f]                                  Local daemon: HTTP proxy for remote servers + authenticated API
mto status                                                             Daemon up/down, connected proxies, last-24h savings
mto ui [--no-open]                                                     Start the daemon if needed and open the dashboard link
mto models [use <name>|test [name]|pull <name>]                        List, choose, test or download local Ollama models
mto config path|get [key]|set <key> <value>|edit|init                 Show, change (validated, comments kept) or create the config
mto help [command|topic]   mto <command> --help                       Overview, per-command help, topics (modes, profiles, formats, local-only, security)
mto docs [section] [--open]   mto about                                Where the docs are; version, license, data dir, daemon state
mto try <file|-> [--tool t] [--server s] [--config f]                 Optimize a saved response; prints result + one-line summary on stderr
mto capture on|off|status                                              Record raw (secret-redacted) tool results, live
mto bench [dir] [--llm] [--models a,b] [--dump prefix] [--cap N]      Replay captures; savings, latency, fact retention
mto compare [--tool glob] [--last N]                                   Original vs what the agent received
mto stats [--since 7d|24h|30d] [--daily] [--json]                                    Token savings report (+ $ estimate, expand usage, secrets seen)
mto doctor [--config f]                                                Check config, Ollama, model
mto advise [--json]                                                    Recommendations from your own measurements (advisory)
mto drift [wrap <server>|accept]                                       New unwrapped servers / removed wrappers in your agent configs
mto eval [--examples|--dir d] [--fail-under k=n] [--baseline f] [--json]   Replay samples; gate on savings, lossless, facts (CI)
mto eval fidelity --tool t --file f [--path p]                         Byte-compare a file the agent wrote with the captured original
mto service status|install|uninstall [--apply]                         Run the daemon in the background (launchd / systemd --user)
mto config init                                                        Write a default config file
```

`init`/`uninstall` are dry runs without `--apply` and write `<file>.mto.bak` once per file.

Helper scripts (for testing and demos): `npm run examples` · `npm run demo` · `npm run smoke` · `scripts/mcp-call.mjs` (tiny MCP client) · `scripts/examples-to-captures.mjs` (examples → a captures dir for `mto bench`) · `scripts/fidelity.mjs` (byte-compare a file against the captured original) · `examples/fake-mcp-server.mjs` (demo server, stdio or `--http PORT`).

## 14. Files and environment variables

> Where state lives and which variables change behaviour.

| Path (under `~/.mcp-token-optimizer/` unless noted) | Purpose |
|---|---|
| `config.yaml` | configuration |
| `routes.json` | `name → {url}` map used by the HTTP proxy (written by `init`) |
| `stats.jsonl` | audit log: one size-only row per tool call |
| `store/` | originals for `mto_expand` (mode 0600, auto-expired) |
| `captures/`, `capture.on` | recorded samples and the capture flag |
| `stats-daily.jsonl` | per-day rollups of old audit rows (sizes only) |
| `eval-history.jsonl` | saved dashboard eval runs (newest 50) |
| `drift-baseline.json` | the agent servers mto has already seen (for drift warnings) |
| `serve.log` | log of the background service (`mto service`) |
| `daemon.json` | pid, port and per-run token of the running daemon (mode 0600; removed on exit) |
| `<agent config>.mto.bak` | backups made by `init --apply` |

| Variable | Effect |
|---|---|
| `MTO_HOME` | use another data directory instead of `~/.mcp-token-optimizer` |
| `MTO_CONFIG` | config file path |
| `MTO_MCP_FILES` | extra MCP config files for `discover`/`init` (path-list, `:` separated on macOS/Linux) |
| `MTO_NO_DAEMON=1` | wrappers never auto-start the daemon |
| `MTO_DEBUG=1` | print per-chunk summarization decisions to stderr |
| `MTO_NO_SYSTEM_CA=1` | don't auto-relaunch `mto serve` with `--use-system-ca` |
