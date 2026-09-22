/**
 * TurboSlop — the writer.
 *
 *     Jev decides the DESIGN.   The writer writes the CONTENT.
 *
 * Given the brief and the design already chosen, this produces the whole
 * content model: the brand, the headline, the sections, the items, the stats,
 * the contact details. Nothing about any particular company is baked in — a
 * brief for a candy shop produces a candy shop, not a design studio.
 *
 * The design decisions are passed through deliberately: the prose should be
 * written *in the register of the layout it will sit inside*. A calm sage
 * composition gets calm copy; a hazard-striped control panel does not get a spa
 * sentence.
 *
 * Optional. With no provider configured an honest specimen is used instead
 * (see `fallbackContent` in content.ts).
 */
import { Content, repairContent, type Content as ContentModel } from './content.js';
import { completeWithRetry, extractJson, resolveLlm, LlmError, type LlmConfig } from './llm.js';
import type { DesignSpec } from './types.js';

const BASE_CONTRACT = `
Return ONE JSON object and nothing else, with exactly these keys:

{
  "brand":       string   // the company/brand name this page is for. 2-32 chars, often ONE word.
  "title":       string   // <title>, 40-70 chars, includes the brand
  "description": string   // meta description, 120-160 chars, plain, no hype
  "eyebrow":     string   // small label above the headline, e.g. "Independent studio — Lisbon, est. 2019"
  "tagline":     string   // THE hero headline. 6-14 words. Wrap exactly ONE phrase in *asterisks*.
  "lede":        string   // hero paragraph, 120-220 chars, expands the tagline
  "cta":         string   // primary button label, 2-4 words, imperative
  "nav":         string[] // 4-5 nav labels, short. Last one is the contact label.

  "sections": {
    "items":    { "eyebrow": string, "title": string, "note": string },  // the portfolio/products/menu grid
    "features": { "eyebrow": string, "title": string, "note": string },  // capabilities/services/benefits
    "about":    { "eyebrow": string, "title": string, "note": string },
    "contact":  { "eyebrow": string, "title": string, "note": string }
  },

  "items":    [ { "name": string, "meta": string, "tags": string[] } ],   // 5-6 entries
  "stats":    [ { "value": string, "label": string, "note": string } ],   // 3-4 entries
  "features": [ { "name": string, "detail": string } ],                   // 4-6 entries
  "aboutFacts": [ { "label": string, "value": string } ],                 // 3-4 entries
  "aboutBody":  [ string ],                                               // 2 paragraphs, 220-420 chars each

  "contact": { "email": string, "phone": string, "address": string },
  "footerNote": string,   // one short line for the footer

__OPTIONAL__
}

Every section "title" may also wrap exactly ONE phrase in *asterisks*. Use this
sparingly — one emphasised phrase per heading at most, and never in a way that
leaves the heading unreadable without it.
`.trim();

/**
 * The optional elements a composition will actually render.
 *
 * We ask only for what the chosen structure uses. The model is billed on output
 * tokens, so requesting a ticker for a page that has no ticker is paying twice:
 * once to write it, once in latency.
 */
const OPTIONAL_FIELDS: Record<string, string> = {
  ticker: `  "ticker": string[],  // 4-6 VERY short phrases (1-3 words) for a scrolling band\n`,
  pullQuote: `  "pullQuote": { "text": string, "attribution": string },  // ONE memorable sentence, 60-200 chars\n`,
  process: `  "process": [ { "name": string, "detail": string } ]    // 3-5 steps describing how you work\n`,
};

/** Which optional elements each composition renders. */
const USES: Record<string, string[]> = {
  'classic-stack': ['ticker'],
  'split-hero': ['ticker'],
  'gallery-first': ['ticker'],
  'editorial-lede': ['pullQuote'],
  'bento-grid': ['pullQuote'],
  manifesto: ['pullQuote', 'process'],
  'data-first': [],
};

