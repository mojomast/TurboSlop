/**
 * turboslop — Jev transport.
 *
 * A thin, typed client for POST /v1/systemone. Deliberately small: the wire
 * format is simple, and keeping our own transport (rather than depending on the
 * SDK) means the tool has zero required dependencies and can fall back cleanly
 * when no key is present. The question helpers below mirror the official
 * `@typesafe-ai/sdk` (`noul` / `choice` / `score`) so swapping to the SDK later
 * is mechanical.
 *
 * The API key is read from the environment ONLY. It is never read from a file
 * inside the repo and never written anywhere.
 */
import { JevResponse } from './types.js';
import type { QuestionSet } from './questions.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

export function hasApiKey(): boolean {
  return typeof process.env.TYPESAFE_API_KEY === 'string' && process.env.TYPESAFE_API_KEY.trim().length > 0;
}

export interface JevCallOptions {
  state: unknown;
  questions: QuestionSet;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JevCallResult {
  parsed: JevResponse;
  latencyMs: number;
  model: string;
}

/**
 * One request, all questions. Jev evaluates every question independently and in
 * parallel against the same state, so adding questions costs only their own
 * tokens — the reason we batch instead of making sequential calls.
 */
export async function callJev(opts: JevCallOptions): Promise<JevCallResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY is not set', undefined, false);

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const model = opts.model ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, state: opts.state, questions: opts.questions }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 429 / 529 are transient; surface that so the caller can retry or fall back.
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      throw new JevError(`Jev request failed: HTTP ${res.status} ${text.slice(0, 300)}`, res.status, retryable);
    }

    const raw = await res.json();
    const parsed = JevResponse.parse(raw);
    return { parsed, latencyMs, model: parsed.model };
  } catch (err) {
    if (err instanceof JevError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new JevError(`Jev request timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new JevError(`Jev request failed: ${(err as Error)?.message ?? String(err)}`, undefined, true);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Retry only what is safe to retry (429 / 529 / 5xx / timeout), with backoff. */
export async function callJevWithRetry(opts: JevCallOptions, attempts = 3): Promise<JevCallResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await callJev(opts);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof JevError) || !err.retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr;
}
