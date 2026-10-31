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

export interface ModelInfo {
  name: string;
  sizeBytes: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

const base = (cfg: Config["llm"]) => cfg.baseUrl.replace(/\/$/, "");

/** Ollama model names: letters, digits and `. _ - : /` only. Anything else is refused before it reaches Ollama. */
export const validModelName = (name: unknown): name is string => typeof name === "string" && /^[\w][\w.\-:/]{0,120}$/.test(name);

/** Models pulled into the local Ollama, with size and family. */
export async function ollamaModels(cfg: Config["llm"]): Promise<{ ok: boolean; models: ModelInfo[]; error?: string }> {
  try {
    const res = await fetch(`${base(cfg)}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { models?: { name: string; size?: number; details?: { family?: string; parameter_size?: string; quantization_level?: string } }[] };
    return { ok: true, models: (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size ?? 0, family: m.details?.family, parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level })) };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}

const TEST_TEXT =
  "Deployment of api-gateway v2.14.1 failed on node pool np-7 at 03:42 UTC with error E1137 after 3 retries. The on-call engineer rolled back to v2.13.9, which completed in 41 seconds. A follow-up ticket was opened to review the readiness probe timeout.";
const TEST_FACTS = ["api-gateway", "2.14.1", "np-7", "E1137", "2.13.9"];

export interface ModelTestResult {
  ok: boolean;
  model: string;
  latencyMs?: number;
  tokensPerSec?: number;
  factsKept?: number;
  factsTotal: number;
  truncated?: boolean;
  summary?: string;
  error?: string;
}

/** One fixed summarization with known facts: how fast is this model here, and does it keep identifiers and numbers. */
export async function testModel(cfg: Config["llm"], model: string): Promise<ModelTestResult> {
  const started = Date.now();
  try {
    const client = new OllamaClient({ ...cfg, model, timeoutMs: Math.max(cfg.timeoutMs, 120_000), options: { ...cfg.options, num_predict: 200 } });
    const r = await client.complete("Summarize the text in at most two sentences. Keep every identifier, version and number exactly as written.", TEST_TEXT);
    return { ok: true, model, latencyMs: Date.now() - started, tokensPerSec: r.tokensPerSec && Math.round(r.tokensPerSec * 10) / 10, factsKept: TEST_FACTS.filter((f) => r.text.includes(f)).length, factsTotal: TEST_FACTS.length, truncated: r.truncated, summary: r.text };
  } catch (e) {
    return { ok: false, model, factsTotal: TEST_FACTS.length, error: (e as Error).message };
  }
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
}

/** Download a model from the Ollama registry through the local Ollama (explicit user action only). */
export async function pullModel(cfg: Config["llm"], model: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  if (!validModelName(model)) return { ok: false, error: "invalid model name" };
  try {
    const res = await fetch(`${base(cfg)}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: true }), signal });
    if (!res.ok || !res.body) return { ok: false, error: `ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const dec = new TextDecoder();
    let buf = "";
    let failure: string | undefined;
    const line = (l: string) => {
      if (!l.trim()) return;
      try {
        const p = JSON.parse(l) as PullProgress;
        if (p.error) failure = p.error;
        onProgress(p);
      } catch {
        /* ignore a malformed progress line */
      }
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(line);
    }
    line(buf);
    return failure ? { ok: false, error: failure } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
