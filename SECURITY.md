# Security policy

mcp-token-optimizer sits between AI agents and their tools, so it can see tool output and forwards credentials to MCP servers. We take that seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private reporting: open the repository's **Security** tab → **Report a vulnerability**. Include:

- what you found and why it matters (impact),
- steps to reproduce (a minimal, synthetic reproduction; never real secrets),
- the version or commit, your OS and Node version.

You can expect an acknowledgement within a few days. We will keep you informed, agree a disclosure timeline with you, and credit you in the release notes unless you prefer otherwise.

## Supported versions

This is a young project: only the latest release and `main` receive security fixes.

## What is in scope

- Leaking credentials (HTTP headers, API keys, tokens) to logs, the audit file, captures, the store, or over the network to anything other than the configured upstream
- The local HTTP proxy being reachable or abusable from other hosts or web pages (DNS rebinding, open-proxy behaviour, SSRF through `routes.json`)
- Path traversal or unsafe file writes in `init`/`uninstall`, the store, or captures
- A redaction bypass for the built-in secret patterns when `redaction.mode: redact`
- Prompt-injection paths that make the summarizer or `mto_expand` act on instructions found in tool output
- Supply-chain issues in the published package or its dependencies

## Design notes for reviewers

- The proxy binds to `127.0.0.1`, rejects non-loopback `Host` headers, and forwards only to URLs listed in `routes.json`.
- Client headers are forwarded verbatim to the configured upstream and are never logged, audited, or written to disk.
- The audit log holds sizes only, never tool content.
- The store (originals for `mto_expand`) and captures hold real tool output. They are created with `0600` files in a `0700` directory and expire (`retrieval.ttlMinutes`); captures exist only while `mto capture on` and are secret-redacted by pattern (best effort).
- Local only: no telemetry, no cloud model providers; the only network traffic is to the user's configured MCP servers and a local Ollama.
- The daemon and dashboard (`mto serve`, `mto ui`) bind to `127.0.0.1`, require a per-run bearer token (kept in `daemon.json`, mode 0600), accept only loopback `Host` and same-origin `Origin` headers, send no CORS headers, serve the UI with a CSP that allows only `'self'`, and expose no endpoint that runs a command or takes a file path: only a fixed list of named actions with validated arguments. On Windows, file modes are not enforced, so the token file relies on your user profile's permissions.
- TLS verification is never disabled.

## npm publishing

The package is published from GitHub Actions only, with a provenance attestation that links each npm version to the workflow run and commit that built it. The publishing credential is a granular npm access token limited to this package (or scope), kept only as the repository secret `NPM_TOKEN`; it is never printed, written to disk by our scripts or available to pull requests from forks. Rotate it at least yearly and immediately if it may have leaked. The scoped name `@shubhamcodess/mcp-token-optimizer` is the only official package: the unscoped `mcp-token-optimizer` on npm is an unrelated project.

## Handling secrets when contributing or reporting

Never paste real API keys, tokens, or captured tool output into issues, pull requests, or logs. If you accidentally did, rotate the credential immediately, then tell us so the content can be removed. Test fixtures must build token-shaped strings from fragments so the repository never contains a live-looking secret literal.
