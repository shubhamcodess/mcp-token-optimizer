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
- TLS verification is never disabled.

## Handling secrets when contributing or reporting

Never paste real API keys, tokens, or captured tool output into issues, pull requests, or logs. If you accidentally did, rotate the credential immediately, then tell us so the content can be removed. Test fixtures must build token-shaped strings from fragments so the repository never contains a live-looking secret literal.
