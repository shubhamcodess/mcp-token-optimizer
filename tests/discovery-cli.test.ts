import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// HOME is redirected to a temp dir so that even a bug here can never touch the developer's real agent configs.
function run(home: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env: { ...process.env, HOME: home, MTO_HOME: join(home, ".mto") }, encoding: "utf8" });
}

test("--no-builtin touches ONLY the named file; repeated --skip works; builtin lists are ignored", () => {
  const home = mkdtempSync(join(tmpdir(), "mto-home-"));
  // a "real" agent config in the fake HOME that must stay untouched
  mkdirSync(join(home, "Library/Application Support/Code/User"), { recursive: true });
  const real = join(home, "Library/Application Support/Code/User/mcp.json");
  const realText = '{ "servers": { "precious": { "command": "npx", "args": ["x"] } } }\n';
  writeFileSync(real, realText);
  writeFileSync(join(home, ".claude.json"), '{ "mcpServers": { "c": { "command": "y" } } }\n');
  const mine = join(home, "mine.json");
  writeFileSync(mine, '{ "servers": { "s1": { "command": "npx", "args": ["a"] } } }\n');

  const dry = run(home, ["init", "--no-builtin", "--file", mine]);
  assert.match(dry.stdout, /s1/);
  assert.doesNotMatch(dry.stdout, /precious/, "built-in locations must not be listed with --no-builtin");

  const applied = run(home, ["init", "--no-builtin", "--file", mine, "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(real, "utf8"), realText, "real agent config is byte-identical");
  assert.match(readFileSync(mine, "utf8"), /"wrap"/);
  assert.ok(!existsSync(real + ".mto.bak"));

  // repeated --skip flags: every one is honoured
  const skipped = run(home, ["discover", "--file", mine, "--skip", "code", "--skip", "claude"]);
  assert.doesNotMatch(skipped.stdout, /precious/);
  assert.doesNotMatch(skipped.stdout, /Claude Code/);
  const un = run(home, ["uninstall", "--no-builtin", "--file", mine, "--apply"]);
  assert.equal(un.status, 0);
  assert.doesNotMatch(readFileSync(mine, "utf8"), /"wrap"/);
});
