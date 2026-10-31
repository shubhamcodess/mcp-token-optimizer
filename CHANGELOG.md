# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may include breaking changes).

## [Unreleased]

### Added
- **Local daemon** (`mto serve`): authenticated API under `/api/*` (status, stats, config, live event feed, models) with a per-run token, Host/Origin checks, no CORS and no command execution; process registry of connected proxies; wrappers auto-start it (`ui.autoStart`, `MTO_NO_DAEMON=1`); `mto status` and `mto ui`. (#11, #12, #13, #21)
- **CLI help system:** `mto help [command|topic]`, `<command> --help`, did-you-mean for typos, `mto docs`, `mto about`, and `mto config path|get|set|edit` with schema validation and comment-preserving writes. (#17, #18, #20)
- **Models:** `mto models` (list, `use`, `test`, `pull`) and matching daemon endpoints; selecting a model that is not pulled yet is allowed. (#31, #32)
- GitHub Actions: docs link check, installable-package check and a single `CI gate` job in CI; CodeQL, gitleaks secret scan, dependency review, stale-issue handling, manual npm publish; Dependabot for npm and Actions.

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
