#!/usr/bin/env node
// Verifies that every relative link and #anchor in the project's Markdown files resolves (GitHub slug rules).
// External URLs are not fetched (deterministic, offline).   Usage: node scripts/check-links.mjs
import { existsSync, readFileSync } from "node:fs";

const FILES = ["README.md", "TESTING.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md"];
const strip = (t) => t.replace(/```[\s\S]*?```/g, "");
const slug = (h) => h.toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
const anchorsOf = (t) => new Set([...strip(t).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));

let problems = 0;
for (const f of FILES) {
  const text = readFileSync(f, "utf8");
  const own = anchorsOf(text);
  for (const m of strip(text).matchAll(/\]\(([^)\s]+)\)/g)) {
    const url = m[1];
    if (/^(https?:|mailto:)/.test(url)) continue;
    const [file, hash] = url.split("#");
    if (file && !existsSync(file)) (console.log(`${f}: missing file ${url}`), problems++);
    else if (hash && !(file ? anchorsOf(readFileSync(file, "utf8")) : own).has(hash)) (console.log(`${f}: dead anchor ${url}`), problems++);
  }
}
console.log(problems ? `${problems} broken link(s)` : "all internal links and anchors resolve");
process.exit(problems ? 1 : 0);
