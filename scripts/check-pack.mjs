#!/usr/bin/env node
// Fails if the npm tarball is missing something users need or contains something it should not.
//   node scripts/check-pack.mjs            (uses the current dist/, does not rebuild)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// `--from <file>` checks a saved `npm pack --json` listing instead (used by the tests)
const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : undefined;
let json;
if (from) json = readFileSync(from, "utf8");
else {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, npm_config_ignore_scripts: "true" } });
  if (r.status !== 0) (console.error(r.stderr || r.stdout), process.exit(2));
  json = r.stdout;
}
// some npm versions still run `prepack` for --dry-run and print its output first: take the trailing JSON array
const arr = /(?:^|\n)(\[\s*\{[\s\S]*\])\s*$/.exec(json)?.[1];
if (!arr) (console.error("could not read `npm pack --json` output:\n" + json.slice(0, 500)), process.exit(2));
const pack = JSON.parse(arr)[0];
const paths = pack.files.map((f) => f.path);
const has = (p) => paths.includes(p);
const under = (prefix) => paths.some((p) => p.startsWith(prefix));

const required = [
  ["dist/cli.js", has("dist/cli.js")],
  ["dist/ui/index.html (the dashboard)", has("dist/ui/index.html")],
  ["dist/ui/assets/*", under("dist/ui/assets/")],
  ["README.md", has("README.md")],
  ["LICENSE", has("LICENSE")],
  ["CHANGELOG.md", has("CHANGELOG.md")],
  ["package.json", has("package.json")],
  ["mto.config.example.yaml", has("mto.config.example.yaml")],
  ["examples/ (github-issues.json, build.log: `mto eval --examples` needs them)", has("examples/github-issues.json") && has("examples/build.log")],
];
const forbiddenPrefix = ["tests/", "site/", "ui/", "src/", ".github/", ".claude/", ".impeccable/", "node_modules/", "docs/"];
const forbiddenMatch = [/\.tgz$/, /\.map$/, /(^|\/)\.env/, /(^|\/)\.git(\/|$)/, /\.pem$/, /\.key$/, /(^|\/)id_rsa/];
const forbidden = paths.filter((p) => forbiddenPrefix.some((x) => p.startsWith(x)) || forbiddenMatch.some((re) => re.test(p)));

const KB = 1024;
const budgets = [
  ["tarball size", pack.size, 450 * KB],
  ["unpacked size", pack.unpackedSize, 1500 * KB],
];

let bad = 0;
console.log(`${pack.name}@${pack.version}: ${paths.length} files, ${(pack.size / KB).toFixed(0)} KB packed, ${(pack.unpackedSize / KB).toFixed(0)} KB unpacked`);
for (const [name, ok] of required) if (!ok) (console.log(`MISSING   ${name}`), bad++);
for (const p of forbidden) (console.log(`FORBIDDEN ${p}`), bad++);
for (const [name, size, max] of budgets) if (size > max) (console.log(`OVER      ${name}: ${(size / KB).toFixed(0)} KB > ${(max / KB).toFixed(0)} KB`), bad++);
if (!pack.name.startsWith("@") ) (console.log(`NAME      "${pack.name}" is not scoped; the unscoped name belongs to another project on npm`), bad++);
console.log(bad ? `FAIL (${bad})` : "OK");
process.exit(bad ? 1 : 0);
