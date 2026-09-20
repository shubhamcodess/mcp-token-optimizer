/** Deterministic, lossless-in-meaning text cleanup + content sniffing. No LLM involved. */

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function normalizeText(input: string): string {
  let s = input.replace(ANSI, "").replace(/\r\n?/g, "\n");
  s = s.replace(/[ \t]+$/gm, "");
  // long base64-ish runs inside prose (not JSON-string blobs, handled in prune)
  s = s.replace(/[A-Za-z0-9+/]{300,}={0,2}/g, (m) => `[base64 omitted: ${m.length} chars]`);
  s = collapseRepeatedLines(s);
  s = dedupeParagraphs(s);
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** `line` repeated N>2 times consecutively -> `line (×N)`. Progress-bar / log-spam killer. */
function collapseRepeatedLines(s: string): string {
  const lines = s.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    if (n > 2 && lines[i].trim() !== "") out.push(`${lines[i]} (×${n})`);
    else for (let k = i; k < j; k++) out.push(lines[k]);
    i = j;
  }
  return out.join("\n");
}

export function looksLikeHtml(s: string): boolean {
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(s) || (/<\/(?:div|p|span|body|head)>/i.test(s) && (s.match(/<[a-z][^>]*>/gi)?.length ?? 0) > 20);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, txt: string) => {
      const t = txt.replace(/<[^>]+>/g, "").trim();
      return t ? `[${t}](${href})` : "";
    })
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Heuristic: is this source code / a diff / structured config that must never be paraphrased? */
export function looksLikeCodeOrDiff(s: string): boolean {
  if (/^(?:diff --git|--- a\/|\+\+\+ b\/|@@ -\d)/m.test(s)) return true;
  const lines = s.split("\n").filter((l) => l.trim());
  if (lines.length < 5) return false;
  const codey = lines.filter((l) => /[;{}]\s*$|^\s*(?:import|from|def|class|function|const|let|var|return|export|package|#include|public|private)\b|=>|^\s*[@#]\w+/.test(l)).length;
  const indented = lines.filter((l) => /^(?:\t|\s{2,})\S/.test(l)).length;
  return codey / lines.length > 0.25 || (codey / lines.length > 0.12 && indented / lines.length > 0.5);
}

export function splitFencedCode(s: string): { prose: string; blocks: string[] } {
  const blocks: string[] = [];
  const prose = s.replace(/```[\s\S]*?```/g, (m) => {
    blocks.push(m);
    return `⟦CODE${blocks.length - 1}⟧`;
  });
  return { prose, blocks };
}

export function restoreFencedCode(s: string, blocks: string[]): string {
  let out = s;
  blocks.forEach((b, i) => {
    const ph = `⟦CODE${i}⟧`;
    out = out.includes(ph) ? out.replace(ph, b) : `${out}\n\n${b}`;
  });
  return out;
}

/**
 * Facts an agent may act on and that must survive any paraphrase: paths, URLs, ids, hashes, numbers with
 * units, versions, error codes, quoted/backticked identifiers, ALL_CAPS constants.
 */
export function criticalTokens(s: string): string[] {
  const set = new Set<string>();
  const add = (re: RegExp, min = 3) => {
    for (const m of s.matchAll(re)) if (m[0].length >= min) set.add(m[0]);
  };
  add(/https?:\/\/[^\s)>\]"']+/g);
  add(/(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w{1,8}\b/g);
  add(/`[^`\n]{2,80}`/g);
  add(/\b[0-9a-f]{7,40}\b/g, 7);
  add(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
  add(/\bv?\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/g);
  add(/\b[A-Z][A-Z0-9_]{3,}\b/g);
  add(/\b(?:E[A-Z]{3,}|ERR_[A-Z_]+|HTTP\s?\d{3}|\d{3}\s(?:Not|Bad|Internal|Forbidden|Unauthorized))\b/g);
  add(/\b\d{4,}(?:\.\d+)?\b/g, 4);
  add(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g, 5); // camelCase identifiers
  add(/\b[a-z0-9]+(?:_[a-z0-9]+){1,}\b/g, 5); // snake_case identifiers
  return [...set];
}

/** Exact-duplicate paragraphs (>= 12 words) keep their first occurrence and gain a `(repeated N×)` note. */
function dedupeParagraphs(s: string): string {
  const paras = s.split(/\n{2,}/);
  const key = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const p of paras) if (p.split(/\s+/).length >= 12) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  if (![...counts.values()].some((n) => n > 1)) return s;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paras) {
    const k = key(p);
    const n = counts.get(k) ?? 0;
    if (n > 1) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(`${p} (repeated ${n}×)`);
    } else out.push(p);
  }
  return dropOrphanHeadings(out).join("\n\n");
}

/** A heading that already appeared verbatim and is now followed by another heading (or nothing) lost its body to dedupe. */
function dropOrphanHeadings(paras: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const isHeading = (p: string) => /^#{1,6}\s/.test(p) && !p.includes("\n");
  paras.forEach((p, i) => {
    if (isHeading(p)) {
      const next = paras[i + 1];
      const orphan = next === undefined || isHeading(next);
      if (seen.has(p) && orphan) return;
      seen.add(p);
    }
    out.push(p);
  });
  return out;
}

