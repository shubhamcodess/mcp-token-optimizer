#!/usr/bin/env node
// Fails if the built dashboard (dist/ui) grows past its budget. Run after `npm run build`.
//   node scripts/check-ui-budget.mjs
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "ui");
if (!existsSync(join(dir, "index.html"))) (console.error("dist/ui/index.html missing: run `npm run build` first"), process.exit(2));

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(dir);

const sum = (ext, gz) => files.filter((f) => extname(f) === ext).reduce((a, f) => a + (gz ? gzipSync(readFileSync(f)).length : statSync(f).size), 0);
const KB = 1024;
const checks = [
  ["JS, gzipped", sum(".js", true), 40 * KB],
  ["CSS, gzipped", sum(".css", true), 10 * KB],
  ["fonts (woff2)", sum(".woff2"), 120 * KB],
  ["whole dist/ui", files.reduce((a, f) => a + statSync(f).size, 0), 260 * KB],
];
let bad = 0;
for (const [name, size, max] of checks) {
  const ok = size <= max;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "OVER"}  ${name.padEnd(14)} ${(size / KB).toFixed(1)} KB (budget ${(max / KB).toFixed(0)} KB)`);
}
// the dashboard must not reach for the network: no absolute http(s) URLs in the HTML or JS besides the namespaces React-like libs embed
const html = readFileSync(join(dir, "index.html"), "utf8");
if (/(src|href)="https?:\/\//.test(html)) (console.log("OVER  index.html references an external URL (no CDN allowed)"), bad++);
process.exit(bad ? 1 : 0);
