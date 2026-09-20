<div align="center">

# ⚡ mcp-token-optimizer

### Stop paying for tool-response noise.

**A self-hosted proxy between your AI agent and its MCP servers that shrinks every tool response — pruning, [TOON](https://github.com/toon-format/toon) encoding and local-LLM summarization — without changing what the agent can do.**

[![CI](https://github.com/shubhamcodess/mcp-token-optimizer/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhamcodess/mcp-token-optimizer/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](https://nodejs.org)
[![Local LLM](https://img.shields.io/badge/local%20LLM-Ollama-000000.svg)](https://ollama.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP-6f42c1.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[**Quick start**](#quick-start) &nbsp;·&nbsp; [**How it works**](#3-how-it-works) &nbsp;·&nbsp; [**Documentation**](#documentation) &nbsp;·&nbsp; [**Testing**](TESTING.md) &nbsp;·&nbsp; [**Contributing**](CONTRIBUTING.md)

</div>

---

```
                       ┌────────────────────── mcp-token-optimizer ──────────────────────┐
 AI agent  ──request──►│  pass-through                                                    │──► real MCP server
 (Copilot,             │                                                                  │    (stdio process
  Claude Code, …)  ◄───│  prune → JSON/TOON → normalize → summarize (local Ollama)        │◄──  or remote HTTP)
                       │        guardrails · audit log · mto_expand (get the original)    │
                       └──────────────────────────────────────────────────────────────────┘
                                        everything runs on YOUR machine
```

## Why

Every token an MCP tool returns is paid for, and fills the model's context window. Real tool output is mostly noise: `null` fields, hypermedia URLs, avatar and node ids, the same block repeated in two fields, ANSI and progress-bar spam, boilerplate prose. `mto` removes that noise **before the model sees it**, keeps an exact copy of anything it removed, and tells the agent how to get it back.

## Results

Measured, reproducible, no LLM involved (`npm run smoke`, [TESTING.md](TESTING.md) §2). Token counts are a model-agnostic estimate.

| Tool response | Original | Sent to the agent | Saved |
|---|---:|---:|---:|
| GitHub issue list (40 issues, REST JSON) | 37,355 | 13,244 | **64.5%** |
| Kubernetes describe + manifest (duplicated content) | 3,637 | 1,935 | **46.8%** |
| CI build log (ANSI, repeated lines) | 4,926 | 78 | **98.4%** |
| HTML runbook page | 1,198 | 863 | **28.0%** |
| *Real* Kubernetes ConfigMap through a live MCP server, Copilot A/B run | 24,616 | 12,617 | **48.7%** |

In that live A/B run, the three files the agent wrote from the optimized result were **byte-identical** to the original data (checked against a pre-optimization capture).

## Highlights

| | |
|---|---|
| 🧾 **Lossless first** | JSON ↔ TOON is emitted only after a verified round-trip; duplicate blocks become pointers; the canonical copy is never touched |
| 🛟 **Fail-open, never bigger** | any error, timeout or Ollama outage forwards the original; an optimized result is used only if it is strictly cheaper |
| 🔎 **`mto_expand`** | notes name exactly what was pruned; the agent can fetch the exact original (outline, JSON path, grep) on demand |
| 🌗 **Shadow mode** | measure real savings while forwarding the originals, so you can roll out with zero risk |
| 🔌 **Any MCP client** | stdio wrapper *and* local HTTP/SSE proxy; installs into VS Code Copilot, Claude, Cursor, Windsurf, Gemini CLI, Cline, Roo (JSONC-safe, reversible) |
| 🧠 **Local summarization** | your Ollama model, your parameters, a hard latency budget and a fact-coverage guard; code and file reads are never summarized |
| 🔐 **Private by design** | binds to `127.0.0.1`, no telemetry, credentials forwarded but never stored, optional secret redaction |
| 🧪 **Measurable** | capture, bench, compare and stats built in; 42 tests and a 24-check end-to-end smoke test |

## Quick start

```bash
git clone https://github.com/shubhamcodess/mcp-token-optimizer.git && cd mcp-token-optimizer
npm install && npm run build           # Node 22+ recommended

node dist/cli.js doctor                # checks config, Ollama and model
node dist/cli.js discover              # lists the MCP servers it found (read-only)
node dist/cli.js init --only <server> --apply    # wrap one server; undo: node dist/cli.js uninstall --apply
```

No agent handy? `npm run demo` shows a tool call through the optimizer with sample data. Full walkthrough: [1. Self-host in 15 minutes](#1-self-host-in-15-minutes).

> **Roll out safely:** set `mode: shadow` first. The proxy then measures savings but forwards the original responses, so nothing changes for your agent until you switch to `active`.

## Documentation

| | |
|---|---|
| 🚀 **Get started** | [1. Self-host in 15 minutes](#1-self-host-in-15-minutes) · [2. Try it without any agent](#2-try-it-without-any-agent-5-minutes) |
| 🧠 **Understand** | [3. How it works](#3-how-it-works) · [4. Operating modes](#4-operating-modes-off--shadow--active) · [5. Integration modes](#5-integration-modes-stdio-wrapper-vs-http-proxy) |
| 🎛️ **Tune** | [6. Profiles](#6-optimization-profiles) · [7. Output formats](#7-output-formats-json-vs-toon) · [8. Summarization](#8-summarization-with-a-local-ollama-model) · [9. `mto_expand`](#9-getting-the-original-back-mto_expand) · [10. Redaction](#10-secret-detection-and-redaction) · [11. Capture, bench, compare](#11-capture-bench-compare-tuning-on-your-real-data) |
| 📖 **Reference** | [12. Configuration reference](#12-configuration-reference) · [13. CLI reference](#13-cli-reference) · [14. Files & env vars](#14-files-and-environment-variables) |
| 🛟 **Operate** | [15. Troubleshooting](#15-troubleshooting) · [16. Security & privacy](#16-security-and-privacy) · [17. Limitations & verification status](#17-known-limitations-and-verification-status) |
| 🤝 **Project** | [18. Development](#18-development) · [TESTING.md](TESTING.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [SECURITY.md](SECURITY.md) · [License](#license) |

---

## 1. Self-host in 15 minutes

> Install it, run the proxy, wire your agent, and undo it. Everything stays on your machine.

Everything runs locally. Nothing is sent to any cloud service: the only network calls are to your own MCP servers and to Ollama on `127.0.0.1`.

### 1.1 Requirements

| Need | Version | Why |
|---|---|---|
| Node.js | **22.15+** recommended (20+ works) | 22.15+ lets `mto serve` trust your OS certificate store, which matters behind corporate CAs |
| Ollama | any recent | only for summarization. Pruning + TOON need no LLM |
| An MCP-capable agent | – | VS Code Copilot agent mode was used to develop this |

```bash
node --version          # v22.15.0 or newer
ollama --version        # optional but recommended
```

### 1.2 Install

Pick one. All give you the same `mto` CLI.

**A. Clone and build** (contributors, or if you always want the latest)

```bash
git clone https://github.com/shubhamcodess/mcp-token-optimizer.git
cd mcp-token-optimizer
npm install
npm run build
node dist/cli.js --version                     # prints 0.1.0
```

**B. Install a prebuilt release tarball** (no clone, no build step)

Download `mcp-token-optimizer-<version>.tgz` from the repository's **Releases** page (each tagged release attaches one, built by CI), then:

```bash
npm install -g ./mcp-token-optimizer-0.1.0.tgz
mto --version
```

You can also build the same artifact yourself: `npm pack` in a clone produces `mcp-token-optimizer-<version>.tgz`.

**C. Straight from GitHub** (npm clones and builds it for you)

```bash
npm install -g github:shubhamcodess/mcp-token-optimizer
mto --version
```

With **B** and **C** the `mto` command is on your PATH. With **A**, either run `node dist/cli.js …` or link it:

```bash
npm link                # then: mto --version   (undo with: npm unlink -g mcp-token-optimizer)
```

The rest of this document writes `node dist/cli.js …`. Use `mto …` if it is on your PATH.

### 1.3 Pull a local model (only for summarization)

```bash
ollama pull qwen3:4b        # default; ~2.6 GB. See section 8 for how to choose
ollama list
```

### 1.4 Create your config

```bash
node dist/cli.js config init     # writes ~/.mcp-token-optimizer/config.yaml with all defaults
node dist/cli.js doctor          # verifies config + Ollama + model
```

Expected `doctor` output:

```
✓ config: /Users/you/.mcp-token-optimizer/config.yaml
  mode=active profile=balanced redaction=detect retrieval=true
✓ ollama http://127.0.0.1:11434 model qwen3:4b ready
```

`doctor` prints `✗ ollama unreachable …` if Ollama is down (pruning and TOON still work) and `✗ … model "x" is not pulled` if the model is missing.

> **Start safe.** For the first day set `mode: shadow` in that file. The proxy then *measures* savings but forwards the original responses, so your agent behaves exactly as before. Switch to `active` once the numbers look right (see [section 4](#4-operating-modes-off--shadow--active)).

### 1.5 Run the HTTP proxy (only needed for remote/URL MCP servers)

Servers configured with `"url"` (type `http`) are reached through a small local proxy. Stdio servers do **not** need it (they are wrapped directly, see 1.6).

Foreground (good for a first try):

```bash
node dist/cli.js serve            # http://127.0.0.1:8787
```

Keep it running in the background:

**macOS (launchd)**

```bash
sed -e "s#__NODE__#$(which node)#" -e "s#__MTO_DIR__#$(pwd)#" deploy/com.mto.serve.plist > ~/Library/LaunchAgents/com.mto.serve.plist
launchctl load ~/Library/LaunchAgents/com.mto.serve.plist
curl -s localhost:8787/health     # → ok
# stop:  launchctl unload ~/Library/LaunchAgents/com.mto.serve.plist      logs: /tmp/mto-serve.log
```

**Linux (systemd user unit)**: template provided, not tested by the author

```bash
mkdir -p ~/.config/systemd/user
sed -e "s#__NODE__#$(which node)#" -e "s#__MTO_DIR__#$(pwd)#" deploy/mto-serve.service > ~/.config/systemd/user/mto-serve.service
systemctl --user daemon-reload && systemctl --user enable --now mto-serve
```

Restart `mto serve` whenever you change `config.yaml`. The proxy reads config at start. (Stdio wrappers pick up the config each time the agent restarts that server.)

### 1.6 Wire your agent

**Step 1: see what would be changed (read-only).**

```bash
node dist/cli.js discover
```

```
GitHub Copilot / VS Code (user: Code)
  ~/Library/Application Support/Code/User/mcp.json  [servers]
    · plain    stdio shadcn
    · plain    http  github
    …
```

`discover` looks in the known locations for Claude Code, Claude Desktop, VS Code/Copilot, Cursor, Windsurf, Gemini CLI, Cline and Roo. To include files elsewhere:

```bash
node dist/cli.js discover --file ~/work/mcp.json                 # key path auto-detected
node dist/cli.js discover --file ~/x/settings.json#mcp.servers   # explicit key path
node dist/cli.js discover --scan ~/Development                   # find mcp.json-style files (depth ≤ 4)
node dist/cli.js discover --no-builtin --file ~/work/mcp.json    # ONLY that file (ignore the built-in agent locations)
MTO_MCP_FILES="$HOME/a.json:$HOME/b.json" node dist/cli.js discover
```

or permanently in `config.yaml` (`discovery.files`, `discovery.scanDirs`, `discovery.skip`, `discovery.builtin`).

**Step 2: dry-run the change, then apply, starting with one or two servers.**

> `init --apply` edits **every** MCP config it discovers unless you narrow it with `--only <server,…>`. To operate on exactly one file (recommended when experimenting) add `--no-builtin --file <path>`. `MTO_HOME` isolates only mto's own data, **not** your agent configs.

```bash
node dist/cli.js init --only shadcn,github          # dry run: prints what would change
node dist/cli.js init --only shadcn,github --apply  # writes; backup saved as <file>.mto.bak
```

What `--apply` does to a server entry:

| Entry type | Before | After |
|---|---|---|
| stdio | `"command":"npx","args":["-y","x"]` | `"command":"<node>","args":["<repo>/dist/cli.js","wrap","--name","x","--","npx","-y","x"]` (env, cwd, type kept) |
| http | `"url":"https://up.example/mcp","headers":{…}` | `"url":"http://127.0.0.1:8787/x"` (**headers stay in your config** and are forwarded upstream); real URL saved in `~/.mcp-token-optimizer/routes.json` |

Comments and formatting in JSONC files (VS Code's `mcp.json`) are preserved. Files that cannot be parsed are reported as `unparsable` and never modified. Legacy `"type":"sse"` servers are skipped.

**Step 3: restart the servers in your agent** (VS Code: the *Restart* lens above the server in `mcp.json`; Claude Code: restart the session).

**Step 4: verify.** In your agent, run a task that calls one of those tools, then:

```bash
node dist/cli.js stats
```

```
server.tool                         calls  tokens_in tokens_out   saved  lossy      avg
k8s.kube_list_resources           2       9978       4464   55.3%      0     10ms
…
```

**Undo everything, any time:**

```bash
node dist/cli.js uninstall --apply
```

### 1.7 Data locations and cleanup

Everything lives in `~/.mcp-token-optimizer/` (override with `MTO_HOME`): `config.yaml`, `routes.json`, `stats.jsonl` (sizes only, never content), `store/` (originals kept for `mto_expand`, auto-expired), `captures/` (only if you turn capture on). Delete the folder to remove all state.

---

## 2. Try it without any agent (5 minutes)

> A fake MCP server and synthetic sample data let you see every behaviour before touching your setup.

The repo ships synthetic sample data and a fake MCP server, so you can see every behaviour before touching your real setup. None of it is real data.

```bash
npm run examples     # (re)generates examples/*.json|md|log|html|ts
npm run demo         # calls a tool through the optimizer with a tiny MCP client
```

```
tools: list_issues, describe_configmap, fetch_guide, build_log, read_file, get_rows, …, mto_expand
instructions: Some tool results are compacted by mcp-token-optimizer: TOON is lossless JSON …
```

Compare direct vs. through the optimizer:

```bash
# direct
node scripts/mcp-call.mjs --tool list_issues --quiet -- node examples/fake-mcp-server.mjs
# through the optimizer (stdio wrapper)
node scripts/mcp-call.mjs --tool list_issues --quiet -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs
```

```
── agent received: 90124 chars, ~37355 tokens      ← direct
── agent received: 35386 chars, ~13244 tokens      ← through mto (−64.5%)
```

Or optimize a saved response file:

```bash
node dist/cli.js try examples/github-issues.json
# tokens 37355 → 13244 (64.5% saved) · stages: prune, toon · lossy: false
```

Run everything at once (24 self-checking assertions):

```bash
npm run smoke        # prints PASS/FAIL per check; exits non-zero on any failure
```

---

## 3. How it works

> The optimization pipeline, what is lossless, and the guardrails that protect the agent.

The optimizer is a man-in-the-middle for the MCP JSON-RPC protocol. It only ever *rewrites tool results* (`tools/call` responses) and, optionally, the tool list; everything else is forwarded untouched. Any internal error, timeout, or Ollama outage **fails open**: the original response is forwarded.

Pipeline for a JSON tool result:

1. **Skip** if smaller than `skipBelowTokens` (default 40 tokens).
2. **Detect secrets** (`redaction.mode`).
3. **Prune** noise: `null`s, empty values, hypermedia/URI-template URLs, avatar/node-id style bookkeeping keys (profile-dependent, section 6).
4. **Cross-field dedupe:** if a long string repeats lines that already appear in another, deeper field, the repeat becomes a pointer such as `[… 831 lines identical to $.manifest.data["app.yaml"] omitted …]`. The canonical copy is never touched.
5. **Encode:** pick the cheaper of minified JSON and **TOON** (a compact tabular text format; official `@toon-format/toon` library). TOON is used only if decoding it reproduces the input exactly. Large results can be forced to pretty JSON instead (section 7).
6. **Note:** if named fields were dropped (or text was summarized), append a short note naming *what* was dropped and an id for `mto_expand`.
7. **Never-bigger guard:** the optimized version is used only if it is strictly cheaper than the original.

Pipeline for a text result: strip ANSI, collapse repeated lines (`(×300)`), dedupe repeated paragraphs, HTML→text, base64 blobs removed, then (if long, and not code) **summarize with your local Ollama model** under a latency budget and fact-coverage guard.

Never modified: tool results with `structuredContent` or a declared `outputSchema` (only minified), error results (`isError`), images/resources, and code or diffs (never summarized).

**What is lossless and what is not**

| Stage | Information lost? |
|---|---|
| minify, TOON, json-pretty, whitespace/ANSI cleanup | none (TOON round-trip is verified per response) |
| drop `null`/empty | none of substance |
| cross-field dedupe | none: the canonical copy stays, the repeat is a pointer |
| drop named noise keys (`node_id`, `avatar_url`, …) | yes, but **named in the note** and retrievable via `mto_expand` |
| summarization, array truncation, blob stripping | yes → original stored, retrievable via `mto_expand` |

---

## 4. Operating modes: `off` · `shadow` · `active`

> Decide what the agent actually receives: the original, the original plus measurements, or the optimized result.

`mode` decides what the agent actually receives. It can be set globally and overridden per tool (`tools:`).

| Mode | Agent receives | Audit/stats | Use it to |
|---|---|---|---|
| `off` | original, untouched | none | disable the optimizer without uninstalling |
| `shadow` | **original**, untouched | records what *would* have been saved | roll out with zero risk; collect a baseline |
| `active` | optimized | records real savings | production |

### 4.1 Global mode

```yaml
# ~/.mcp-token-optimizer/config.yaml
mode: shadow
```

Restart `mto serve` and the agent's MCP servers, then:

```bash
# Try it with the demo server (each mode gives a different token count):
node scripts/mcp-call.mjs --tool list_issues --quiet -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs
```

| `mode:` | Output of the command above |
|---|---|
| `active` | `agent received: … ~13244 tokens` |
| `shadow` | `agent received: … ~37355 tokens` (original; but `mto stats` shows `Projected: … tokens`) |
| `off` | `agent received: … ~37355 tokens` (and nothing is recorded) |

### 4.2 Per-tool overrides

First match wins; globs match `server.tool` where *server* is the `--name` given to `mto wrap` (or the route name for HTTP).

```yaml
mode: shadow                 # default for everything
tools:
  "demo.list_issues":
    mode: active             # this tool is optimized
  "filesystem.*":
    mode: off                # this server is never touched
```

Verified with the demo server: `list_issues` → ~13.2k tokens (active), `describe_configmap` → ~3.6k (original, shadow).

### 4.3 Recommended rollout

1. `mode: shadow` + `node dist/cli.js capture on` for a day of normal work.
2. `node dist/cli.js stats` and `node dist/cli.js bench` to see projected savings (section 11).
3. Flip a few tools to `active` with per-tool overrides, then everything.
4. Watch `mto stats` for `mto_expand` calls: if the agent needs originals often, tune the profile (section 6).

---

## 5. Integration modes: stdio wrapper vs HTTP proxy

> How `mto` gets between the agent and each kind of MCP server, plus per-agent notes.

| | stdio wrapper | HTTP proxy |
|---|---|---|
| For MCP servers that are… | local processes (`command`/`args`) | remote URLs (`"type":"http"`) |
| How | agent launches `mto wrap -- <real command>` | agent talks to `http://127.0.0.1:8787/<name>`; `mto serve` forwards to the real URL |
| Extra process to keep running | no (started by the agent) | yes: `mto serve` (section 1.5) |
| Auth | environment passes through | client `headers` forwarded verbatim upstream, never logged |
| Transports handled | newline-delimited JSON on stdio | Streamable HTTP: JSON and SSE responses, `Mcp-Session-Id`, GET/DELETE |
| Not supported | JSON-RPC batch (passed through unmodified) | legacy `"type":"sse"` servers |

### 5.1 stdio: manual wrapping (any agent, any config)

```json
"shadcn": {
  "command": "node",
  "args": ["/abs/path/to/mcp-token-optimizer/dist/cli.js", "wrap", "--name", "shadcn", "--", "npx", "shadcn@latest", "mcp"]
}
```

Optional: `--config /abs/path/to/other-config.yaml` before the `--` to use a different config for this one server.

### 5.2 HTTP: manual routing

1. Add a route: `~/.mcp-token-optimizer/routes.json`

   ```json
   { "github": { "url": "https://api.githubcopilot.com/mcp/" } }
   ```

2. Run `node dist/cli.js serve`.
3. In the agent config, point the server at `http://127.0.0.1:8787/github` and **keep its `headers`**.

Test without an agent (the demo server requires header `X-API-Key: demo-key`):

```bash
node examples/fake-mcp-server.mjs --http 9100 &
mkdir -p /tmp/mto-demo && echo '{"demo":{"url":"http://127.0.0.1:9100/mcp"}}' > /tmp/mto-demo/routes.json
MTO_HOME=/tmp/mto-demo node dist/cli.js serve --port 8790 &
node scripts/mcp-call.mjs --tool list_issues --quiet --url http://127.0.0.1:8790/demo --header X-API-Key=demo-key
# → agent received: … ~13244 tokens
kill %1 %2
```

Safety properties (all covered by tests): loopback-only bind; requests with a non-loopback `Host` header get **403** (DNS-rebinding guard); unknown route **404**; upstream failure **502** with the real cause (`ECONNREFUSED`, `SELF_SIGNED_CERT_IN_CHAIN`, …); only routes in `routes.json` are reachable.

### 5.3 Agent notes

| Agent | Config file(s) found by `discover` | Notes |
|---|---|---|
| GitHub Copilot / VS Code | `~/Library/Application Support/Code/User/mcp.json`, `.vscode/mcp.json`, `settings.json` (`mcp.servers`) | JSONC (comments) supported. **VS Code saves big tool results to a file and the agent then reads or `json.load`s that file: see the `prettyJsonAboveTokens` advice in section 7.** *Tested.* |
| Claude Code | `~/.claude.json` (user + per-project), `.mcp.json` | *Config handling unit-tested; not run against a live Claude Code session by the author.* |
| Claude Desktop | `claude_desktop_config.json` | same caveat |
| Cursor, Windsurf, Gemini CLI, Cline, Roo | see `mto discover` | same caveat |
| anything else | `--file path[#keyPath]` or manual wrapping | |

**Corporate networks:** if a remote MCP server uses a private certificate authority that your OS trusts but Node doesn't, `mto serve` automatically restarts itself with `--use-system-ca` (Node ≥ 22.15). Disable with `MTO_NO_SYSTEM_CA=1`, or use `NODE_EXTRA_CA_CERTS=/path/ca.pem`.

---

## 6. Optimization profiles

> `conservative`, `balanced` or `aggressive`: how much JSON noise is pruned, with measured results.

`profile` controls how aggressively JSON noise is pruned. Measured on `examples/github-issues.json` (37,355 tokens, deterministic, no LLM):

| Profile | Result | Saved | What it does |
|---|---|---|---|
| `conservative` | 28,144 | 24.7% | drops `null`/empty values and `_links`/`_embedded` only. No URL-template dropping, no blob stripping, no dedupe |
| `balanced` *(default)* | 13,244 | 64.5% | + bookkeeping keys (`node_id`, `gravatar_id`, `etag`, `*_avatar_url`, `followers_url`, `subscriptions_url`, `events_url`, `site_admin`, …), URI-template URLs (`…{/number}`), base64 blobs > 4 KB, cross-field dedupe |
| `aggressive` | 9,584 | 74.3% | + every `*_url`/`*Url` key except `url`, `html_url`, `clone_url`, `ssh_url`, `web_url`, `permalink`, `href`, `uri` (always kept); `cursor`, `__typename`; arrays longer than 200 items are truncated (lossy → note + `mto_expand`) |

Fine-tune without changing profile:

```yaml
prune:
  dropKeys: ["*_etag", "debug_*"]     # extra globs to drop
  keepKeys: ["avatar_url"]            # never drop these, even if the profile would
  maxArrayItems: 100                  # 0 = unlimited
```

Run it yourself:

```bash
printf 'profile: conservative\nsummarize:\n  enabled: false\n' > /tmp/c.yaml
node dist/cli.js try examples/github-issues.json --config /tmp/c.yaml
# tokens 37355 → 28144 (24.7% saved) · stages: prune, toon
```

---

## 7. Output formats: JSON vs TOON

> Minified JSON, pretty JSON or TOON, and why large results should stay JSON for clients that save them to files.

| `format.default` | Emits | Use when |
|---|---|---|
| `auto` *(default)* | cheaper of minified JSON and TOON; TOON only if it round-trips exactly | the agent reads results inline |
| `json` | minified JSON | machine-parsed output on one line is fine |
| `json-pretty` | 2-space indented JSON (valid, `json.load`-able, multi-line) | large results the client saves to a file that the agent parses or reads by line range |
| `toon` | always TOON when encodable | you want maximum compaction |

Results that carry `structuredContent` or a tool `outputSchema` are always kept as (minified) JSON and never pruned, whatever the format.

**The Copilot lesson (measured).** VS Code offloads big tool results to a file. In a clean A/B run, Copilot got TOON, tried `yaml.safe_load` (failed), and needed about 7 extra terminal steps to write a regex extractor, where the un-optimized run needed one `json.load`. On the 24.6k-token result, pretty JSON saved 48.1% vs TOON's 48.7%, so switch big results to pretty JSON:

```yaml
format:
  prettyJsonAboveTokens: 8000     # results larger than this → pretty JSON; smaller ones may still use TOON
  jsonTools: ["postgres.*"]       # globs "server.tool" that must always stay minified JSON
tools:
  "k8s.kube_get_*":
    format: json-pretty           # per-tool override
```

Reproduce the format comparison:

```bash
for f in json json-pretty; do printf "audit:\n  enabled: false\nsummarize:\n  enabled: false\nformat:\n  default: $f\n" > /tmp/$f.yaml; node dist/cli.js try examples/github-issues.json --config /tmp/$f.yaml 2>&1 >/dev/null | grep -o 'tokens.*'; done
# json:        37355 → 16117 (56.9% saved) · stages: prune, minify
# json-pretty: 37355 → 16734 (55.2% saved) · stages: prune, json-pretty
# (auto/TOON:  37355 → 13244 (64.5% saved))
```

(Note: pretty JSON is only used if it is still smaller than the original; feeding it already-minified JSON keeps the original.)

`format.announceToon: true` adds a sentence to the MCP `initialize` instructions telling the agent what TOON tables (`key[N]{a,b}:`) and `[mto: …]` notes mean.

---

## 8. Summarization with a local Ollama model

> Long prose only: which models work, how the latency budget behaves, and honest expectations.

Only **long prose** is ever sent to the LLM (`summarize.minTokens`, default 1200 tokens after cleanup). Never summarized: code and diffs (detected by content), results from tools matching `summarize.neverTools` (file reads, edits, writes, diffs, patches), error results. Fenced code blocks inside prose are protected. Headings never go through the model.

### 8.1 Choose a model and parameters

```yaml
llm:
  baseUrl: http://127.0.0.1:11434
  model: qwen3:4b
  options: { temperature: 0.1, top_p: 0.9, num_ctx: 8192, num_predict: 1024 }   # passed verbatim to Ollama
  keepAlive: 10m
  think: false
```

Measured on the author's Apple-silicon Mac with a synthetic 5k-token doc and a 20 s budget (one document; treat as a starting point and **benchmark on your own data**, see TESTING.md §6):

| Model | Generation speed | Result |
|---|---|---|
| `qwen3:4b` *(default)* | ~35 tok/s | ~49% saved, all key facts kept |
| `granite4:3b` | ~40 tok/s | ~49% saved, all key facts kept; good faster alternative |
| `llama3.2:3b` | ~44 tok/s | ~50% saved; one run lost 10% of key facts |
| `qwen3.5:0.8b` | ~68 tok/s | fastest but truncated output and lost ~19% of facts. Avoid |
| `gemma4:e4b` | ~30 tok/s | slowest, timeouts. Avoid |

### 8.2 Latency, budgets, and honest expectations

Summarization cost is *output token generation*, so it depends on your hardware. The optimizer protects the agent's latency:

* `summarize.maxLatencyMs` (20 s): hard budget per tool result. Text is split into chunks, biggest first. **A chunk is never started if it is predicted not to finish inside the budget; unfinished chunks stay verbatim.**
* `llm.timeoutMs` (30 s): per-request ceiling. A circuit breaker stops calling Ollama for 60 s after 3 failures.
* Truncated generations are discarded; a summary that loses key facts (paths, ids, versions, URLs, numbers, error codes) is repaired or rejected (`summarize.minCoverage`, default 0.97).
* The model is pre-loaded when the proxy/wrapper starts (`keepAlive`).

Reality check: on `examples/deploy-guide.md` the free deterministic stages give 34.8% and adding `qwen3:4b` (40 s budget) gave 39.2% at ~33 s. **Pruning + TOON do the heavy lifting; the LLM adds a modest extra for long prose.** If latency matters more than the last few percent, set `summarize.enabled: false`.

```bash
# Live demo (needs Ollama + model). minTokens lowered so the 2.3k-token sample qualifies:
printf 'audit:\n  enabled: false\nsummarize:\n  minTokens: 400\n  maxLatencyMs: 40000\n' > /tmp/llm.yaml
node dist/cli.js try examples/deploy-guide.md --config /tmp/llm.yaml >/dev/null
# tokens 2283 → 1388 (39.2% saved) · stages: normalize, summarize(qwen3:4b) · lossy: true · ~33s
MTO_DEBUG=1 node dist/cli.js try examples/deploy-guide.md --config /tmp/llm.yaml >/dev/null   # per-chunk accept/reject reasons
```

### 8.3 Disable, or fail-open

```yaml
summarize: { enabled: false }          # never call the LLM (zero added latency)
tools:
  "docs.fetch_*": { summarize: false } # per tool
```

If Ollama is down, requests still succeed with the deterministic result (verified: `stages: normalize`, 2283 → 1489 tokens).

---

## 9. Getting the original back: `mto_expand`

> Notes tell the agent what was removed; one tool call fetches the exact original.

When the optimizer removes something that the agent might want, it stores the **exact original** (`~/.mcp-token-optimizer/store/`, expires after `retrieval.ttlMinutes`, default 240) and ends the result with a note that says *what* was removed:

```
[mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, gravatar_id×40, followers_url×40. Only if you need them: mto_expand {"id":"7b105335b224","path":...}]
```

For plain-JSON objects the note is a top-level `_mto` key instead, so the output stays valid JSON; a JSON array at the root gets no note (no place for one without changing its shape).

**When notes appear:** only when named data was removed (pruned noise keys, truncated arrays, stripped blobs) or text was summarized. *Not* for empty/null removal, TOON encoding, or duplicate-line pointers (nothing was lost, and a note would only invite pointless fetches; measured: with a note on lossless changes Copilot burned more tokens expanding than were saved).

The proxy adds a tool `mto_expand` to `tools/list`:

| Argument | Meaning |
|---|---|
| `id` | required, from the note |
| *(nothing else)* | returns an **outline** (structure + token sizes), not the whole original |
| `path` | JSON path into the original, e.g. `$[3].user.avatar_url`, `$.manifest.data["app.yaml"]` |
| `grep` | regex; returns matching lines with 2 lines of context |
| `offset`, `limit` | page through the text by characters |
| `full` | return everything (can be very large) |

Try it (demo server):

```bash
OUT=$(node scripts/mcp-call.mjs --tool list_issues -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs)
ID=$(echo "$OUT" | grep -o 'mto_expand {"id":"[0-9a-f]*"' | grep -o '[0-9a-f]\{12\}')
node scripts/mcp-call.mjs --tool mto_expand --args "{\"id\":\"$ID\"}" -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs | head -5
node scripts/mcp-call.mjs --tool mto_expand --args "{\"id\":\"$ID\",\"path\":\"\$[3].user.avatar_url\"}" -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs | head -1
# → https://avatars.githubusercontent.com/u/103?v=4
```

Every `mto_expand` call is audited: `mto stats` ends with e.g. `mto_expand: agent asked for originals 4x (1 misses) across 1 optimized calls.` If the agent expands a lot, your profile is too aggressive for that tool. To turn the feature off: `retrieval.enabled: false`.

---

## 10. Secret detection and redaction

> Find (or strip) API keys, tokens and private keys in tool output before the model sees them.

Built-in patterns: AWS access keys, GitHub tokens (classic and fine-grained), Slack tokens, Anthropic/OpenAI/Google API keys, JWTs, PEM private keys, `Bearer` tokens. Add your own with `redaction.extraPatterns`.

| `redaction.mode` | Behaviour |
|---|---|
| `off` | no scanning |
| `detect` *(default)* | text untouched; findings counted in the audit log; `mto stats` prints `Secrets seen in tool output: aws-access-key×1, …` |
| `redact` | secrets replaced with `[REDACTED:type]` **before** the agent (and its provider) sees them |

```yaml
redaction:
  mode: redact
  extraPatterns:
    - { name: internal-token, regex: "itk_[A-Za-z0-9]{24,}" }
```

```bash
printf 'redaction:\n  mode: redact\nsummarize:\n  enabled: false\n' > /tmp/r.yaml
node dist/cli.js try examples/secrets.txt --config /tmp/r.yaml 2>/dev/null | head -4
# aws_access_key_id = [REDACTED:aws-access-key]
# github_token = [REDACTED:github-token]  …
```

In `redact` mode redaction is never undone, even by the never-bigger fallback. (Pattern-based: it will not catch every possible secret.)

---

## 11. Capture, bench, compare: tuning on your real data

> Record real tool output locally, replay it, and compare what the agent received with the original.

```bash
node dist/cli.js capture on        # live toggle (a flag file), no restarts. Records raw, secret-redacted results locally
# … use your agent normally …
node dist/cli.js capture status    # sample count
node dist/cli.js bench --dump ~/mto-report          # replay: savings, latency; before/after examples to ~/mto-report.md
node dist/cli.js bench --models qwen3:4b,granite4:3b   # compare LLMs on YOUR data (speed, savings, fact retention)
node dist/cli.js compare           # original vs what the agent received (needs active mode)
node dist/cli.js capture off
```

`compare` classifies each call:

| Verdict | Meaning |
|---|---|
| `UNCHANGED` | nothing to do |
| `EQUIVALENT` | same information (only nulls/empties removed, or duplicates pointed) |
| `PRUNED-DATA` | named fields dropped; **listed** (`40× $[].node_id`) |
| `SUMMARIZED` | text condensed; critical-fact retention shown |
| `VALUE-CHANGED` | a value differs. This would be a bug |

Captures contain real tool output from your systems (only common secret patterns are redacted). Treat `~/.mcp-token-optimizer/captures/` as sensitive; `capture off` and deleting the folder removes it. Full benchmarking procedure: **[TESTING.md](TESTING.md)**.

---

## 12. Configuration reference

> Every property: its default, what it does, and an example.

File: `--config FILE` → `$MTO_CONFIG` → `./mto.config.yaml` → `~/.mcp-token-optimizer/config.yaml`. Every key is optional; unknown **top-level** keys (and unknown keys inside `tools` rules) are rejected with a clear error (`mto doctor` shows it), so typos there don't fail silently. `~` and `$VARS` in `audit.path`/discovery paths are expanded. A complete commented sample is in [`mto.config.example.yaml`](mto.config.example.yaml).

### Top level

| Key | Default | Meaning |
|---|---|---|
| `mode` | `active` | `active` \| `shadow` \| `off`. See [section 4](#4-operating-modes-off--shadow--active) |
| `profile` | `balanced` | `conservative` \| `balanced` \| `aggressive`. See [section 6](#6-optimization-profiles) |
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
| `default` | `auto` | `auto` \| `json` \| `json-pretty` \| `toon`. See [section 7](#7-output-formats-json-vs-toon) |
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
| `mode` | `detect` | `off` \| `detect` \| `redact`. See [section 10](#10-secret-detection-and-redaction) |
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

### `cache`, `audit`

| Key | Default | Meaning |
|---|---|---|
| `cache.enabled` / `cache.maxEntries` | `true` / `200` | in-memory result cache keyed by content hash |
| `audit.enabled` | `true` | append a size-only row per tool call to the audit log (never content) |
| `audit.path` | `~/.mcp-token-optimizer/stats.jsonl` | log location |
| `audit.pricePerMTokUsd` | `3` | $ per million input tokens, used by `mto stats` for the estimate |

### `tools`: per-tool overrides

First matching glob wins. Globs match `server.tool` (case-insensitive, `*` and `?`).

| Key | Meaning |
|---|---|
| `mode` | `active` \| `shadow` \| `off` for this tool |
| `format` | `auto` \| `json` \| `json-pretty` \| `toon` |
| `summarize` | `false` to never summarize this tool |
| `dropKeys` / `keepKeys` | extra prune globs for this tool |
| `maxArrayItems` | array truncation for this tool |

```yaml
tools:
  "github.list_*":        { maxArrayItems: 100 }
  "postgres.query":       { format: json, summarize: false }
  "filesystem.*":         { mode: off }
  "k8s.kube_get_*": { format: json-pretty }
```

---

## 13. CLI reference

> All commands and flags.

```
mto discover [--scan dir] [--file path[#keyPath]] [--skip agent] [--no-builtin]   List every MCP config + server found (read-only)
mto init      [--apply] [--only a,b] [--file f] [--scan d] [--skip agent] [--no-builtin] [--config f]   Wrap stdio servers, route http servers
mto uninstall [--apply] [same discovery flags]                       Restore original commands/URLs
mto wrap [--name n] [--config f] -- <cmd> [args…]                     Run one stdio MCP server through the optimizer
mto serve [--port 8787] [--config f]                                  Local HTTP proxy for remote servers
mto try <file|-> [--tool t] [--server s] [--config f]                 Optimize a saved response; prints result + one-line summary on stderr
mto capture on|off|status                                              Record raw (secret-redacted) tool results, live
mto bench [dir] [--llm] [--models a,b] [--dump prefix] [--cap N]      Replay captures; savings, latency, fact retention
mto compare [--tool glob] [--last N]                                   Original vs what the agent received
mto stats [--since 7d|24h] [--json]                                    Token savings report (+ $ estimate, expand usage, secrets seen)
mto doctor [--config f]                                                Check config, Ollama, model
mto config init                                                        Write a default config file
```

`init`/`uninstall` are dry runs without `--apply` and write `<file>.mto.bak` once per file.

Helper scripts (for testing and demos): `npm run examples` · `npm run demo` · `npm run smoke` · `scripts/mcp-call.mjs` (tiny MCP client) · `scripts/examples-to-captures.mjs` (examples → a captures dir for `mto bench`) · `scripts/fidelity.mjs` (byte-compare a file against the captured original) · `examples/fake-mcp-server.mjs` (demo server, stdio or `--http PORT`).

---

## 14. Files and environment variables

> Where state lives and which variables change behaviour.

| Path (under `~/.mcp-token-optimizer/` unless noted) | Purpose |
|---|---|
| `config.yaml` | configuration |
| `routes.json` | `name → {url}` map used by the HTTP proxy (written by `init`) |
| `stats.jsonl` | audit log: one size-only row per tool call |
| `store/` | originals for `mto_expand` (mode 0600, auto-expired) |
| `captures/`, `capture.on` | recorded samples and the capture flag |
| `<agent config>.mto.bak` | backups made by `init --apply` |

| Variable | Effect |
|---|---|
| `MTO_HOME` | use another data directory instead of `~/.mcp-token-optimizer` |
| `MTO_CONFIG` | config file path |
| `MTO_MCP_FILES` | extra MCP config files for `discover`/`init` (path-list, `:` separated on macOS/Linux) |
| `MTO_DEBUG=1` | print per-chunk summarization decisions to stderr |
| `MTO_NO_SYSTEM_CA=1` | don't auto-relaunch `mto serve` with `--use-system-ca` |

---

## 15. Troubleshooting

> Symptoms, causes and fixes, from real problems hit while building this.

| Symptom | Cause / fix |
|---|---|
| `init` says *No MCP servers found* | your config is in a non-standard place: `node dist/cli.js discover --file <path>` or `--scan <dir>` |
| `init --apply` changed more files than I expected | without `--only`/`--no-builtin` it processes every discovered config. Restore with `uninstall --apply` (backups: `<file>.mto.bak`) |
| `init` reports `unparsable` for a file | it has a syntax error; fix it (comments and trailing commas are fine). The file is never modified |
| Agent shows `502 … mto proxy error: fetch failed` | read the reason after it. `SELF_SIGNED_CERT_IN_CHAIN`: corporate CA: use Node ≥ 22.15 (auto) or `NODE_EXTRA_CA_CERTS`; `ECONNREFUSED`: upstream down/URL wrong |
| HTTP server unreachable after `init` | `mto serve` is not running (section 1.5) |
| `listen EADDRINUSE 127.0.0.1:8787` | another `mto serve` is running; stop it or use `--port` (and update `routes`/URLs) |
| Config change has no effect | restart `mto serve` (HTTP) or the agent's MCP server (stdio) |
| Agent scripts fail to parse a saved tool result | it was TOON: set `format.prettyJsonAboveTokens: 8000` (section 7) |
| Agent keeps calling `mto_expand` | tool is over-pruned: use `profile: conservative`, or `keepKeys` / per-tool `format: json` |
| Savings look negative in `mto stats` | `mto_expand` returned more than was saved: see the `mto_expand:` line at the end of the report |
| Summarization never happens | `doctor` (Ollama down / model missing), text under `summarize.minTokens`, tool matches `neverTools`, or the budget is too small: run with `MTO_DEBUG=1` |
| Summaries too slow | smaller model, lower `maxLatencyMs`, or `summarize.enabled: false` |
| Need to see exactly what the agent got | `mto capture on` then `mto compare` |
| Everything wrong, want to bail out | `mode: off` (config) or `node dist/cli.js uninstall --apply` |

---

## 16. Security and privacy

> What is stored, what is forwarded, and what is never done.

* **Local only.** The proxy binds to `127.0.0.1`; only `Host: 127.0.0.1|localhost|[::1]` is accepted; only routes in `routes.json` are forwarded (no open proxy).
* **Credentials pass through, never stored.** HTTP headers (API keys, `Authorization`) are forwarded to the configured upstream and are not logged, audited, or written to disk. **Do not paste keys into screenshots or chat; the demo config uses fake values.**
* **The audit log holds sizes only.** `stats.jsonl` never contains tool content.
* **Stored originals** (`store/`) and **captures** hold real tool output, with `0600` files in a `0700` directory; captures are secret-redacted (pattern-based). Retention: `retrieval.ttlMinutes`; captures until you delete them.
* **TLS is never disabled.** A private CA is trusted via the OS store (`--use-system-ca`) or `NODE_EXTRA_CA_CERTS`.
* `init --apply` edits agent config files in place after writing a `.mto.bak`; `uninstall --apply` reverses it.
* The summarization prompt treats tool output as data. A tool result that contains instructions is summarized, not obeyed. (Summarizers can still be nudged by adversarial text; keep `summarize.neverTools` for sensitive tools.)

---

## 17. Known limitations and verification status

> What was verified live, what was only unit-tested, and what is not covered.

**Verified** (automated tests + live runs on macOS, Node 22.16, Ollama, VS Code Copilot agent mode against a real remote HTTP MCP server): stdio wrapper, HTTP proxy (JSON + SSE, corporate CA), JSONC config editing, TOON round-trip (1,500-document fuzz), all modes/profiles/formats in this README, `mto_expand`, fail-open with Ollama down, live summarization with five local models, and a clean A/B run whose output files were **byte-identical** to the ground-truth data.

**Not verified by the author:** Claude Code, Claude Desktop, Cursor, Windsurf, Cline, Roo, Gemini CLI against live sessions (config handling is unit-tested); Linux and Windows; the systemd unit; JSON-RPC batch handling beyond pass-through.

**Limitations**

* Token counts are a model-agnostic **estimate**, good for relative savings, not billing-exact.
* Long strings *inside* JSON fields (e.g. an issue `body`) are not summarized.
* Legacy `"type":"sse"` MCP servers are not proxied.
* `mto serve` must be running for proxied HTTP servers (no auto-start beyond the launchd/systemd templates).
* Summarization latency is bounded but real (seconds); benefit is modest on prose that is already dense.
* If an agent post-processes saved tool results with scripts, use `json-pretty` for large results (section 7).
* The output-format savings and model comparisons were measured on one machine and a few datasets; benchmark yours (TESTING.md).

---

## 18. Development

> Layout of the code base and how to run the checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```
src/
  cli.ts          command line             installer.ts  discovery + config-file editing (jsonc-parser)
  config.ts       schema + loader           stdio.ts      stdio wrapper
  pipeline.ts     the optimization pipeline  http.ts       HTTP/SSE proxy
  prune.ts        prune + cross-field dedupe session.ts    JSON-RPC interceptor, mto_expand, notes
  toon.ts         official TOON wrapper      summarize.ts  chunked LLM summarization + guards
  text.ts         cleanup, HTML, code sniff  llm.ts        Ollama client, circuit breaker
  redact.ts       secret patterns            store.ts      originals for mto_expand
  audit.ts        stats log/report           capture.ts / bench.ts / compare.ts   tuning loop
examples/  synthetic sample data + fake MCP server      scripts/  mcp-call.mjs, smoke.mjs, make-examples.mjs
deploy/    launchd + systemd templates                  tests/    42 tests (node:test)
```

```bash
npm test             # 42 tests: TOON fuzz, pipeline guardrails, installer/JSONC, HTTP proxy, stdio e2e, expand
npm run typecheck
npm run smoke        # 24 end-to-end assertions with the fake server
```

---

## Contributing

Contributions of all sizes are welcome: bug reports, docs, benchmark results, new agent integrations, pipeline improvements. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** (setup, principles, how to add a pruning rule, pipeline stage or agent target, PR checklist) and please read the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Uses the official [`@toon-format/toon`](https://github.com/toon-format/toon) library for TOON, and [Ollama](https://ollama.com) for optional local summarization.
