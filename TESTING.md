# Testing and benchmarking guide

How to prove that `mto` (1) saves tokens, (2) does not damage what your agent can do, and (3) is safe. Six layers, cheapest first. Layers 1–5 need **no agent and no network**; layer 6 is the live A/B test with a real agent.

| Layer | What it proves | Needs | Time |
|---|---|---|---|
| 1. Automated tests | logic is correct (TOON round-trip, guardrails, installer, proxy) | Node | 1 min |
| 2. Deterministic benchmark | savings on known data, per profile/format | Node | 2 min |
| 3. Protocol end-to-end | modes, `mto_expand`, HTTP/SSE proxy behave as documented | Node | 3 min |
| 4. Fault injection | fail-open, guardrails, never-bigger, no data leaks | Node (+ Ollama for one) | 5 min |
| 5. LLM model benchmark | which Ollama model + params on *your* data | Ollama | 10–30 min |
| 6. Live agent A/B | the agent still does the task correctly, cheaper | your agent + capture | 30 min |

All expected numbers below come from real runs on the synthetic data in `examples/` (macOS, Node 22.16). Token counts are the tool's model-agnostic estimate. Expect identical numbers for layers 2–3 (deterministic); layer 5–6 vary with hardware and data.

---

## 0. Setup

```bash
cd mcp-token-optimizer
npm install
npm run build
npm run examples          # regenerates examples/* (deterministic, synthetic, safe to commit)
export MTO_HOME=$(mktemp -d)     # isolate ALL test state from your real ~/.mcp-token-optimizer
```

Keeping `MTO_HOME` pointed at a temp dir means tests never touch your real mto config, audit log or captures. Unset it (or open a new shell) to go back.

> **`MTO_HOME` does NOT protect your agent config files** (VS Code `mcp.json`, `~/.claude.json`, …). Those live elsewhere. Any test that runs `init`/`uninstall` with `--apply` must use **`--no-builtin --file <a copy>`**, which restricts it to the file you name. Without `--no-builtin`, `init --apply` edits *every* MCP config it finds, including your real ones. For extra safety prefix such commands with `HOME=$(mktemp -d)`.

Sample data (`examples/`):

| File | Simulates | Why it is interesting |
|---|---|---|
| `github-issues.json` (37,355 tok) | GitHub REST list | nulls, hypermedia URLs, avatars, node ids |
| `k8s-configmap.json` (3,637 tok) | Kubernetes describe + manifest | the same text appears twice (`describeText` and `manifest`) |
| `deploy-guide.md` (2,283 tok) | long prose with facts | summarization + fact retention |
| `build.log` (4,926 tok) | CI log | ANSI, repeated lines |
| `page.html` (1,198 tok) | web page | HTML → text |
| `source.ts` (6,420 tok) | source code | must never be rewritten |
| `structured-result.json` (859 tok) | MCP result with `structuredContent` | contract, must stay intact |
| `secrets.txt` (376 tok) | fake AWS/GitHub/Slack/JWT/Bearer secrets | detection / redaction |
| `fake-mcp-server.mjs` | a demo MCP server (stdio or `--http PORT`) | end-to-end tests without an agent |

---

## 1. Automated tests

```bash
npm run typecheck          # tsc --noEmit: no output = OK
npm test                   # 42 tests
```

Expected tail: `# pass 42` / `# fail 0`.

| File | Covers |
|---|---|
| `tests/toon.test.ts` | TOON encode/decode round-trip incl. a **1,500-document fuzz** |
| `tests/pipeline.test.ts` | pruning, TOON choice, `outputSchema`/`structuredContent` untouched, never-bigger, summarization guards (dropped facts, truncation, latency budget, never-summarize code, LLM failure), redaction, dedupe, notes, `json-pretty` |
| `tests/expand.test.ts` | prune → `mto_expand` (outline, `path`, `full`) → audit → `compare` verdict; per-tool active override under global shadow |
| `tests/installer.test.ts` | `init`/`uninstall` round-trips, **JSONC comments preserved**, unparsable files untouched, discovery (`--file`, key-path auto-detect, `~`/env expansion, scan), config `~` expansion |
| `tests/discovery-cli.test.ts` | `--no-builtin` touches **only** the named file (runs with a throw-away `HOME`); repeated `--skip` flags |
| `tests/http.test.ts` | HTTP proxy: header forwarding, JSON + SSE, session ids, local `mto_expand`, host and route guards |
| `tests/e2e.test.ts` | real `mto wrap` process end to end |

