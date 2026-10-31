# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may include breaking changes).

## [Unreleased]

## [0.2.1] - 2026-10-31

First release on npm: `npm install -g @shubhamcodess/mcp-token-optimizer`. No functional changes to the CLI or the dashboard.

### Added
- **npm publishing**: the package is now `@shubhamcodess/mcp-token-optimizer` (the unscoped name belongs to another project on npm); commands are unchanged (`mto`, `mcp-token-optimizer`). A tag-driven **Publish to npm** workflow runs every check, publishes with provenance using the `NPM_TOKEN` secret, and verifies the registry install; `npm run pack:check` guards the tarball contents; `scripts/verify-registry.sh`. Source maps are no longer shipped. (#50, #51, #52, #53, #54, #55)

### Changed
- The release tarball is now named `shubhamcodess-mcp-token-optimizer-<version>.tgz`.

## [0.2.0] - 2026-10-31

A local dashboard, a proper daemon, self-aware agent integration and an eval gate. Local only, as before: nothing leaves the machine except traffic to your own MCP servers and a local Ollama.

### Changed
- Token counts are labelled as estimates in `stats`, `bench`, `compare`, `eval` and `status` output; `.claude/` is git-ignored; `mto config edit` quotes the file path; the auto-started daemon hides its console window on Windows. (#45)

### Added
- **Local daemon** (`mto serve`): authenticated API under `/api/*` (status, stats, config, live event feed, models) with a per-run token, Host/Origin checks, no CORS and no command execution; process registry of connected proxies; wrappers auto-start it (`ui.autoStart`, `MTO_NO_DAEMON=1`); `mto status` and `mto ui`. (#11, #12, #13, #21)
- **CLI help system:** `mto help [command|topic]`, `<command> --help`, did-you-mean for typos, `mto docs`, `mto about`, and `mto config path|get|set|edit` with schema validation and comment-preserving writes. (#17, #18, #20)
- **Local dashboard** (`mto ui`, Preact + Vite, embedded in the package, no CDN): Overview, Traffic (filters, per-call detail, per-tool rules), Connections (status tree, per-server mode, wrap/unwrap with dry-run diff, backup restore), Config (schema form, raw YAML with diff, restore defaults), Captures, Eval, Doctor and Help; light and dark; strict CSP; token delivered in the URL fragment. A fixed allowlist of named actions: no shell, no command or path input. (#22, #23, #24, #25, #26, #27, #28, #29)
- **Hot reload** of the config in the daemon and wrappers (#14); **audit rotation** with daily rollups and `mto stats --daily` (#15); **`mto service install|uninstall|status`** for launchd and systemd (#16).
- **Per-client profiles** by `clientInfo.name` with a measured VS Code entry (#33); **drift watcher** with banner, `mto drift` and opt-in `drift.autoWrap` (#34); **advisor** and `mto advise` (#35); **tool-definition token cost** from `tools/list`, measurement only (#37).
- **`mto eval`**: savings, lossless and fact-retention gates, baselines, JSON output and exit codes for CI; regression suite over the examples; fidelity check; saved run history and diffs in the dashboard. (#38, #39)
- CI: dashboard bundle budget, regression suite, and a check that the packed tarball ships and serves the dashboard. (#42)
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
