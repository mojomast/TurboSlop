/**
 * TurboSlop — LLM transport (the GENERATION half of the system).
 *
 *     Jev decides.  The LLM writes.
 *
 * Jev picks the design; it cannot produce a sentence. This module is how the
 * words get written, and it is deliberately provider-agnostic: every provider
 * below speaks the same OpenAI-compatible `/chat/completions` shape, so
 * switching from DeepSeek to anything else is configuration, not a code change.
 *
 * Resolution order (first match wins):
 *   1. FORGE_LLM_BASE_URL + FORGE_LLM_MODEL (+ FORGE_LLM_API_KEY)  — fully explicit
 *   2. FORGE_LLM_PROVIDER preset (deepseek | openai | openrouter | groq | ...)
 *
 * Nothing is hardcoded beyond sane defaults, and no key is ever read from a
 * file inside the repository.
 */

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Which env var the key came from, for diagnostics. Never the key itself. */
  keySource: string;
}

interface Preset {
  baseUrl: string;
  model: string;
  keyEnv: string;
  /** Some endpoints do not support response_format: json_object. */
  jsonMode: boolean;
  /**
   * Whether the endpoint understands a reasoning `effort` hint. Only sent when
   * the provider advertises it, so unknown fields never break another vendor.
   */
  effort?: boolean;
}

const PRESETS: Record<string, Preset> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY', jsonMode: true, effort: true },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyEnv: 'OPENAI_API_KEY', jsonMode: true },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4.1-flash', keyEnv: 'OPENROUTER_API_KEY', jsonMode: true },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY', jsonMode: true },
  together: { baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyEnv: 'TOGETHER_API_KEY', jsonMode: true },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyEnv: '', jsonMode: false },
};

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

/**
 * Resolve the generation provider, or null when nothing is configured — in
 * which case the pipeline simply keeps its canonical copy. The LLM is optional
 * in exactly the same way Jev is.
 */
export function resolveLlm(): LlmConfig | null {
  const explicitBase = env('FORGE_LLM_BASE_URL');
  const explicitModel = env('FORGE_LLM_MODEL');
  const explicitKey = env('FORGE_LLM_API_KEY');
  const providerName = env('FORGE_LLM_PROVIDER') ?? (explicitBase ? 'custom' : 'deepseek');
  const preset = PRESETS[providerName];

  // Fully explicit configuration wins outright.
  if (explicitBase && explicitModel) {
    const key = explicitKey ?? (preset ? env(preset.keyEnv) : undefined) ?? '';
    if (!key && providerName !== 'ollama' && !explicitBase.includes('localhost')) return null;
    return {
      provider: providerName,
      baseUrl: explicitBase.replace(/\/+$/, ''),
      model: explicitModel,
      apiKey: key,
      keySource: explicitKey ? 'FORGE_LLM_API_KEY' : preset?.keyEnv ?? 'none',
    };
  }

  if (!preset) return null;

  const key = explicitKey ?? env(preset.keyEnv) ?? '';
  // A local endpoint needs no key; a hosted one does.
  const isLocal = /localhost|127\.0\.0\.1/.test(preset.baseUrl);
  if (!key && !isLocal) return null;

  return {
    provider: providerName,
    baseUrl: preset.baseUrl.replace(/\/+$/, ''),
    model: explicitModel ?? preset.model,
    apiKey: key,
    keySource: explicitKey ? 'FORGE_LLM_API_KEY' : preset.keyEnv || 'none',
  };
}

export function describeLlm(cfg: LlmConfig | null): string {
  if (!cfg) return 'none (using canonical copy)';
  return `${cfg.provider}/${cfg.model} (key from ${cfg.keySource})`;
}

