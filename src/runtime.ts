import { Audit } from "./audit.js";
import { loadConfig, type Config } from "./config.js";
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
}

export function createRuntime(configPath?: string): Runtime {
  const { config, path } = loadConfig(configPath);
  const store = config.retrieval.enabled ? new OriginalStore(config.retrieval.ttlMinutes * 60_000, config.retrieval.maxEntries) : null;
  store?.sweep();
  const llm = new OllamaClient(config.llm);
  const pipeline = new Pipeline(config, llm, store);
  const audit = new Audit(config.audit);
  return { config, configPath: path, pipeline, store, audit, newSession: (server) => new Session(server, config, pipeline, audit, store),
    warm: () => (config.summarize.enabled && config.mode !== "off" ? llm.warm() : Promise.resolve()),
  };
}
