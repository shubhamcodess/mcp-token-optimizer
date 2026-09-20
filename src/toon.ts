/**
 * TOON via the official `@toon-format/toon` package (spec v4.1.1). We deliberately do not maintain our own
 * encoder: the pipeline only emits TOON after the official strict decoder reproduces the input exactly.
 */
import { decode, encode } from "@toon-format/toon";

export const toToon = (v: unknown): string => encode(v);
export const fromToon = (s: string): unknown => decode(s, { strict: true });

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b || (a === 0 && b === 0);
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as never)[k], (b as never)[k]));
}
