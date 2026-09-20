import type { Config } from "./config.js";
import { globToRegex } from "./config.js";

export interface PruneOptions {
  dropNull: boolean;
  dropEmpty: boolean;
  dropKeys: RegExp[];
  keepKeys: RegExp[];
  maxArrayItems: number; // 0 = unlimited
  stripBlobsOverBytes: number; // 0 = off
  dropUriTemplates: boolean;
}

export interface PruneStats {
  droppedKeys: number;
  droppedEmpty: number;
  truncatedArrays: number;
  strippedBlobs: number;
  /** dropped named keys -> occurrences (lets the note tell the agent exactly what is gone). */
  droppedKeyNames: Record<string, number>;
  /** true when data the agent could plausibly want was removed (arrays truncated, blobs stripped). */
  lossy: boolean;
}

/** Hypermedia / bookkeeping noise that never helps an agent reason. Case-insensitive globs on key names. */
const NOISE_BALANCED = [
  "_links", "_embedded", "_meta", "node_id", "gravatar_id", "etag", "x-ratelimit-*",
  "*_url_template", "followers_url", "following_url", "gists_url", "starred_url", "subscriptions_url",
  "organizations_url", "repos_url", "events_url", "received_events_url", "avatar_url", "*_avatar_url",
  "site_admin", "user_view_type",
];
/** Extra keys dropped only under `aggressive`. */
const NOISE_AGGRESSIVE = ["*_url", "*Url", "*_at_ms", "__typename", "cursor", "*_count_url"];
/** Never dropped, even when a noise glob matches. */
const ALWAYS_KEEP = ["html_url", "url", "clone_url", "ssh_url", "web_url", "permalink", "href", "uri"];

const URI_TEMPLATE = /^https?:\/\/\S*\{[/?#&+]?[^}]+\}/;

export function buildPruneOptions(cfg: Config, extra?: { dropKeys?: string[]; keepKeys?: string[]; maxArrayItems?: number }): PruneOptions {
  const p = cfg.profile;
  const drop = [...(p === "conservative" ? ["_links", "_embedded"] : NOISE_BALANCED), ...(p === "aggressive" ? NOISE_AGGRESSIVE : []), ...cfg.prune.dropKeys, ...(extra?.dropKeys ?? [])];
  return {
    dropNull: cfg.prune.dropNull ?? true,
    dropEmpty: cfg.prune.dropEmpty ?? true,
    dropKeys: drop.map(globToRegex),
    keepKeys: [...ALWAYS_KEEP, ...cfg.prune.keepKeys, ...(extra?.keepKeys ?? [])].map(globToRegex),
    maxArrayItems: extra?.maxArrayItems ?? cfg.prune.maxArrayItems ?? (p === "aggressive" ? 200 : 0),
    stripBlobsOverBytes: cfg.prune.stripBlobsOverBytes ?? (p === "conservative" ? 0 : 4096),
    dropUriTemplates: p !== "conservative",
  };
}

const isEmpty = (v: unknown) =>
  v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

export function prune(value: unknown, o: PruneOptions): { value: unknown; stats: PruneStats } {
  const stats: PruneStats = { droppedKeys: 0, droppedEmpty: 0, truncatedArrays: 0, strippedBlobs: 0, droppedKeyNames: {}, lossy: false };

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (o.stripBlobsOverBytes && v.length > o.stripBlobsOverBytes && /^(?:data:[\w/+.-]+;base64,)?[A-Za-z0-9+/=\s]{2000,}$/.test(v)) {
        stats.strippedBlobs++;
        stats.lossy = true;
        return `[binary/base64 omitted: ${v.length} chars]`;
      }
      return v;
    }
    if (Array.isArray(v)) {
      let arr = v;
      if (o.maxArrayItems && arr.length > o.maxArrayItems) {
        stats.truncatedArrays++;
        stats.lossy = true;
        const extra = arr.length - o.maxArrayItems;
        arr = [...arr.slice(0, o.maxArrayItems), `[+${extra} more items omitted]`];
      }
      const out = arr.map(walk);
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
        const keep = o.keepKeys.some((r) => r.test(k));
        if (!keep && o.dropKeys.some((r) => r.test(k))) {
          stats.droppedKeys++;
          stats.droppedKeyNames[k] = (stats.droppedKeyNames[k] ?? 0) + 1;
          continue;
        }
        if (!keep && o.dropUriTemplates && typeof raw === "string" && URI_TEMPLATE.test(raw)) {
          stats.droppedKeys++;
          stats.droppedKeyNames[k] = (stats.droppedKeyNames[k] ?? 0) + 1;
          continue;
        }
        const child = walk(raw);
        if (o.dropNull && child === null) {
          stats.droppedEmpty++;
          continue;
        }
        if (o.dropEmpty && isEmpty(child)) {
          stats.droppedEmpty++;
          continue;
        }
        out[k] = child;
      }
      return out;
    }
    return v;
  };

  return { value: walk(value), stats };
}

