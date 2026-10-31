import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const run = (args: string[] = []) => spawnSync(process.execPath, ["scripts/check-pack.mjs", ...args], { encoding: "utf8" });
const GOOD = ["dist/cli.js", "dist/ui/index.html", "dist/ui/assets/a.js", "README.md", "LICENSE", "CHANGELOG.md", "package.json", "mto.config.example.yaml", "examples/github-issues.json", "examples/build.log"];
const listing = (paths: string[], extra: object = {}) => {
  const f = join(mkdtempSync(join(tmpdir(), "mto-pack-")), "pack.json");
  writeFileSync(f, JSON.stringify([{ name: "@shubhamcodess/mcp-token-optimizer", version: "9.9.9", size: 200_000, unpackedSize: 600_000, files: paths.map((path) => ({ path })), ...extra }]));
  return f;
};

test("pack check: the real tarball passes (scoped name, dashboard shipped, nothing forbidden)", () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /@shubhamcodess\/mcp-token-optimizer@/);
});

test("pack check: fails on a missing required file, a forbidden path, an oversized tarball and an unscoped name", () => {
  assert.equal(run(["--from", listing(GOOD)]).status, 0);
  const missing = run(["--from", listing(GOOD.filter((p) => p !== "dist/ui/index.html"))]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /MISSING.*dashboard/);
  for (const bad of ["tests/x.test.ts", "site/index.html", ".env", "dist/cli.js.map", "src/cli.ts", "shubhamcodess-mcp-token-optimizer-0.2.0.tgz", ".claude/settings.json"]) {
    const r = run(["--from", listing([...GOOD, bad])]);
    assert.equal(r.status, 1, bad);
    assert.match(r.stdout, new RegExp(`FORBIDDEN ${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.match(run(["--from", listing(GOOD, { size: 900_000 })]).stdout, /OVER\s+tarball size/);
  assert.match(run(["--from", listing(GOOD, { name: "mcp-token-optimizer" })]).stdout, /not scoped/);
});
