import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME_DIR } from "./config.js";

/** name -> upstream MCP URL. The proxy only forwards to routes listed here (no open-proxy / SSRF surface). */
export type Routes = Record<string, { url: string }>;
export const ROUTES_FILE = join(HOME_DIR, "routes.json");
export const DEFAULT_PORT = 8787;

export function loadRoutes(file = ROUTES_FILE): Routes {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Routes) : {};
  } catch {
    return {};
  }
}

export function saveRoutes(routes: Routes, file = ROUTES_FILE): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(routes, null, 2) + "\n", { mode: 0o600 });
}
