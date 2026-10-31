# Tuning

Profiles, output formats, local summarization, and how to measure the result on your own data. Benchmark procedure: [TESTING.md](../TESTING.md).

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

See, switch, test and download models without editing YAML (Ollama must be running):

```bash
mto models                     # pulled models with size/family; * marks the active one
mto models use granite4:3b     # set llm.model (any name, even one you have not pulled yet)
mto models test                # fixed summarization: key facts kept (of 5), seconds, tokens/s
mto models pull llama3.2:3b    # download through your local Ollama (the only explicit download)
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

Captures contain real tool output from your systems (only common secret patterns are redacted). Treat `~/.mcp-token-optimizer/captures/` as sensitive; `capture off` and deleting the folder removes it. Full benchmarking procedure: **[TESTING.md](../TESTING.md)**.