Run one file: `node --import tsx --test tests/pipeline.test.ts`.

Self-checking end-to-end battery (fake server, ports 9191/9192 on localhost):

```bash
npm run smoke
```

Expected: 24 lines starting with `PASS`, ending `All checks passed`, exit code 0. Any `FAIL` prints the failing check with the measured value.

---

## 2. Deterministic benchmark on known data

### 2.1 One response at a time

`mto try <file>` optimizes a saved response and prints the result (stdout) and a one-line summary (stderr).

```bash
printf 'audit:\n  enabled: false\nsummarize:\n  enabled: false\n' > /tmp/nollm.yaml
for f in github-issues.json k8s-configmap.json build.log page.html deploy-guide.md structured-result.json source.ts; do
  printf '%-24s' $f; node dist/cli.js try examples/$f --config /tmp/nollm.yaml 2>&1 >/dev/null | grep -o 'tokens.*' | cut -c1-110
done
```

Expected:

```
github-issues.json      tokens 37355 → 13244 (64.5% saved) · stages: prune, toon · lossy: false
k8s-configmap.json      tokens 3637 → 1935 (46.8% saved) · stages: xdedupe, toon · lossy: false
build.log               tokens 4926 → 78 (98.4% saved) · stages: normalize · lossy: false
page.html               tokens 1198 → 863 (28.0% saved) · stages: html→text · lossy: false
deploy-guide.md         tokens 2283 → 1489 (34.8% saved) · stages: normalize · lossy: false
structured-result.json  tokens 859 → 782 (9.0% saved) · stages: minify · lossy: false
source.ts               tokens 6420 → 6419 (0.0% saved) · stages: normalize · lossy: false
```

What to check: `source.ts` is essentially unchanged (code is not rewritten); `structured-result.json` only minified (contract), `lossy: false` everywhere without the LLM.

### 2.2 Profiles

```bash
for p in conservative balanced aggressive; do
  printf "audit:\n  enabled: false\nprofile: $p\nsummarize:\n  enabled: false\n" > /tmp/$p.yaml
  printf '%-14s' $p; node dist/cli.js try examples/github-issues.json --config /tmp/$p.yaml 2>&1 >/dev/null | grep -o 'tokens.*' | cut -c1-60
done
```

```
conservative  tokens 37355 → 28144 (24.7% saved)
balanced      tokens 37355 → 13244 (64.5% saved)
aggressive    tokens 37355 → 9584 (74.3% saved)
```

`k8s-configmap.json` shows the dedupe stage: `conservative` → 3553 (2.3%), `balanced` → 1935 (46.8%).

### 2.3 Formats

```bash
for f in json json-pretty; do
  printf "audit:\n  enabled: false\nsummarize:\n  enabled: false\nformat:\n  default: $f\n" > /tmp/$f.yaml
  printf '%-12s' $f; node dist/cli.js try examples/github-issues.json --config /tmp/$f.yaml 2>&1 >/dev/null | grep -o 'tokens.*' | cut -c1-80
done
```

```
json         tokens 37355 → 16117 (56.9% saved) · stages: prune, minify
json-pretty  tokens 37355 → 16734 (55.2% saved) · stages: prune, json-pretty
```

Confirm `json-pretty` output is valid, multi-line JSON:

```bash
node dist/cli.js try examples/github-issues.json --config /tmp/json-pretty.yaml 2>/dev/null | node -e 'const t=require("fs").readFileSync(0,"utf8"); JSON.parse(t.replace(/\n\[mto:.*$/s,"")); console.log("valid JSON,", t.split("\n").length, "lines")'
```

### 2.4 Replay a whole set with `mto bench`

```bash
node scripts/examples-to-captures.mjs $MTO_HOME/captures     # examples → a captures dir
cp /tmp/nollm.yaml $MTO_HOME/config.yaml
node dist/cli.js bench                                        # reads $MTO_HOME/captures
```

Expected:

