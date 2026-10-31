import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigSchema } from "../src/config.js";
import { getConfigValue, setConfigValue, splitKey } from "../src/configEdit.js";
import { COMMANDS, commandHelp, docsHelp, helpFor, suggest } from "../src/help.js";

test("help: every command has help and appears in the overview", () => {
  const overview = helpFor().text;
  for (const c of COMMANDS) {
    assert.ok(commandHelp(c.name)?.includes(`mto ${c.name}`), c.name);
    assert.ok(overview.includes(c.name), c.name);
  }
});

test("help: did-you-mean, topics, unknown", () => {
  assert.equal(suggest("serv"), "serve");
  assert.equal(suggest("staus"), "status");
  assert.equal(suggest("zzzzzz"), undefined);
  assert.equal(helpFor("modes").code, 0);
  const bad = helpFor("serv");
  assert.equal(bad.code, 2);
  assert.match(bad.text, /Did you mean "serve"/);
});

test("docs: sections resolve to README anchors", () => {
  assert.match(docsHelp("modes").url ?? "", /#4-operating-modes/);
  assert.equal(docsHelp("nope").code, 2);
  assert.ok(docsHelp().text.includes("troubleshooting"));
});

test("config get/set: dotted and quoted keys, validation, comments preserved", () => {
  const file = join(mkdtempSync(join(tmpdir(), "mto-cfg-")), "config.yaml");
  writeFileSync(file, "# my note\nmode: active   # keep this\nsummarize:\n  enabled: true\n");
  assert.deepEqual(splitKey('tools."github.list_*".maxArrayItems'), ["tools", "github.list_*", "maxArrayItems"]);

  assert.equal(setConfigValue(file, "summarize.enabled", "false").ok, true);
  assert.equal(setConfigValue(file, "mode", "shadow").ok, true);
  assert.equal(setConfigValue(file, "prune.dropKeys", "[a_*, b_*]").ok, true);
  assert.equal(setConfigValue(file, 'tools."github.list_*".maxArrayItems', "100").ok, true);
  const text = readFileSync(file, "utf8");
  assert.match(text, /# my note/);
  assert.match(text, /# keep this/);

  const cfg = ConfigSchema.parse(JSON.parse(JSON.stringify(require_yaml(text))));
  assert.equal(cfg.mode, "shadow");
  assert.equal(cfg.summarize.enabled, false);
  assert.deepEqual(cfg.prune.dropKeys, ["a_*", "b_*"]);
  assert.equal(cfg.tools["github.list_*"].maxArrayItems, 100);
  assert.equal(getConfigValue(cfg, "summarize.enabled"), false);
  assert.equal(getConfigValue(cfg, "nope.x"), undefined);
});

test("config set: bad values and unknown keys are rejected and nothing is written", () => {
  const file = join(mkdtempSync(join(tmpdir(), "mto-cfg-")), "config.yaml");
  writeFileSync(file, "mode: active\n");
  for (const [k, v] of [["mode", "banana"], ["modee", "shadow"], ["summarize.enabld", "true"], ["skipBelowTokens", "-5"]] as const) {
    const r = setConfigValue(file, k, v);
    assert.equal(r.ok, false, `${k}=${v}`);
  }
  assert.equal(readFileSync(file, "utf8"), "mode: active\n");
  // creates the file when missing
  const fresh = join(mkdtempSync(join(tmpdir(), "mto-cfg-")), "sub", "config.yaml");
  assert.equal(setConfigValue(fresh, "profile", "aggressive").ok, true);
  assert.match(readFileSync(fresh, "utf8"), /profile: aggressive/);
});

import { parse } from "yaml";
const require_yaml = (t: string) => parse(t);