function contractFor(composition: string): string {
  const keys = USES[composition] ?? [];
  const body = keys
    .map((k) => OPTIONAL_FIELDS[k] ?? '')
    .join('')
    .trimEnd();
  return BASE_CONTRACT.replace('__OPTIONAL__', body);
}

const RULES = `
INVENT the brand. The brief describes a business or product; you are naming and
writing for it. Make the brand fit the brief's world — a candy shop should not be
called a design studio, and a satellite operator should not sound like a spa.

Do NOT use the name of a real existing company, and do not reference real
competitors. Everything you write is fiction for a design specimen.

Everything a reader sees should be specific to THIS brief: the item names, the
stats, the feature names, the address, the tone. Generic filler ("Innovative
solutions", "We are passionate about quality", "Lorem ipsum") is a failure.

Keep numbers plausible and self-consistent. Prefer concrete, slightly odd detail
over rounded marketing claims.

Write in the emotional register you are given, but never name the emotion itself.
`.trim();

export interface WriteContentResult {
  content: ContentModel;
  source: 'llm' | 'fallback';
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Present when a writer was configured but failed — never silently ignored. */
  fallbackReason?: string;
}

export interface WriteContentOptions {
  signal?: AbortSignal;
  config?: LlmConfig | null;
  /** Force the deterministic specimen (used by tests). */
  offline?: boolean;
  /** Used only when falling back. */
  fallback: ContentModel;
}

/** Describe the chosen design so the prose matches the register. */
function designBrief(spec: DesignSpec): string {
  const pick = (axis: string) => spec.decisions.find((d) => d.axis === axis);
  return [
    `Emotional register: ${pick('emotion')?.picked ?? 'unknown'}.`,
    `Colour system: ${pick('palette')?.picked ?? '?'}.`,
    `Typography: ${pick('typography')?.picked ?? '?'}.`,
    `Layout: ${pick('layout')?.picked ?? '?'}.`,
    `Motion: ${pick('motion')?.picked ?? '?'}.`,
    `Information density: ${pick('density')?.picked ?? '?'}.`,
  ].join(' ');
}

export async function writeContent(
  brief: string,
  spec: DesignSpec,
  opts: WriteContentOptions,
): Promise<WriteContentResult> {
  const base: WriteContentResult = {
    content: opts.fallback,
    source: 'fallback',
    model: 'none',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  if (opts.offline) return base;

  const cfg = opts.config ?? resolveLlm();
  if (!cfg) return base;

  const composition = spec.tokens.composition ?? 'classic-stack';

  const system = [
    'You write the content for a single-page design specimen.',
    'You are concrete, specific and confident. You never use marketing filler,',
    'never stack adjectives, and never explain how clever the design is.',
    '',
    RULES,
    '',
    contractFor(composition),
  ].join('\n');

  const user = [
    `BRIEF:\n${brief}`,
    '',
    `THE DESIGN ALREADY CHOSEN (write to match its register):\n${designBrief(spec)}`,
    '',
    'Write the content now. Return only the JSON object.',
  ].join('\n');

  try {
    const res = await completeWithRetry(
      {
        system,
        user,
        json: true,
        // The content model is a large object and a reasoning model spends
        // output budget thinking before it writes a character. Too small a
        // budget here truncates the JSON mid-array.
        maxTokens: 8000,
        temperature: 0.85,
        signal: opts.signal,
        config: cfg,
      },
      3,
    );

    // A truncated response can still be salvaged, and an over-long field can be
    // clamped. Both are far better than discarding a good generation.
    const extracted = extractJson(res.text);
    const content = repairContent(extracted);
    if (!content) {
      return { ...base, fallbackReason: 'content could not be repaired into a complete page' };
    }

    return {
      content,
      source: 'llm',
      model: res.model,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    };
  } catch (err) {
    const reason = err instanceof LlmError ? err.message : String(err);
    return { ...base, fallbackReason: reason };
  }
}
