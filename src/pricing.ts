/**
 * TurboSlop — cost estimation.
 *
 * Two very different price profiles, so they are tracked separately:
 *
 *   Jev    $0.042 per million INPUT tokens, output is free (it generates almost
 *          nothing — the answers are probabilities).
 *   Writer ordinary per-token pricing, and it dominates the bill. A reasoning
 *          model spends output tokens thinking before it writes, and output
 *          tokens are the expensive ones.
 *
 * Published prices change and vary by provider, so the writer's rates are
 * overridable. The defaults are DeepSeek's, since that is the default provider.
 * These are ESTIMATES for budgeting, not billing.
 */
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const PRICING = {
  /** Jev: USD per million input tokens. Output is free. */
  jevPerMTokIn: num(process.env.FORGE_JEV_PRICE_IN, 0.042),
  /** Writer: USD per million input / output tokens. */
  writerPerMTokIn: num(process.env.FORGE_LLM_PRICE_IN, 0.15),
  writerPerMTokOut: num(process.env.FORGE_LLM_PRICE_OUT, 0.6),
};

export function jevCost(inputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICING.jevPerMTokIn;
}

export function writerCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.writerPerMTokIn +
    (outputTokens / 1_000_000) * PRICING.writerPerMTokOut
  );
}

/** One-line summary of the two halves, for logs and the control surface. */
export function costBreakdown(jevTokens: number, wIn: number, wOut: number): string {
  const j = jevCost(jevTokens);
  const w = writerCost(wIn, wOut);
  return `~$${(j + w).toFixed(6)} (decide $${j.toFixed(6)} + write $${w.toFixed(6)})`;
}