export interface CompletionResult {
  text: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteOptions {
  system: string;
  user: string;
  /** Ask the endpoint for a JSON object where supported. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /**
   * Reasoning effort for models that support it (deepseek-flash defaults to
   * "high", which burns most of the output budget thinking about a
   * copywriting task that does not need it).
   */
  effort?: 'low' | 'high' | 'max';
  timeoutMs?: number;
  signal?: AbortSignal;
  config?: LlmConfig | null;
}

/** Reasoning budget default. Overridable with FORGE_LLM_EFFORT. */
function defaultEffort(): 'low' | 'high' | 'max' {
  const v = env('FORGE_LLM_EFFORT');
  return v === 'high' || v === 'max' ? v : 'low';
}

/** One chat completion. Throws LlmError on anything that is not a 2xx. */
export async function complete(opts: CompleteOptions): Promise<CompletionResult> {
  const cfg = opts.config ?? resolveLlm();
  if (!cfg) throw new LlmError('No LLM provider configured', undefined, false);

  const preset = PRESETS[cfg.provider];
  const useJson = (opts.json ?? false) && (preset?.jsonMode ?? false);
  const useEffort = Boolean(preset?.effort) || Boolean(env('FORGE_LLM_EFFORT'));

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  const started = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        // Generous by default: a reasoning model spends output tokens thinking
        // before it writes a single character of the answer.
        max_tokens: opts.maxTokens ?? 4000,
        temperature: opts.temperature ?? 0.7,
        ...(useEffort ? { effort: opts.effort ?? defaultEffort() } : {}),
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new LlmError(`LLM request failed: HTTP ${res.status} ${body.slice(0, 300)}`, res.status, retryable);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };

    // Measured AFTER the body is consumed. `fetch` resolves on response headers,
    // so timing it there reports time-to-first-byte and badly understates a
    // model that streams a long answer.
    const latencyMs = Date.now() - started;

    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text.trim()) {
      // A reasoning model that exhausts its budget returns no content at all,
      // which is indistinguishable from a silent failure unless we say so.
      const reason = choice?.finish_reason ?? 'unknown';
      const thought = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      throw new LlmError(
        `LLM returned empty content (finish_reason=${reason}, reasoning_tokens=${thought}). ` +
          `Raise max_tokens or lower effort.`,
        undefined,
        reason === 'length',
      );
    }

    return {
      text,
      model: json.model ?? cfg.model,
      latencyMs,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new LlmError(`LLM request timed out after ${opts.timeoutMs ?? 60_000}ms`, undefined, true);
    }
    throw new LlmError(`LLM request failed: ${(err as Error)?.message ?? String(err)}`, undefined, true);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Retry only what is safe to retry (429 / 5xx / timeout), with backoff. */
export async function completeWithRetry(opts: CompleteOptions, attempts = 3): Promise<CompletionResult> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await complete(opts);
    } catch (err) {
      last = err;
      if (!(err instanceof LlmError) || !err.retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

/**
 * Tolerant JSON extraction.
 *
 * Models wrap JSON in prose or fences; reasoning models additionally truncate
 * when they run out of output budget. Throwing away an otherwise good
 * generation because the last array element is incomplete is the worst trade,
 * so we salvage what is there.
 */
export function extractJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

  // 1. As-is.
  try {
    return JSON.parse(cleaned);
  } catch {
    /* keep trying */
  }

  // 2. Outermost object, in case of surrounding prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* keep trying */
    }
  }

  // 3. Truncated: cut back to the last complete element and close what is open.
  const salvaged = salvageTruncatedJson(cleaned);
  if (salvaged) {
    try {
      return JSON.parse(salvaged);
    } catch {
      /* give up */
    }
  }

  throw new LlmError(`LLM did not return parseable JSON. Got: ${cleaned.slice(0, 200)}`);
}

/**
 * Close every bracket left open in `s`, or return null if it cannot be done
 * safely (for example an unterminated string).
 */
function closeOpen(s: string): string | null {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) return null;
  // A dangling separator would make the closed document invalid.
  let out = s.replace(/[,\s]+$/, '');
  if (out.endsWith(':')) return null;
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/** Try cutting at each closing bracket from the end until it parses. */
export function salvageTruncatedJson(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const body = raw.slice(start).trim();

  const cuts: number[] = [];
  for (let i = body.length - 1; i > 0 && cuts.length < 120; i--) {
    const c = body[i];
    if (c === '}' || c === ']') cuts.push(i + 1);
  }

  for (const cut of cuts) {
    const closed = closeOpen(body.slice(0, cut));
    if (!closed) continue;
    try {
      JSON.parse(closed);
      return closed;
    } catch {
      /* try an earlier cut */
    }
  }
  return null;
}
