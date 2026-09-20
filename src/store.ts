import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_DIR } from "./config.js";

/**
 * Disk-backed store of ORIGINAL tool outputs whenever an optimization was lossy. Shared across every wrapper
 * process (content-addressed), so the agent can always recover exact data through `mto_expand`.
 */
export class OriginalStore {
  constructor(
    private ttlMs: number,
    private maxEntries: number,
    private dir = join(HOME_DIR, "store"),
  ) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  put(text: string): string {
    const id = createHash("sha256").update(text).digest("hex").slice(0, 12);
    const file = join(this.dir, `${id}.txt`);
    if (!existsSync(file)) writeFileSync(file, text, { mode: 0o600 });
    return id;
  }

  get(id: string): string | undefined {
    if (!/^[0-9a-f]{12}$/.test(id)) return undefined;
    const file = join(this.dir, `${id}.txt`);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  sweep(): void {
    try {
      const now = Date.now();
      const files = readdirSync(this.dir).filter((f) => f.endsWith(".txt")).map((f) => ({ f, m: statSync(join(this.dir, f)).mtimeMs }));
      files.sort((a, b) => b.m - a.m);
      files.forEach(({ f, m }, i) => {
        if (now - m > this.ttlMs || i >= this.maxEntries) unlinkSync(join(this.dir, f));
      });
    } catch {
      /* best effort */
    }
  }
}
