import type { Config } from "./config.js";
import { ollamaHealth } from "./llm.js";

export interface Check {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
}

/** Structured health checks, shared by `mto doctor` and the dashboard. */
export async function runDoctor(config: Config, configPath?: string): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [
    { id: "config", ok: true, label: `config: ${configPath ?? "(defaults, no config file found)"}`, detail: `mode=${config.mode} profile=${config.profile} redaction=${config.redaction.mode} retrieval=${config.retrieval.enabled}` },
  ];
  const h = await ollamaHealth(config.llm);
  if (!h.ok) checks.push({ id: "ollama", ok: false, label: `ollama unreachable at ${config.llm.baseUrl} (${h.error}). Summarization will be skipped; pruning + TOON still work.` });
  else if (!h.hasModel) checks.push({ id: "ollama", ok: false, label: `ollama is up but model "${config.llm.model}" is not pulled. Run: ollama pull ${config.llm.model}`, detail: `available: ${h.models.join(", ") || "(none)"}` });
  else checks.push({ id: "ollama", ok: true, label: `ollama ${config.llm.baseUrl} model ${config.llm.model} ready` });
  return { ok: checks.every((c) => c.ok), checks };
}
