import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_DIR } from "./config.js";
import type { RedactResult } from "./redact.js";

/**
 * Opt-in local recording of RAW tool results so they can be replayed offline (`mto bench`) and shared for tuning.
 * Toggle live with `mto capture on|off` (a flag file, so running agents pick it up without a restart).
 * Secrets are always redacted before anything is written. Files never leave the machine on their own.
 */
export const CAPTURE_DIR = join(HOME_DIR, "captures");
const FLAG = join(HOME_DIR, "capture.on");

export const captureEnabled = (): boolean => existsSync(FLAG);

export function setCapture(on: boolean): void {
  mkdirSync(HOME_DIR, { recursive: true });
  if (on) writeFileSync(FLAG, new Date().toISOString());
  else if (existsSync(FLAG)) unlinkSync(FLAG);
}

export interface Sample {
  ts: string;
  server: string;
  tool: string;
  hasOutputSchema: boolean;
  result: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
  /** What the agent actually received (active mode only). */
  optimized?: { content?: { type: string; text?: string }[] };
}

export function writeCapture(server: string, tool: string, hasOutputSchema: boolean, result: any, redact: (t: string) => RedactResult, optimized?: any): void {
  try {
    mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
    const scrub = (r: any) => ({ ...r, content: Array.isArray(r?.content) ? r.content.map((c: any) => (typeof c?.text === "string" ? { ...c, text: redact(c.text).text } : c)) : r?.content });
    const row: Sample = { ts: new Date().toISOString(), server, tool, hasOutputSchema, result: scrub(result), ...(optimized ? { optimized: { content: scrub(optimized).content } } : {}) };
    appendFileSync(join(CAPTURE_DIR, `${server.replace(/[^\w.-]/g, "_")}.jsonl`), JSON.stringify(row) + "\n", { mode: 0o600 });
  } catch {
    /* capture must never break the agent */
  }
}

export function readCaptures(dir = CAPTURE_DIR): Sample[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Sample]; } catch { return []; } }));
}
