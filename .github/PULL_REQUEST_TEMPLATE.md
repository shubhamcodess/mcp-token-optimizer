## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## How I tested it

<!-- Commands you ran, and what you saw. Paste `mto stats`/`bench` numbers rather than tool content. -->

## Checklist

- [ ] `npm run typecheck`, `npm test` and `npm run smoke` pass locally
- [ ] Tests added or updated (regression test for bug fixes)
- [ ] Docs updated (README, `mto.config.example.yaml`, TESTING.md numbers if they changed)
- [ ] `CHANGELOG.md` updated under *Unreleased*
- [ ] No secrets, real captures, company data or personal paths in the diff
- [ ] Respects the project principles: fail-open, never-bigger, honest about what is lost
- [ ] Installer changes were tested only on copies of config files (`--no-builtin --file`), never `--apply` on real ones