```
server.tool                           n       in      out   saved lossy  avg ms   facts  stages
demo.list_issues                      1    37355    13164   64.8%     0      23       -  prune,toon
demo.build_log                        1     4926       78   98.4%     0       1       -  normalize
demo.describe_configmap               1     3637     1935   46.8%     0       2       -  xdedupe,toon
demo.fetch_guide                      1     2283     1489   34.8%     0       1       -  normalize
demo.get_page                         1     1198      863   28.0%     0       1       -  html→text
demo.get_rows                         1      859      782    9.0%     0       0       -  minify
demo.read_file                        1     6420     6419    0.0%     0       2       -  normalize
TOTAL                                 7    56678    24730   56.4%     0       4       -
```

(`bench` has no store, so it omits the `[mto: …]` note that the proxy adds: 13,164 vs 13,244.) The `avg ms` column is the pipeline's own latency: single-digit to ~30 ms for the deterministic stages.

**Pass criteria for your own data:** total saving is positive, `lossy` is 0 without the LLM, no tool where `saved` is negative.

---

## 3. Protocol end-to-end with the fake MCP server

`scripts/mcp-call.mjs` is a minimal MCP client: it performs `initialize`, optionally `tools/list`, and one `tools/call`, then prints what **the agent would receive** and its token estimate.

Define shortcuts (bash/zsh):

```bash
w() { node scripts/mcp-call.mjs "$@" -- node dist/cli.js wrap --name demo -- node examples/fake-mcp-server.mjs; }
cfg() { printf "$1" > $MTO_HOME/config.yaml; }
```

### 3.1 Direct vs through the optimizer

```bash
cfg 'summarize:\n  enabled: false\n'
node scripts/mcp-call.mjs --tool list_issues --quiet -- node examples/fake-mcp-server.mjs   # ~37355 tokens (direct)
w --tool list_issues --quiet                                                                # ~13244 tokens
w --list                                                                                    # tools incl. mto_expand; instructions mention TOON
```

### 3.2 Modes

| Config | Command | Expected `agent received` |
|---|---|---|
| `mode: active` *(default)* | `w --tool list_issues --quiet` | `~13244 tokens` |
| `mode: shadow` | same | `~37355 tokens`; then `node dist/cli.js stats` prints `Projected: … tokens` and "Includes shadow-mode rows" |
| `mode: off` | same | `~37355 tokens`; nothing recorded |
| shadow + per-tool active | `tools:\n  "demo.list_issues":\n    mode: active` | `list_issues` → `~13164`; `describe_configmap` → `~3637` (untouched) |
| per-tool off | `tools:\n  "demo.list_*":\n    mode: off` | `list_issues` → `~37355`; `describe_configmap` → `~1935` |

```bash
cfg 'mode: shadow\nsummarize:\n  enabled: false\n'
w --tool list_issues --quiet          # ~37355 tokens  (agent still gets the original)
node dist/cli.js stats | tail -4      # Projected: 23,… tokens
```

### 3.3 Profiles and formats through the proxy

```bash
cfg 'profile: conservative\nsummarize:\n  enabled: false\n'; w --tool list_issues --quiet   # ~28144
cfg 'profile: aggressive\nsummarize:\n  enabled: false\n';   w --tool list_issues --quiet   # ~9584
cfg 'format:\n  default: json-pretty\nsummarize:\n  enabled: false\n'; w --tool list_issues --quiet
```

### 3.4 Contracts and safety rules

```bash
cfg 'summarize:\n  enabled: false\n'
w --tool get_rows --raw | tail -3                 # ends with "structuredContent present": contract kept
w --tool describe_configmap --raw | grep -o 'lines identical to[^"]*'   # dedupe pointer: $.manifest.data[...]
w --tool read_file --quiet                        # ~6419 tokens: code untouched (also with the LLM on)
w --tool build_log --quiet                        # < 300 tokens
```

### 3.5 `mto_expand`

