import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Built dashboard assets (`vite build` writes them next to the compiled CLI). */
export const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "ui");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const isUiPath = (p: string) => p === "/" || p === "/index.html" || p === "/favicon.svg" || p === "/theme.js" || p.startsWith("/assets/");

export const uiBuilt = (dir = UI_DIR): boolean => existsSync(join(dir, "index.html"));

/** Serve one static dashboard file. Returns false if the path is not a dashboard path or the UI is not built. */
export function serveUi(pathname: string, res: ServerResponse, dir = UI_DIR): boolean {
  if (!isUiPath(pathname) || !uiBuilt(dir)) return false;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return false;
  }
  const root = resolve(dir);
  const file = resolve(root, "." + rel);
  // path traversal guard: the resolved file must stay inside the UI directory
  if (rel.includes("\0") || (file !== root && !file.startsWith(root + sep))) {
    res.writeHead(404).end();
    return true;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return true;
  }
  const type = MIME[extname(file)];
  if (!type) {
    res.writeHead(404).end();
    return true;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
  });
  res.end(readFileSync(file));
  return true;
}
