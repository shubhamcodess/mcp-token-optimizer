# How it works

The optimization pipeline, the operating modes, how `mto` connects to each kind of MCP server, and how the agent gets originals back.

## 3. How it works

> The optimization pipeline, what is lossless, and the guardrails that protect the agent.

The optimizer is a man-in-the-middle for the MCP JSON-RPC protocol. It only ever *rewrites tool results* (`tools/call` responses) and, optionally, the tool list; everything else is forwarded untouched. Any internal error, timeout, or Ollama outage **fails open**: the original response is forwarded.

Pipeline for a JSON tool result:

1. **Skip** if smaller than `skipBelowTokens` (default 40 tokens).
2. **Detect secrets** (`redaction.mode`).
3. **Prune** noise: `null`s, empty values, hypermedia/URI-template URLs, avatar/node-id style bookkeeping keys (profile-dependent, [section 6](tuning.md#6-optimization-profiles)).
4. **Cross-field dedupe:** if a long string repeats lines that already appear in another, deeper field, the repeat becomes a pointer such as `[… 831 lines identical to $.manifest.data["app.yaml"] omitted …]`. The canonical copy is never touched.
5. **Encode:** pick the cheaper of minified JSON and **TOON** (a compact tabular text format; official `@toon-format/toon` library). TOON is used only if decoding it reproduces the input exactly. Large results can be forced to pretty JSON instead ([section 7](tuning.md#7-output-formats-json-vs-toon)).
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
2. `node dist/cli.js stats` and `node dist/cli.js bench` to see projected savings ([section 11](tuning.md#11-capture-bench-compare-tuning-on-your-real-data)).
3. Flip a few tools to `active` with per-tool overrides, then everything.
4. Watch `mto stats` for `mto_expand` calls: if the agent needs originals often, tune the profile ([section 6](tuning.md#6-optimization-profiles)).

## 5. Integration modes: stdio wrapper vs HTTP proxy

> How `mto` gets between the agent and each kind of MCP server, plus per-agent notes.

| | stdio wrapper | HTTP proxy |
|---|---|---|
| For MCP servers that are… | local processes (`command`/`args`) | remote URLs (`"type":"http"`) |
| How | agent launches `mto wrap -- <real command>` | agent talks to `http://127.0.0.1:8787/<name>`; `mto serve` forwards to the real URL |
| Extra process to keep running | no (started by the agent) | yes: `mto serve` ([section 1.5](getting-started.md#1-self-host-in-15-minutes)) |
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
| GitHub Copilot / VS Code | `~/Library/Application Support/Code/User/mcp.json`, `.vscode/mcp.json`, `settings.json` (`mcp.servers`) | JSONC (comments) supported. **VS Code saves big tool results to a file and the agent then reads or `json.load`s that file: see the `prettyJsonAboveTokens` advice in [section 7](tuning.md#7-output-formats-json-vs-toon).** *Tested.* |
| Claude Code | `~/.claude.json` (user + per-project), `.mcp.json` | *Config handling unit-tested; not run against a live Claude Code session by the author.* |
| Claude Desktop | `claude_desktop_config.json` | same caveat |
| Cursor, Windsurf, Gemini CLI, Cline, Roo | see `mto discover` | same caveat |
| anything else | `--file path[#keyPath]` or manual wrapping | |

**Corporate networks:** if a remote MCP server uses a private certificate authority that your OS trusts but Node doesn't, `mto serve` automatically restarts itself with `--use-system-ca` (Node ≥ 22.15). Disable with `MTO_NO_SYSTEM_CA=1`, or use `NODE_EXTRA_CA_CERTS=/path/ca.pem`.

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