```bash
cfg 'summarize:\n  enabled: false\n'
OUT=$(w --tool list_issues); echo "$OUT" | grep -o '\[mto: .*\]'
# [mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, gravatar_id×40, followers_url×40. Only if you need them: mto_expand {"id":"…","path":...}]
ID=$(echo "$OUT" | grep -o 'mto_expand {"id":"[0-9a-f]*"' | grep -o '[0-9a-f]\{12\}')

w --tool mto_expand --args "{\"id\":\"$ID\"}" | head -4                                   # outline, ~37355 tok original
w --tool mto_expand --args "{\"id\":\"$ID\",\"path\":\"\$[3].node_id\"}" | head -1          # I_kwDOAbCdEf3xYz
w --tool mto_expand --args "{\"id\":\"$ID\",\"path\":\"\$[3].user.avatar_url\"}" | head -1  # https://avatars.githubusercontent.com/u/103?v=4
w --tool mto_expand --args '{"id":"000000000000"}' | head -1                                # No stored original …
node dist/cli.js stats | tail -2                                                            # mto_expand: agent asked for originals 4x (1 misses) …
```

Check that lossless-only changes produce **no** note: `w --tool describe_configmap` shows `xdedupe` pointers but no `[mto: …]` line.

### 3.6 Redaction

```bash
cfg 'summarize:\n  enabled: false\n'                       # detect mode (default)
w --tool get_secrets --raw | grep -c AKIA   # 1  → text untouched
node dist/cli.js stats | tail -2                            # Secrets seen in tool output: aws-access-key×1, github-token×1, slack-token×1, jwt×1, bearer×1
cfg 'redaction:\n  mode: redact\nsummarize:\n  enabled: false\n'
w --tool get_secrets --raw | grep -o 'REDACTED:[a-z-]*'     # aws-access-key, github-token, slack-token, jwt, bearer
```

### 3.7 HTTP proxy (JSON, SSE, headers, guards)

```bash
cfg 'summarize:\n  enabled: false\n'
echo '{"demo":{"url":"http://127.0.0.1:9100/mcp"}}' > $MTO_HOME/routes.json
node examples/fake-mcp-server.mjs --http 9100 & UP=$!                 # upstream; demands header X-API-Key: demo-key
node dist/cli.js serve --port 8790 & PX=$!; sleep 2.5
P=http://127.0.0.1:8790/demo

node scripts/mcp-call.mjs --tool list_issues --quiet --url http://127.0.0.1:9100/mcp --header X-API-Key=demo-key   # ~37355 (direct)
node scripts/mcp-call.mjs --tool list_issues --quiet --url $P --header X-API-Key=demo-key                          # ~13244 (proxy; key forwarded)
node scripts/mcp-call.mjs --tool describe_configmap --quiet --sse --url $P --header X-API-Key=demo-key             # ~1935 (SSE optimized)
node scripts/mcp-call.mjs --tool list_issues --quiet --url $P                                                      # ERROR: HTTP 401 … (upstream's 401 passes through)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8790/nope -d '{}'                                       # 404
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: evil.example.com' -X POST localhost:8790/demo -d '{}'           # 403
kill $UP; sleep 0.5
curl -s -w " [%{http_code}]\n" -X POST $P -H 'content-type: application/json' -H 'X-API-Key: demo-key' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
# mto proxy error: fetch failed: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:9100 [502]
kill $PX
```

---

## 4. Fault injection and guardrails

Each row is a "what if it goes wrong" case with the expected safe behaviour. Layers 1 and 3 cover most; these are the manual ones.

