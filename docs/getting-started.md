# Getting started

Install `mto`, wire it into your agent, and see it work before you touch your setup. For what each part does, read [How it works](how-it-works.md); for tuning, read [Tuning](tuning.md).

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
node dist/cli.js --version                     # prints 0.2.0
```

**B. Install from npm** (no clone, no build step; recommended)

```bash
npm install -g @shubhamcodess/mcp-token-optimizer
mto --version
mto ui
```

The package is scoped because the unscoped name `mcp-token-optimizer` belongs to a different, unrelated project on npm; make sure you install the scoped one. The commands it installs are `mto` and `mcp-token-optimizer`. Releases are published from CI with a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

**C. Install a prebuilt release tarball** (no clone, no build step)

Download the `.tgz` (`shubhamcodess-mcp-token-optimizer-<version>.tgz`; the 0.2.0 file is named `mcp-token-optimizer-0.2.0.tgz`) from the repository's **Releases** page (each tagged release attaches one, built by CI), then:

```bash
npm install -g ./*mcp-token-optimizer-*.tgz
mto --version
```

You can also build the same artifact yourself: `npm pack` in a clone produces `shubhamcodess-mcp-token-optimizer-<version>.tgz`.

> `npm install -g github:shubhamcodess/mcp-token-optimizer` is **not** supported: the package needs a TypeScript build, and npm does not install dev dependencies when building git dependencies. Use A, B or C.

With **B** or **C** the `mto` command is on your PATH. With **A**, either run `node dist/cli.js …` or link it:

```bash
npm link                # then: mto --version   (undo with: npm unlink -g mcp-token-optimizer)
```

The rest of this document writes `node dist/cli.js …`. Use `mto …` if it is on your PATH.

### 1.3 Pull a local model (only for summarization)

```bash
ollama pull qwen3:4b        # default; ~2.6 GB. See [section 8](tuning.md#8-summarization-with-a-local-ollama-model) for how to choose
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

> **Start safe.** For the first day set `mode: shadow` in that file. The proxy then *measures* savings but forwards the original responses, so your agent behaves exactly as before. Switch to `active` once the numbers look right (see [section 4](how-it-works.md#4-operating-modes-off--shadow--active)).

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

**The daemon.** `mto serve` is also the local daemon: it serves a small authenticated API under `/api/*` (status, stats, live event feed, config, models) that the upcoming dashboard uses, and it keeps a registry of the wrappers that are connected. Stdio wrappers start it automatically if it is not running (single instance; it never opens a browser; opt out with `ui.autoStart: false` or `MTO_NO_DAEMON=1`).

```bash
mto status      # daemon up/down, connected proxies, last-24h savings (works offline from the audit log)
mto ui          # start the daemon if needed and open http://127.0.0.1:8787/
```

The API needs a per-run bearer token (kept in `~/.mcp-token-optimizer/daemon.json`, mode 0600), accepts only loopback `Host` and same-origin `Origin` headers, sends no CORS headers and has no endpoint that runs commands. See [section 16](../SECURITY.md#16-security-and-privacy).

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
