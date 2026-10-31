# Troubleshooting

Symptoms, causes and fixes, from real problems hit while building this. If your symptom is not listed, run `node dist/cli.js doctor` and `mto capture on` followed by `mto compare`.

## 15. Troubleshooting

> Symptoms, causes and fixes, from real problems hit while building this.

| Symptom | Cause / fix |
|---|---|
| `init` says *No MCP servers found* | your config is in a non-standard place: `node dist/cli.js discover --file <path>` or `--scan <dir>` |
| `init --apply` changed more files than I expected | without `--only`/`--no-builtin` it processes every discovered config. Restore with `uninstall --apply` (backups: `<file>.mto.bak`) |
| `init` reports `unparsable` for a file | it has a syntax error; fix it (comments and trailing commas are fine). The file is never modified |
| Agent shows `502 … mto proxy error: fetch failed` | read the reason after it. `SELF_SIGNED_CERT_IN_CHAIN`: corporate CA: use Node ≥ 22.15 (auto) or `NODE_EXTRA_CA_CERTS`; `ECONNREFUSED`: upstream down/URL wrong |
| HTTP server unreachable after `init` | `mto serve` is not running ([section 1.5](docs/getting-started.md#1-self-host-in-15-minutes)) |
| `listen EADDRINUSE 127.0.0.1:8787` | another `mto serve` is running; stop it or use `--port` (and update `routes`/URLs) |
| Config change has no effect | restart `mto serve` (HTTP) or the agent's MCP server (stdio) |
| Agent scripts fail to parse a saved tool result | it was TOON: set `format.prettyJsonAboveTokens: 8000` ([section 7](docs/tuning.md#7-output-formats-json-vs-toon)) |
| Agent keeps calling `mto_expand` | tool is over-pruned: use `profile: conservative`, or `keepKeys` / per-tool `format: json` |
| Savings look negative in `mto stats` | `mto_expand` returned more than was saved: see the `mto_expand:` line at the end of the report |
| Summarization never happens | `doctor` (Ollama down / model missing), text under `summarize.minTokens`, tool matches `neverTools`, or the budget is too small: run with `MTO_DEBUG=1` |
| Summaries too slow | smaller model, lower `maxLatencyMs`, or `summarize.enabled: false` |
| Need to see exactly what the agent got | `mto capture on` then `mto compare` |
| Everything wrong, want to bail out | `mode: off` (config) or `node dist/cli.js uninstall --apply` |