| Scenario | How to inject | Expected |
|---|---|---|
| **Ollama down** | `printf 'audit:\n  enabled: false\nllm:\n  baseUrl: http://127.0.0.1:9\n' > /tmp/down.yaml; node dist/cli.js try examples/deploy-guide.md --config /tmp/down.yaml` | succeeds; `tokens 2283 → 1489 … stages: normalize` (deterministic only, no error) |
| **Model missing** | `llm.model: does-not-exist`; `node dist/cli.js doctor` | `✗ ollama is up but model "does-not-exist" is not pulled` |
| **Bad config key** | add `modee: shadow`; `node dist/cli.js doctor` | `✗ Invalid config …: (root): Unrecognized key(s)…` |
| **Unparsable agent config** | `node dist/cli.js discover --file <broken.json>` | `⚠ unparsable: …`; `init --apply` leaves the file byte-for-byte unchanged |
| **Upstream HTTP server down** | stop the fake HTTP server | `502 … ECONNREFUSED` (section 3.7) |
| **Corporate CA / TLS failure** | upstream with a private CA | reason shown (`SELF_SIGNED_CERT_IN_CHAIN`); `mto serve` on Node ≥ 22.15 trusts the OS store automatically |
| **Optimized result not smaller** | tiny input: `echo '{"a":1}' > /tmp/s.json; node dist/cli.js try /tmp/s.json` | unchanged (`stages: none`): never-bigger guard |
| **Contract tools** | `get_rows` (§3.4) | `structuredContent` and schema tools never modified |
| **Code and diffs** | `read_file` with LLM enabled | ~6419 tokens; never summarized |
| **Secrets** | §3.6 | detected/audited or redacted; fallbacks never re-expose redacted secrets |
| **Slow model** | `summarize.maxLatencyMs: 3000` + `MTO_DEBUG=1 node dist/cli.js try examples/deploy-guide.md --config …` | chunks logged as `skipped … predicted=…ms`; result returns within ~3 s; unfinished chunks verbatim |
| **Truncated generation** | unit-tested (`tests/pipeline.test.ts`: *truncated LLM generations are discarded*) | chunk kept verbatim |
| **Dropped headings / facts in a summary** | unit-tested (headings never reach the LLM; fact coverage guard) | facts re-attached or summary rejected |
| **Stale/unknown `mto_expand` id** | §3.5 | error result, no crash |
| **Kill the wrapper mid-call** | Ctrl-C the agent | child server exits (signals forwarded) |

Safe install/uninstall test on a **synthetic** JSONC file (never your real config):

```bash
cat > /tmp/mcp-demo.json <<'JSON'
{
  // my servers
  "servers": {
    "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp"], "type": "stdio" },
    "remote": { "type": "http", "url": "https://mcp.example.com/api", "headers": { "X-API-Key": "demo-key" } },
    // "old": { "command": "x" },
  },
}
JSON
H=$(mktemp -d)                                                   # throw-away HOME as a second safety net
HOME=$H node dist/cli.js init --no-builtin --file /tmp/mcp-demo.json            # dry run: wrap shadcn, wrap-http remote
HOME=$H node dist/cli.js init --no-builtin --file /tmp/mcp-demo.json --apply
cat /tmp/mcp-demo.json          # comments kept; shadcn → node …/cli.js wrap …; remote url → http://127.0.0.1:8787/remote; headers untouched
HOME=$H node dist/cli.js uninstall --no-builtin --file /tmp/mcp-demo.json --apply
cat /tmp/mcp-demo.json          # original commands/URL restored; comments kept (only whitespace may differ: args arrays are re-indented)
```

Expected dry-run output: exactly two lines, `wrap  shadcn  custom: mcp-demo.json …` and `wrap-http  remote  custom: mcp-demo.json …`. Nothing from any built-in location appears.

---

## 5. Benchmarking local LLMs on your data

Goal: pick the model and parameters that give the best *savings at acceptable latency without losing facts*, on **your** long-text tool outputs.

### 5.1 Get candidate models

```bash
ollama list
ollama pull qwen3:4b granite4:3b llama3.2:3b      # baseline set
ollama pull gemma3:4b qwen3.5:4b                   # commonly recommended small models to add
```

### 5.2 Run the comparison

Either on the sample document (needs a low `minTokens` since the sample is short):

```bash
node scripts/examples-to-captures.mjs $MTO_HOME/captures
printf 'audit:\n  enabled: false\nsummarize:\n  minTokens: 400\n  maxLatencyMs: 40000\n' > $MTO_HOME/config.yaml
node dist/cli.js bench --models qwen3:4b,granite4:3b,llama3.2:3b --dump $MTO_HOME/report
```

or, much better, on your own captures (section 6, or `node dist/cli.js capture on` in your agent): `node dist/cli.js bench --models … --dump ~/mto-report`.

Read the `facts` column (share of critical facts (paths, ids, versions, URLs, numbers, error codes) that survived), `avg ms`, `saved`, and the before/after examples in `<dump>.<model>.md`.

### 5.3 Decision rubric

