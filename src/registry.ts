import { randomUUID } from "node:crypto";
import type { AuditRow } from "./audit.js";

export interface ProxyEntry {
  id: string;
  kind: "stdio" | "http";
  server: string;
  client?: string;
  pid?: number;
  startedAt: string;
  lastSeen: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

const HEARTBEAT_TTL_MS = 30_000;
/** HTTP clients may idle for long stretches between requests, so their entries live longer. */
const HTTP_TTL_MS = 5 * 60_000;

/** Which proxies/wrappers are connected right now. In-memory, owned by the daemon; entries expire without a heartbeat. */
export class Registry {
  private entries = new Map<string, ProxyEntry>();

  register(e: { kind: "stdio" | "http"; server: string; client?: string; pid?: number; id?: string }): string {
    const id = e.id ?? randomUUID().slice(0, 8);
    const prev = this.entries.get(id);
    this.entries.set(id, { calls: 0, tokensIn: 0, tokensOut: 0, ...prev, id, kind: e.kind, server: e.server, client: e.client, pid: e.pid, startedAt: prev?.startedAt ?? new Date().toISOString(), lastSeen: Date.now() });
    return id;
  }

  heartbeat(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.lastSeen = Date.now();
    return true;
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  count(id: string | undefined, row: Pick<AuditRow, "tokensIn" | "tokensOut">): void {
    const e = id ? this.entries.get(id) : undefined;
    if (!e) return;
    e.calls++;
    e.tokensIn += row.tokensIn;
    e.tokensOut += row.tokensOut;
    e.lastSeen = Date.now();
  }

  list(): ProxyEntry[] {
    const now = Date.now();
    for (const [id, e] of this.entries) if (now - e.lastSeen > (e.kind === "http" ? HTTP_TTL_MS : HEARTBEAT_TTL_MS)) this.entries.delete(id);
    return [...this.entries.values()];
  }
}
