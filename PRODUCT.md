# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React, built to static files and deployed to GitHub Pages (`shubhamcodess.github.io/mcp-token-optimizer`, so the build needs a configurable base path). The site lives in its own `site/` folder, separate from the CLI source. Motion starts with Impeccable's `animate` guidance; Framer Motion (the `motion` package) is added only if it proves necessary.

## Users

Developers who run AI coding agents (VS Code Copilot, Claude Code, Cursor, Windsurf, Gemini CLI, Cline, Roo) with MCP servers, and who notice tool responses burning tokens and filling the context window. They are evaluating a self-hosted tool, so they read install steps, numbers and caveats closely and distrust marketing language.

## Product Purpose

`mcp-token-optimizer` (CLI: `mto`) is a self-hosted proxy between an AI agent and its MCP servers. It shrinks every tool response (pruning noise, TOON encoding, optional local-LLM summarization via Ollama) before the model sees it, keeps an exact copy of anything removed, and tells the agent how to get it back (`mto_expand`). Success for this page: a developer understands the saving in under a minute, trusts the numbers, installs it, and can undo it.

## Positioning

Lossless-first and fail-open: it only ships an optimized result when it is strictly cheaper, falls back to the original on any error, and runs fully local with no telemetry. A shadow mode measures real savings while still forwarding the originals, so adoption carries no risk. A neighbouring product that only truncates or summarizes could not claim the verified round-trip, the recoverable originals, or the shadow rollout.

## Operating Context

Installed on a developer's machine, wrapping MCP servers declared in their agent's config (`mto discover`, `mto init --only <server> --apply`, undo with `mto uninstall --apply`). Binds to 127.0.0.1. Node 20+ (22.15+ recommended). Ollama is optional and only needed for summarization.

## Capabilities and Constraints

- Features: lossless pruning and TOON encoding (JSON round-trip verified), duplicate-block pointers, fail-open and never-bigger guarantee, `mto_expand` for retrieving originals, shadow/active/off modes, stdio wrapper and local HTTP/SSE proxy, local Ollama summarization with latency budget and fact-coverage guard, optional secret redaction, capture/bench/compare/stats tooling.
- Install today: download the prebuilt `.tgz` from GitHub Releases, or clone and build. The npm package is not published yet and is planned for v3; the page must say so and must not show a working `npm install` as available.
- Licence: Apache-2.0. Repository: github.com/shubhamcodess/mcp-token-optimizer.
- Live-tested by the author: VS Code Copilot agent mode only. Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, Cline and Roo have unit-tested config handling but no live session testing. Linux and Windows are unverified.
- Decision (user): the "works with" strip shows all agents equally, with no per-agent "tested" mark. Because of that, the verified-versus-unverified status must still be stated plainly elsewhere on the page (for example in the install guide or the test section) so the strip does not overclaim.

## Brand Commitments

- Name: `mcp-token-optimizer`; CLI `mto`. Tagline from the README: "Stop paying for tool-response noise."
- Binding visual constraints volunteered by the user (revised 2026-10-22, replacing the earlier flat/no-window brief, which the user rejected as tasteless and text-heavy): a dev-tool feel in the spirit of Cursor, OpenCode and Kiro; a realistic, animated coding-agent screen mock that shows a request going through mto and the response being cut, with tokens saved; a subtle dynamic background (pattern, gradient or fading texture, as on opencode.ai); agent logos in the works-with strip; far less text; separate light and dark themes, dark not black; not generic "AI slop".

## Evidence on Hand

Reproducible, no-LLM results from `npm run smoke` (token counts are a model-agnostic estimate), documented in README and TESTING.md:

- GitHub issue list (40 issues, REST JSON): 37,355 to 13,244 tokens, 64.5% saved
- Kubernetes describe + manifest (duplicated content): 3,637 to 1,935, 46.8%
- CI build log (ANSI, repeated lines): 4,926 to 78, 98.4%
- HTML runbook page: 1,198 to 863, 28.0%
- Real Kubernetes ConfigMap through a live MCP server, Copilot A/B run: 24,616 to 12,617, 48.7%. The three files the agent wrote from the optimized result were byte-identical to the original data.
- Test footprint: 42 tests and a 24-check end-to-end smoke test.
- Existing assets: `docs/architecture-light.svg`, `docs/architecture-dark.svg`, issue templates `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`.

Real demo material: `examples/github-issues.json` (synthetic acme/widgets issues) and the real optimized output of `node scripts/mcp-call.mjs --tool list_issues` (TOON list `[40]:` ending with the note `[mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, gravatar_id×40, followers_url×40. Only if you need them: mto_expand {\"id\":\"7b105335b224\",\"path\":...}]`, ~13,244 tokens). `npm run smoke` passes 24 checks. Agent logos available from Simple Icons for Claude Code, Claude, GitHub Copilot, Cursor, Windsurf, Gemini and Cline; none for Roo.

Absent, so must not be fabricated: testimonials, customer or user counts, download or star counts, pricing, an npm package, performance data on Linux or Windows.

## Product Principles

1. Show the saving, with real numbers and honest caveats; never round up a result or hide a limitation.
2. Lossless and reversible by default: the page should make clear nothing is permanently lost and the install can be undone.
3. Local and private: no cloud, no telemetry, nothing leaves the machine.
4. Earn trust through verifiability: every number points at a command the reader can run themselves.
5. Developer-direct tone: plain, specific, unhyped.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` (the animated explainer needs a static equivalent). Light and dark themes both meet WCAG AA contrast. The page works at phone width. Copy buttons and the feedback form are keyboard-operable.
