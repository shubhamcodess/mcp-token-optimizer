#!/usr/bin/env node
// Turns examples/ into a captures directory so `mto bench` can replay them (no live agent needed).
//   node scripts/examples-to-captures.mjs [outDir]      (default: ./examples-captures)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ex = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const out = resolve(process.argv[2] ?? "examples-captures");
mkdirSync(out, { recursive: true });
const t = (f) => ({ content: [{ type: "text", text: readFileSync(join(ex, f), "utf8") }] });
const rows = [
  ["list_issues", t("github-issues.json"), false],
  ["describe_configmap", t("k8s-configmap.json"), false],
  ["fetch_guide", t("deploy-guide.md"), false],
  ["build_log", t("build.log"), false],
  ["get_page", t("page.html"), false],
  ["read_file", t("source.ts"), false],
  ["get_rows", JSON.parse(readFileSync(join(ex, "structured-result.json"), "utf8")), true],
].map(([tool, result, hasOutputSchema]) => JSON.stringify({ ts: new Date().toISOString(), server: "demo", tool, hasOutputSchema, result }));
writeFileSync(join(out, "demo.jsonl"), rows.join("\n") + "\n");
console.log(`wrote ${rows.length} samples to ${out}/demo.jsonl`);
