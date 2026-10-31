import { Audit } from "./audit.js";
import { statSync } from "node:fs";
import { findConfigPath, loadConfig, type Config } from "./config.js";
import { OllamaClient } from "./llm.js";
import { Pipeline } from "./pipeline.js";
import { Session } from "./session.js";
import { OriginalStore } from "./store.js";

export interface Runtime {
  config: Config;
  configPath?: string;
  pipeline: Pipeline;
  store: OriginalStore | null;
  audit: Audit;
  newSession(server: string): Session;
  warm(): Promise<void>;
  /** Re-read the config file and apply it to the live objects. An invalid file is reported and the old config stays. */
  reload(): { ok: boolean; error?: string };
  /** Poll the config file and reload on change (long-running processes only). Returns a stop function. */
  watch(onReload?: (r: { ok: boolean; error?: string }) => void, intervalMs?: number): () => void;
  reloadedAt?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Copy `src` into `target` keeping every nested object's identity, so components holding `config.llm` etc. see the change. */
export function applyInPlace(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(target[k])) applyInPlace(target[k] as Record<string, unknown>, v);
    else target[k] = v;
  }
}

export function createRuntime(configPath?: string): Runtime {
  const { config, path } = loadConfig(configPath);
  const store = config.retrieval.enabled ? new OriginalStore(config.retrieval.ttlMinutes * 60_000, config.retrieval.maxEntries) : null;
  store?.sweep();
  const llm = new OllamaClient(config.llm);
  const pipeline = new Pipeline(config, llm, store);
  const audit = new Audit(config.audit);
  const rt: Runtime = {
    config, configPath: path, pipeline, store, audit, newSession: (server) => new Session(server, config, pipeline, audit, store),
    warm: () => (config.summarize.enabled && config.mode !== "off" ? llm.warm() : Promise.resolve()),
    reload() {
      try {
        applyInPlace(config as unknown as Record<string, unknown>, loadConfig(configPath).config as unknown as Record<string, unknown>);
        rt.configPath = findConfigPath(configPath);
        rt.reloadedAt = new Date().toISOString();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    watch(onReload, intervalMs = 1500) {
      const sig = () => {
        try {
          const f = findConfigPath(configPath);
          return f ? `${f}:${statSync(f).mtimeMs}:${statSync(f).size}` : "";
        } catch {
          return "";
        }
      };
      let last = sig();
      const t = setInterval(() => {
        const now = sig();
        if (now === last) return;
        last = now;
        onReload?.(rt.reload());
      }, intervalMs);
      t.unref();
      return () => clearInterval(t);
    },
  };
  return rt;
}