| Metric | Target |
|---|---|
| `facts` retained | **≥ 97%** (the guard rejects anything worse, so lower means the model isn't helping) |
| `avg ms` | ≤ your `maxLatencyMs`; the agent waits for it |
| `saved` beyond the no-LLM baseline | worth the latency? (measured on the sample doc: +4 points for ~33 s. If small, disable summarization) |
| Failure modes in `MTO_DEBUG=1` output | many `rejected truncated=true` → model too chatty for `num_predict`; many `skipped … predicted` → too slow for the budget |

Reference results (one synthetic 5k-token doc, 20 s budget, Apple silicon; do not generalize):

| Model | tok/s | saved | facts | verdict |
|---|---|---|---|---|
| qwen3:4b | ~35 | 48.8% | 100% | default |
| granite4:3b | ~40 | 49.5% | 100% | good faster alternative |
| llama3.2:3b | ~44 | 49.9% (one run 90% facts) | 90–100% | acceptable, verify on your data |
| qwen3.5:0.8b | ~68 | – | 81%, truncations | avoid |
| gemma4:e4b | ~30 | – | timeouts | avoid |

Tuning knobs to try: `llm.options.num_ctx` (bigger = fewer chunks, slower), `summarize.targetRatio`, `summarize.maxLatencyMs`, `summarize.concurrency` (only helps with `OLLAMA_NUM_PARALLEL>1`), `llm.think: false`.

---

## 6. Live agent A/B test (the real proof)

Question answered: *does the agent still complete the same task correctly, using fewer tokens, with no extra work?* Run the **same prompt** three ways and compare tool-level numbers, agent effort, and the final artifacts.

### 6.1 Prerequisites

```bash
unset MTO_HOME                         # use your real ~/.mcp-token-optimizer for the live test
node dist/cli.js discover              # your servers are listed
node dist/cli.js init --only <server> --apply      # wrap the server(s) under test (dry-run without --apply first)
node dist/cli.js serve                 # only if the server is HTTP; keep it running
node dist/cli.js capture on            # record ORIGINALS (+ what the agent received, in active mode)
```

Choose a task that (a) calls the tools you want to measure, (b) **produces a checkable artifact** (a file, a diff, a specific answer), and (c) is repeatable. Write the prompt down and reuse it verbatim.

### 6.2 Controls: what usually ruins an A/B run

| Contamination | Prevention |
|---|---|
| Agent finds files from the previous run and says "already done" | **move/delete output files between runs** (keep copies elsewhere) |
| Agent memory / earlier context | start a **new chat** for each run; note if the tool has "memory" and clear it |
| Different prompt wording | paste the identical prompt |
| Config not reloaded | restart `mto serve` (HTTP) and the agent's MCP server (stdio) after any config change |
| Timing windows overlapping in `stats` | note the time before each run; filter `stats` by time |
| Agent post-processes saved tool results with scripts (VS Code Copilot does) | see the `json-pretty` advice; check the agent's steps for parse failures |

### 6.3 Three runs

| Run | Config | What it is |
|---|---|---|
| **Baseline** | `mode: shadow` (or `off`) | the agent gets the originals; the proxy records what it *would* have saved |
| **Active** | `mode: active`, your target profile/format | the agent gets optimized results |
| **Active, tuned** | after fixing anything found (e.g. `format.prettyJsonAboveTokens: 8000`) | confirm the fix |

For each run: (1) move previous outputs aside, (2) note the time, (3) restart the affected servers, (4) new chat, identical prompt, (5) save the agent's step list and final answer, (6) copy the output artifacts to `~/runs/<name>/`.

### 6.4 What to measure

**A. Token numbers, from the proxy** (`stats` filters by age: `--since 20m`):

```bash
node dist/cli.js stats --since 20m
```

Read: per-tool `tokens_in → tokens_out`, `TOTAL … saved %`, and the last lines `mto_expand: agent asked for originals Nx (M misses)`.

- **Net saving** = total `tokens_out` (which *includes* what `mto_expand` returned) vs `tokens_in`. **Negative net means the optimizer cost more than it saved**, which is usually an over-eager note or over-pruning.
- Target: positive net, and few or no `mto_expand` calls for tasks that don't need dropped fields.

**B. What the agent actually received, vs the original:**

```bash
node dist/cli.js compare --last 10
```

Verdicts: `EQUIVALENT` / `UNCHANGED` are fine; `PRUNED-DATA` lists the dropped fields (check none matter for your task); `VALUE-CHANGED` must never appear.

**C. Byte-level fidelity of the agent's output against ground truth.** Compare what the agent wrote with the *original* tool result captured before optimization:

```bash
node scripts/fidelity.mjs --tool kube_get_resource_details \
  --path '$.manifest.data["app.properties"]' --file ./tmp-fetched/app.properties
# IDENTICAL  original=5614B md5:28e0a8b3   file=5614B md5:28e0a8b3   (sample …)     exit 0
# DIFFERENT  …  first difference at byte N (whitespace/newline only)                  exit 1
```

`--which N` picks an older sample; `--dir` points at another captures directory. Omit `--path` to compare a whole tool result. For agent outputs that the agent retyped itself, differences (for example blank lines) come from the model, not the proxy; the check against the *captured original* tells you which.

Also diff artifacts between runs:

```bash
diff -q ~/runs/baseline/out.yaml ~/runs/active/out.yaml && echo IDENTICAL
```

**D. Agent effort**, from the agent's step list: number of tool calls, any failed scripts or retries, extra `mto_expand` calls, and whether the final answer covers the same facts.

### 6.5 Pass / fail criteria

| Check | Pass |
|---|---|
| Correctness | final answer covers the same facts; artifacts byte-identical to ground truth (C) |
| Tokens | net saving > 0 in `stats` (A) |
| Data safety | `compare` has no `VALUE-CHANGED`; any `PRUNED-DATA` is data your task doesn't use |
| Agent effort | no more steps than baseline (±1), no parse failures |
| `mto_expand` | 0 calls, or a few narrow `path`/`grep` calls, never repeated full dumps |
| Latency | task time not noticeably longer (`stats` `avg` column is pipeline time per call) |

### 6.6 Results template

Copy into your notes:

```
Task/prompt: …                         Agent + version: …           Date: …
Servers under test: …                  mto commit/version: …        Config diff vs defaults: …

            | steps | tool tokens in→out | net % | expand calls | artifacts vs ground truth | verdict
baseline    |       |                    |       |              |                           |
active      |       |                    |       |              |                           |
active+tune |       |                    |       |              |                           |

Anything the agent did differently / failed at: …
Next change to try: …
```

### 6.7 What the author's real A/B produced (for orientation)

Task: fetch a Kubernetes ConfigMap through an HTTP MCP server and save its three data keys.

| Run | Result |
|---|---|
| Run A (note on lossless dedupe) | correct, but the agent followed the note and pulled 32k tokens via `mto_expand` → **net −16.5%**. Fix: notes only when named data was dropped; `mto_expand` returns an outline by default |
| Run B, first attempt | invalid: the agent found Run A's files and did nothing new. Fix: move outputs aside |
| Run B, clean | 6 calls, 54,647 → 27,894 tokens (**49% net**), 0 expand calls, three output files **byte-identical** to the ground truth (`fidelity.mjs`). But the agent needed ~7 extra steps to parse TOON in a saved file. Fix: `format.prettyJsonAboveTokens: 8000` |

---

## 7. Measuring overhead

* **Pipeline time per call:** `node dist/cli.js stats` → `avg` column (deterministic stages: ~1–30 ms on the examples; the LLM stage adds seconds, bounded by `summarize.maxLatencyMs`).
* **End-to-end time:** compare the agent task duration between baseline and active runs (6.4 D).
* **Proxy round-trip (HTTP):** `time` the two `mcp-call` invocations of §3.7. Process start-up of the client dominates on small payloads.

## 8. Regression checklist (before you rely on a change)

```bash
npm run typecheck && npm test && npm run smoke                 # 42 tests + 24 checks
node dist/cli.js bench                                          # with MTO_HOME=<temp with examples captures>; totals as in §2.4
node dist/cli.js doctor
```

Then a short live run (6.3 "Active") on one real task, and `node dist/cli.js compare` with no `VALUE-CHANGED`.

## 9. Cleaning up after testing

```bash
node dist/cli.js capture off
rm -rf ~/.mcp-token-optimizer/captures                          # recorded tool output
node dist/cli.js uninstall --apply                              # only if you want the agent configs restored
```
