#!/usr/bin/env node
// Byte-level ground-truth check: is a file the agent produced IDENTICAL to a value inside the ORIGINAL tool result
// that the proxy captured before optimizing?  (Needs `mto capture on` while the agent ran.)
//   node scripts/fidelity.mjs --tool kube_get_resource_details --path '$.manifest.data["app.properties"]' --file ./app.properties
//   Optional: --dir <captures dir> (default ~/.mcp-token-optimizer/captures) · --which last|N (default last)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readCaptures } = require("../dist/capture.js");
const argv = process.argv.slice(2);
const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const { tool, path: jpath, file } = { tool: flag("--tool"), path: flag("--path"), file: flag("--file") };
if (!tool || !file) {
  console.error("usage: node scripts/fidelity.mjs --tool <tool> [--path <JSONPath into the original>] --file <file> [--dir <captures dir>] [--which last|N]");
  process.exit(2);
}
const samples = readCaptures(flag("--dir")).filter((s) => s.tool === tool);
if (!samples.length) (console.error(`no captured samples for tool "${tool}"`), process.exit(2));
const s = flag("--which") && flag("--which") !== "last" ? samples[Number(flag("--which"))] : samples[samples.length - 1];
let value = (s.result.content ?? []).map((c) => c.text ?? "").join("\n");
if (jpath) {
  let cur = JSON.parse(value);
  for (const m of jpath.replace(/^\$/, "").matchAll(/\.([A-Za-z_][\w-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g)) {
    const k = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(`"${m[3]}"`));
    if (cur === null || typeof cur !== "object" || !(k in cur)) (console.error(`path not found in original: ${jpath}`), process.exit(2));
    cur = cur[k];
  }
  value = typeof cur === "string" ? cur : JSON.stringify(cur);
}
const got = readFileSync(file, "utf8");
const md5 = (t) => createHash("md5").update(t).digest("hex").slice(0, 8);
const same = got === value;
console.log(`${same ? "IDENTICAL" : "DIFFERENT"}  original=${value.length}B md5:${md5(value)}   file=${got.length}B md5:${md5(got)}   (sample ${s.ts})`);
if (!same) {
  const i = [...value].findIndex((c, k) => c !== got[k]);
  console.log(`first difference at byte ${i < 0 ? Math.min(value.length, got.length) : i}${got.replace(/\r/g, "").trim() === value.replace(/\r/g, "").trim() ? " (whitespace/newline only)" : ""}`);
}
process.exit(same ? 0 : 1);