// ───────────── cross-field dedupe ─────────────

type Key = string | number;
interface Leaf { path: Key[]; parent: any; key: Key; lines: string[]; depth: number; order: number }

const pathStr = (p: Key[]) => p.reduce<string>((a, k) => (typeof k === "number" ? `${a}[${k}]` : /^[A-Za-z_]\w*$/.test(k) ? `${a}.${k}` : `${a}[${JSON.stringify(k)}]`), "$");

/**
 * Tool results often carry the same content twice (e.g. a `describe` text that echoes the raw manifest).
 * Long runs of lines that appear verbatim in another, more specific (deeper) string field are replaced with a
 * pointer to where that content lives. Nothing is lost: the canonical copy stays intact in the document.
 */
export function dedupeAcrossFields(root: unknown, o: { minRunLines?: number; minLeafLines?: number } = {}): { value: unknown; omittedLines: number; runs: number } {
  const minRun = o.minRunLines ?? 5;
  const minLines = o.minLeafLines ?? 8;
  const value = structuredClone(root);
  const leaves: Leaf[] = [];
  const walk = (node: any, path: Key[]) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      const key: Key = Array.isArray(node) ? Number(k) : k;
      if (typeof v === "string" && v.includes("\n") && v.split("\n").length >= minLines) leaves.push({ path: [...path, key], parent: node, key, lines: v.split("\n"), depth: path.length + 1, order: leaves.length });
      else walk(v, [...path, key]);
    }
  };
  walk(value, []);
  if (leaves.length < 2) return { value, omittedLines: 0, runs: 0 };

  // canonical priority: deeper path wins, then earlier in the document
  const rank = [...leaves].sort((a, b) => b.depth - a.depth || a.order - b.order);
  const prio = new Map(rank.map((l, i) => [l, i]));
  const substantive = (l: string) => l.trim().length > 12;
  const sets = new Map(leaves.map((l) => [l, new Set(l.lines.filter(substantive).map((x) => x.trim()))]));

  let omittedLines = 0;
  let runs = 0;
  for (const leaf of leaves) {
    // ascending priority: the first match is the top-most copy, so pointers never chain through another pointer
    const canon = leaves.filter((c) => prio.get(c)! < prio.get(leaf)!).sort((a, b) => prio.get(a)! - prio.get(b)!);
    if (!canon.length) continue;
    const out: string[] = [];
    for (let i = 0; i < leaf.lines.length; ) {
      const first = leaf.lines[i];
      const c = substantive(first) ? canon.find((x) => sets.get(x)!.has(first.trim())) : undefined;
      if (!c) {
        out.push(first);
        i++;
        continue;
      }
      let j = i;
      let subst = 0;
      let lastSubst = i;
      while (j < leaf.lines.length) {
        const l = leaf.lines[j];
        if (substantive(l)) {
          if (!sets.get(c)!.has(l.trim())) break;
          subst++;
          lastSubst = j;
        }
        j++;
      }
      if (subst >= minRun) {
        out.push(`[… ${lastSubst - i + 1} lines identical to ${pathStr(c.path)} omitted …]`);
        omittedLines += lastSubst - i + 1;
        runs++;
        i = lastSubst + 1;
      } else {
        out.push(first);
        i++;
      }
    }
    if (out.length !== leaf.lines.length) leaf.parent[leaf.key] = out.join("\n");
  }
  return { value, omittedLines, runs };
}
