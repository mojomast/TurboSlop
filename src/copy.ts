/**
 * turboslop — the copywriter.
 *
 * The division of labour, made concrete:
 *
 *   Jev     picks the EMOTION, palette, type, layout, motion, density.
 *   LLM     writes the WORDS that live inside that design.
 *   Code    composes both and owns every fixed fact.
 *
 * The model is given the brief AND the decisions Jev already made, so the prose
 * is written *in the register of the design* rather than guessed independently.
 * A calm sage layout gets calm sage copy; a hazard-striped control panel does
 * not get a spa sentence.
 *
 * The LLM is optional. With no provider configured the canonical copy is used
 * and the spec records `copyWriter: 'canonical'`.
 */
import { Copy } from './types.js';
import type { DesignSpec } from './types.js';
import { completeWithRetry, extractJson, resolveLlm, LlmError, type LlmConfig } from './llm.js';

/** Canonical copy — the fallback, and the source of every fixed fact. */
export const CANONICAL_COPY: Copy = {
  title: 'ATELIER NULL — We design interfaces that behave like objects',
  description:
    'ATELIER NULL is an independent design studio in Lisbon. Product design, design systems, brand identity and front-end engineering for teams who care about craft.',
  lede: 'From blank canvas to shipped interface — design systems, storefronts and brand work for teams who care how things feel.',
  note: 'Shipped product, not concepts. Six projects across product, commerce and editorial.',
  about: [
    'We say no fairly often. No trend-chasing redesigns, no dashboards that need a manual, no motion added because a slide asked for delight. A few long relationships beat a queue of one-off builds, and most of our clients have been with us for years.',
    'Interfaces should behave like objects. An object has weight, an edge and a consequence — you push it and it answers the way it promised to. So we design the consequence first.',
  ],
  cta: 'Start a project',
};

/**
 * Facts the model may restate but never invent, alter or extend.
 * Anything a reader could check must come from here.
 */
const FIXED_FACTS = `
STUDIO (fixed — do not change, extend or contradict):
- Name: ATELIER NULL, an independent design studio.
- Founded 2019. Based in Lisbon and remote. Six people.
- Positioning line: "We design interfaces that behave like objects."
- Email studio@ateliern.ull, phone +351 21 000 0000, Rua da Boavista 84, Lisbon.
- Numbers: 48 shipped products, 11 industry awards, 6.2 years average client
  relationship, 94% referral rate.
- Six projects on the site: HALCYON (fintech dashboard, 2025), VESPER (perfume
  e-commerce, 2025), ORBITAL (satellite imaging SaaS, 2024), KILN (ceramics
  marketplace, 2024), MERIDIAN (travel journal iOS, 2023), FERNSIDE
  (architecture studio, 2023).
- Capabilities: Product Design, Design Systems, Brand Identity,
  Motion & Interaction, Front-end Engineering, Art Direction.

You must NOT invent clients, awards, testimonials, dates, team names, metrics or
case-study outcomes. If you need a concrete detail you do not have, write around
it instead of making one up.
`.trim();

const CONTRACT = `
Return ONE JSON object and nothing else, with exactly these keys:

{
  "title":       string  // page <title>, 40-70 chars, studio name included
  "description": string  // meta description, 120-160 chars, plain and specific
  "lede":        string  // hero sentence, 120-220 chars. The studio's promise.
  "note":        string  // a short aside beside a section heading, 60-160 chars
  "about":       string[] // 2 paragraphs, 220-420 chars each, first person plural
  "cta":         string  // button label, 2-4 words, imperative
}
`.trim();

export interface WriteCopyResult {
  copy: Copy;
  source: 'llm' | 'canonical';
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Present when an LLM was configured but failed — never silently ignored. */
  fallbackReason?: string;
}

export interface WriteCopyOptions {
  signal?: AbortSignal;
  config?: LlmConfig | null;
  /** Force the canonical copy (used by tests). */
  offline?: boolean;
}

/** Describe the chosen design in words, so the prose matches the register. */
function designBrief(spec: DesignSpec): string {
  const pick = (axis: string) => spec.decisions.find((d) => d.axis === axis);
  const emotion = pick('emotion');
  const palette = pick('palette');
  const type = pick('typography');
  const layout = pick('layout');
  const motion = pick('motion');
  const density = pick('density');
  return [
    `Chosen emotional register: ${emotion?.picked ?? 'unknown'} (confidence ${emotion?.confidence.toFixed(2) ?? '?'}).`,
    `This is the feeling the page must produce in a first-time visitor.`,
    `Palette: ${palette?.picked ?? '?'}. Typography: ${type?.picked ?? '?'}.`,
    `Layout: ${layout?.picked ?? '?'}. Motion: ${motion?.picked ?? '?'}. Information density: ${density?.picked ?? '?'}.`,
  ].join(' ');
}

export async function writeCopy(
  brief: string,
  spec: DesignSpec,
  opts: WriteCopyOptions = {},
): Promise<WriteCopyResult> {
  const canonical: WriteCopyResult = {
    copy: CANONICAL_COPY,
    source: 'canonical',
    model: 'none',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  if (opts.offline) return canonical;

  const cfg = opts.config ?? resolveLlm();
  if (!cfg) return canonical;

  const system = [
    'You are the senior copywriter at ATELIER NULL, an independent design studio.',
    'You write short, confident, concrete prose. You never use marketing filler,',
    'never stack adjectives, and never explain how clever the design is.',
    'You write in the emotional register you are given, using the vocabulary of',
    'that register but never naming the emotion itself.',
    '',
    FIXED_FACTS,
    '',
    CONTRACT,
  ].join('\n');

  const user = [
    `CLIENT BRIEF:\n${brief}`,
    '',
    `THE DESIGN ALREADY CHOSEN (write to match it):\n${designBrief(spec)}`,
    '',
    'Write the copy now. Return only the JSON object.',
  ].join('\n');

  try {
    const res = await completeWithRetry(
      {
        system,
        user,
        json: true,
        // Reasoning models spend output budget thinking before they write.
        maxTokens: 4000,
        temperature: 0.75,
        signal: opts.signal,
        config: cfg,
      },
      3,
    );
    const parsed = Copy.safeParse(extractJson(res.text));
    if (!parsed.success) {
      return {
        ...canonical,
        fallbackReason: `copy failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ').slice(0, 200)}`,
      };
    }
    return {
      copy: parsed.data,
      source: 'llm',
      model: res.model,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    };
  } catch (err) {
    const reason = err instanceof LlmError ? err.message : String(err);
    return { ...canonical, fallbackReason: reason };
  }
}
