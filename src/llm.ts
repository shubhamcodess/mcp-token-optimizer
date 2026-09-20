import type { Config } from "./config.js";

export interface CompleteOpts {
  timeoutMs?: number;
  /** Cap on generated tokens for this call (merged over configured options). */
  numPredict?: number;
}

export interface Completion {
  text: string;
  /** true when generation stopped at the token cap: the text is incomplete and must not be trusted. */
  truncated: boolean;
  /** Generation speed reported by the server (excludes model-load and prompt time), when available. */
  tokensPerSec?: number;
}

export interface LlmClient {
  complete(system: string, user: string, opts?: CompleteOpts): Promise<Completion>;
  /** false while the circuit breaker is open. */
  available(): boolean;
  /** Load the model into memory ahead of the first real request. Never throws. */
  warm?(): Promise<void>;
}

/**
 * Thin Ollama client with a circuit breaker: after repeated failures the optimizer stops calling the LLM
 * for a cool-down window, so a stopped/slow Ollama never adds latency to the agent's tool calls.
 */
export class OllamaClient implements LlmClient {
  private failures = 0;
  private openUntil = 0;
  constructor(private cfg: Config["llm"], private fetchImpl: typeof fetch = fetch) {}

  available(): boolean {
    return Date.now() >= this.openUntil;
  }

  async warm(): Promise<void> {
    try {
      await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ model: this.cfg.model, prompt: "", keep_alive: this.cfg.keepAlive, stream: false }),
      });
    } catch {
      /* Ollama down: summarization will simply be skipped */
    }
  }

  async complete(system: string, user: string, opts: CompleteOpts = {}): Promise<Completion> {
    if (!this.available()) throw new Error("ollama circuit open");
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? this.cfg.timeoutMs, this.cfg.timeoutMs)),
        body: JSON.stringify({
          model: this.cfg.model,
          stream: false,
          think: this.cfg.think,
          keep_alive: this.cfg.keepAlive,
          options: opts.numPredict ? { ...this.cfg.options, num_predict: Math.min(opts.numPredict, Number((this.cfg.options as any).num_predict ?? Infinity)) } : this.cfg.options,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { message?: { content?: string }; done_reason?: string; eval_count?: number; eval_duration?: number };
      const out = (data.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      this.failures = 0;
      const tokensPerSec = data.eval_count && data.eval_duration ? data.eval_count / (data.eval_duration / 1e9) : undefined;
      return { text: out, truncated: data.done_reason === "length", tokensPerSec };
    } catch (e) {
      if (++this.failures >= 3) {
        this.openUntil = Date.now() + 60_000;
        this.failures = 0;
      }
      throw e;
    }
  }
}

export async function ollamaHealth(cfg: Config["llm"]): Promise<{ ok: boolean; models: string[]; hasModel: boolean; error?: string }> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const hasModel = models.some((m) => m === cfg.model || m === `${cfg.model}:latest`);
    return { ok: true, models, hasModel };
  } catch (e) {
    return { ok: false, models: [], hasModel: false, error: (e as Error).message };
  }
}
