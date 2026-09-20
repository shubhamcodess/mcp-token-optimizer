# Contributing to mcp-token-optimizer

Thanks for taking the time to contribute! This project is small enough that one person can understand all of it, and we would like to keep it that way. Bug reports, docs fixes, benchmark results, new agent integrations and pipeline improvements are all welcome.

**Contents:** [Ways to contribute](#ways-to-contribute) · [Project principles](#project-principles) · [Development setup](#development-setup) · [Safety when testing installs](#safety-when-testing-installs) · [Making a change](#making-a-change) · [Common tasks](#common-tasks) · [Pull request checklist](#pull-request-checklist) · [Sharing benchmark data](#sharing-benchmark-data) · [Releases](#releases-maintainers) · [Ideas for first contributions](#ideas-for-first-contributions)

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems: please do **not** open a public issue; see [SECURITY.md](SECURITY.md).

---

## Ways to contribute

| You want to… | Do this |
|---|---|
| Report a bug | Open an issue with the **Bug report** form. Include `node dist/cli.js doctor` output and, if you can, a minimal tool response that reproduces it (synthetic or redacted, never real secrets) |
| Suggest a feature | Open an issue with the **Feature request** form. Explain the problem first, then the idea |
| Fix a typo or improve docs | Send a PR directly. No issue needed |
| Add support for another agent's config file | See [Add an agent target](#add-an-agent-target) |
| Share benchmark numbers for a model or tool | See [Sharing benchmark data](#sharing-benchmark-data) |
| Fix a bug or build a feature | Comment on (or open) an issue first for anything bigger than a small fix, so we agree on the approach before you invest time |

## Project principles

These are the rules the code is judged against. A change that breaks one needs a very good reason.

1. **Never hurt the agent.** Optimization is *fail-open*: any error, timeout or missing dependency forwards the original response untouched.
2. **Never bigger.** An optimized result is used only if it is strictly cheaper than the original.
3. **Say exactly what is lost.** Lossless stages must stay lossless (TOON is emitted only if it round-trips). Lossy stages must be *named* in a note and recoverable through `mto_expand`.
4. **Contracts are sacred.** Results with `structuredContent` or a declared `outputSchema`, error results, and code/diffs are never rewritten semantically.
5. **Local only.** No telemetry, no cloud calls. The only network traffic is to the user's own MCP servers and Ollama on localhost. Credentials are forwarded, never stored or logged.
6. **Measure, don't guess.** Claims about savings or model quality need a reproducible number ([TESTING.md](TESTING.md)).
7. **Small dependency surface.** Runtime dependencies today: `zod`, `yaml`, `jsonc-parser`, `@toon-format/toon`. Please open an issue before adding one.

## Development setup

Requirements: Node.js 20+ (22 recommended, see `.nvmrc`), npm. Ollama is optional (only for summarization experiments).

```bash
git clone https://github.com/shubhamcodess/mcp-token-optimizer.git
cd mcp-token-optimizer
npm install          # also builds (prepare script)
npm run typecheck    # tsc --noEmit
npm test             # unit + integration tests (node:test via tsx)
npm run smoke        # 24 end-to-end assertions against the fake MCP server
```

Handy commands:

```bash
npm run dev -- try examples/github-issues.json     # run the CLI from source (tsx), no build needed
npm run examples                                    # regenerate the synthetic sample data in examples/
npm run demo                                        # call a tool through the optimizer with the tiny test client
node --import tsx --test tests/pipeline.test.ts     # a single test file
```

Layout (see the README's *Development* section for the full map): `src/pipeline.ts` (the optimization pipeline), `src/session.ts` (JSON-RPC interceptor and `mto_expand`), `src/stdio.ts` and `src/http.ts` (transports), `src/installer.ts` (agent config discovery and editing), `src/prune.ts`, `src/summarize.ts`, `src/redact.ts`, `src/toon.ts`.

### Safety when testing installs

`mto init --apply` edits **the real MCP config files of every agent it finds** (VS Code, Claude, Cursor, …). `MTO_HOME` only isolates mto's own data, not those files. When you test installer code:

```bash
HOME=$(mktemp -d) node dist/cli.js init --no-builtin --file /tmp/my-copy.json --apply
```

`--no-builtin --file <copy>` restricts the command to the file you name, and a throw-away `HOME` is a second safety net. Tests that touch the installer must do the same (see `tests/discovery-cli.test.ts`). Never commit real config files, captures, audit logs or anything from `~/.mcp-token-optimizer/`.

## Making a change

1. **Fork** the repo and create a branch: `feat/short-name`, `fix/short-name` or `docs/short-name`.
2. **Write the test first** when you can. Bug fixes need a regression test.
3. Keep the change focused. Unrelated refactors belong in their own PR.
4. Run `npm run typecheck && npm test && npm run smoke`.
5. Update the docs that describe the behaviour you changed (README, `mto.config.example.yaml`, TESTING.md expected numbers).
6. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
7. Open a PR using the template.

**Commit messages:** short imperative subject (about 70 characters), then a body that explains *why*. [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) are welcome but not required.

**Code style:** TypeScript `strict`, ESM, 2-space indent (`.editorconfig`), no semicolon-less experiments. Comments explain *why*, not what. Prefer small pure functions that are easy to unit-test. User-facing text should be precise about what was and wasn't verified.

**Licensing:** by contributing you agree that your work is licensed under the project's [Apache-2.0 license](LICENSE) (inbound = outbound). No CLA.

## Common tasks

### Add a pruning rule or profile tweak

`src/prune.ts` holds the noise-key lists per profile. Add the key glob, then add a fixture and expectation to `tests/pipeline.test.ts` and, if a documented number changes, update the tables in the README (§6) and `TESTING.md` (§2). Be conservative: dropping a key the agent might need is worse than keeping it. Names of dropped keys are shown to the agent in the note, so choose keys whose absence is self-explanatory.

### Add a pipeline stage

Stages live in `src/pipeline.ts` (`compute`). A new stage must (a) be covered by the *never-bigger* guard, (b) leave contract results alone, (c) report itself in `stages`, and (d) say honestly whether it is lossy (`lossy = true` triggers original storage and a note). Add tests for the happy path and for the failure path (the stage throwing must fall back to the original).

### Add an agent target

`src/installer.ts` → `agentTargets()`. Add `{ agent, file, keyPath }` (leave `keyPath` as `"auto"` if the key differs by version). Add a fixture-based test to `tests/installer.test.ts` that shows wrap → unwrap restores the file (comments and formatting matter: agent configs are often JSONC). Please also mention in the PR whether you tested it against the real agent; the README's *verification status* is deliberately honest about which agents were run live.

### Add a secret pattern

`src/redact.ts` → `BUILTIN`. Patterns must be specific (few false positives), and the test must build the fake secret from fragments (e.g. `"gh" + "p_" + "x".repeat(36)`) so the repository never contains a token-shaped literal (it can block pushes through GitHub secret scanning).

### Add a config option

Add it to the zod schema in `src/config.ts` with a default and a doc comment, wire it in, then document it in the README's *Configuration reference* and `mto.config.example.yaml`, and add a test.

### Add a local model to the benchmarks

Follow [TESTING.md §5](TESTING.md#5-benchmarking-local-llms-on-your-data) and include the table it asks for. One synthetic document isn't proof, so results on more than one dataset are more useful.

## Pull request checklist

- [ ] `npm run typecheck`, `npm test` and `npm run smoke` pass locally
- [ ] Tests added or updated (regression test for bug fixes)
- [ ] Docs updated (README, `mto.config.example.yaml`, TESTING.md numbers if they changed)
- [ ] `CHANGELOG.md` updated under *Unreleased*
- [ ] No secrets, real captures, company data or personal paths in the diff (synthetic data only)
- [ ] The change respects the [project principles](#project-principles) (fail-open, never-bigger, honest about loss)
- [ ] For installer changes: tested only on copies of config files, never by running `--apply` against real ones

Reviews focus on correctness and safety first, then simplicity, then style. Expect questions like *"what happens if this throws?"* and *"what does the agent see?"*

## Sharing benchmark data

Real tool output can contain company data. Before you paste anything into an issue or PR:

- Prefer numbers (`mto stats`, `mto bench` tables) over content.
- If you need to share a sample, replace names, hosts, ids and values with synthetic ones that keep the *shape* (nested keys, repeated blocks, sizes).
- Never share `~/.mcp-token-optimizer/captures/`, `store/` or your audit log verbatim.
- Include your model, hardware (chip, RAM) and Ollama version when reporting LLM results.

## Releases (maintainers)

1. Update `CHANGELOG.md` (move *Unreleased* under the new version) and `version` in `package.json`.
2. `npm run typecheck && npm test && npm run smoke`.
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin main --tags`.
4. The **Release** workflow builds, tests and attaches an installable tarball (`npm pack`) to the GitHub release.

## Ideas for first contributions

Good places to start (open an issue to claim one):

- **More agents:** verify and document Claude Code, Cursor, Windsurf, Cline or Gemini CLI end to end; add missing config locations for Linux/Windows.
- **Windows support:** path handling in the installer, a service template for `mto serve`.
- **Legacy SSE transport** support in the HTTP proxy.
- **Summarize long strings inside JSON fields** (for example issue bodies), with the same fact-coverage guard.
- **Exact tokenizers:** optional plug-in token counters (tiktoken-style) instead of the built-in estimate.
- **More models and datasets** in the LLM benchmark tables.
- **A `mto service install`** command (launchd/systemd) so `mto serve` can start automatically.
- **Docs:** walkthrough videos or GIFs, translations, per-agent guides.

Questions? Open an issue titled `question: …`. We would rather answer it publicly so the next person benefits.
