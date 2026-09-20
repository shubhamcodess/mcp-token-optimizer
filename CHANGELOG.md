# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may include breaking changes).

## [Unreleased]

## [0.1.0]

First public release.

### Added
- **Proxy for MCP tool responses** with two transports: a stdio wrapper (`mto wrap`) and a local Streamable-HTTP proxy with JSON and SSE support (`mto serve`).
- **Optimization pipeline:** noise pruning (three profiles), cross-field duplicate-block dedupe, JSON/TOON/pretty-JSON output (official `@toon-format/toon`, emitted only after a verified round-trip), text normalization (ANSI, repeated lines, duplicate paragraphs, HTML → text), and a never-bigger guard.
- **Local-LLM summarization via Ollama** with a latency budget, chunking, fact-coverage guard, truncation rejection, circuit breaker and fail-open behaviour. Code, diffs and file-read tools are never summarized.
- **`mto_expand` tool:** notes name exactly what was pruned or condensed; the agent can fetch the exact original (outline, JSON `path`, `grep`, paging, or `full`).
- **Operating modes** `off` / `shadow` / `active`, globally and per tool; profiles `conservative` / `balanced` / `aggressive`; formats `auto` / `json` / `json-pretty` / `toon` and `format.prettyJsonAboveTokens` for clients that save large results to files.
- **Secret detection and redaction** (`off` / `detect` / `redact`) with custom patterns.
- **Installer:** `discover`, `init`, `uninstall` for VS Code/Copilot, Claude Code/Desktop, Cursor, Windsurf, Gemini CLI, Cline, Roo; JSONC-safe in-place edits with backups; `--file`, `--scan`, `--skip`, `--no-builtin`.
- **Tuning loop:** `capture`, `bench` (per-model comparison), `compare`, `stats`, `doctor`, `try`.
- Synthetic examples, a fake MCP server, a small MCP test client, an end-to-end smoke test, launchd/systemd templates, `README.md`, `TESTING.md`, `CONTRIBUTING.md`.
