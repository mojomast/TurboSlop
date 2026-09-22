/**
 * TurboSlop — deciders.
 *
 * Two interchangeable implementations of the same interface:
 *
 *   live  — real Jev. ~400ms, calibrated probabilities, the good path.
 *   local — a deterministic, offline stand-in. No network, no key, instant, and
 *           deliberately *modest*: it reports low confidence when a brief does
 *           not match anything strongly, rather than inventing certainty.
 *
 * The local decider is a STAND-IN, not a substitute. It exists so the pipeline
 * is runnable, testable and CI-friendly without a key. It is always labelled as
 * such in the emitted spec (`meta.decider: 'local'`) and never pretends to be Jev.
 *
 * Selection: FORGE_DECIDER = auto | live | local (default auto).
 *   auto -> live when TYPESAFE_API_KEY is present and reachable, else local.
 */
import { callJevWithRetry, hasApiKey, JevError } from './jev.js';
import { buildQuestions, type QuestionSet } from './questions.js';
import { CANDIDATES, COMPOSITIONS, DENSITY_LEVELS, EFFECT_KITS, EMOTIONS, LAYOUTS, MOTIONS, PALETTES, TYPEFACES } from './catalog.js';
import type { JevResponse } from './types.js';

export type DeciderKind = 'live' | 'local';

export interface DecideResult {
  response: JevResponse;
  kind: DeciderKind;
  latencyMs: number;
  /** Present when we wanted live but had to fall back — surfaced, never silent. */
  fallbackReason?: string;
}

export interface Decider {
  readonly kind: DeciderKind;
  decide(brief: string, signal?: AbortSignal): Promise<DecideResult>;
}

/* ================================================================== *
 * LIVE — real Jev
 * ================================================================== */
class LiveDecider implements Decider {
  readonly kind = 'live' as const;

  async decide(brief: string, signal?: AbortSignal): Promise<DecideResult> {
    const questions = buildQuestions();
    const started = Date.now();
    const { parsed, latencyMs } = await callJevWithRetry({
      state: { brief },
      questions,
      signal,
    });
    return { response: parsed, kind: 'live', latencyMs: latencyMs ?? Date.now() - started };
  }
}

/* ================================================================== *
 * LOCAL — deterministic stand-in
 *
 * Coherent rather than clever: a keyword/affinity model that links emotions to
 * the supporting axes, so the composition it produces is internally consistent
 * even though the signal is weak. Explicitly reports that weakness via
 * confidence.
 * ================================================================== */

const STOPWORDS = new Set([
  'a','an','the','and','or','but','for','to','of','in','on','with','that','this','it','is','are','be','as',
  'we','i','you','they','our','their','my','me','us','at','by','from','into','than','then','so','if','not',
  'should','would','could','can','will','make','made','want','wants','need','needs','like','feel','feels',
  'page','site','website','design','brief','studio','landing','client','very','really','more','most','some',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Emotion -> supporting axis affinities. Keeps the stand-in internally coherent.
 *
 * Also exported so the direction selector can use the same coherence model when
 * scoring candidate combinations.
 *
 * EVERY ID HERE MUST EXIST IN THE CATALOG. These once referenced a set of
 * typeface ids that were planned but never landed, so the typography boost
 * silently did nothing. `test/forge.test.ts` now asserts this.
 */
export const EMOTION_AFFINITY: Record<
  string,
  { composition: string[]; effects: string[]; palette: string[]; typography: string[]; layout: string[]; motion: string[]; density: number }
> = {
  awe:        { composition: ['manifesto', 'gallery-first'], effects: ['cinematic-depth', 'flat-plain'], palette: ['arctic-cyan', 'hazard-mono', 'noir-lime'], typography: ['grotesk-tight', 'condensed-heavy'], layout: ['full-bleed-cinematic'], motion: ['glacial'], density: 0 },
  serenity:   { composition: ['split-hero', 'classic-stack'], effects: ['soft-material', 'flat-plain', 'organic-mesh'], palette: ['sage-mist', 'aurora-glass'], typography: ['humanist-light', 'geometric-open'], layout: ['centered-measure', 'editorial-asymmetric'], motion: ['breath'], density: 0 },
  delight:    { composition: ['bento-grid', 'gallery-first'], effects: ['brutalist-block', 'soft-material', 'luminous-glass'], palette: ['candy-pop', 'aurora-glass'], typography: ['rounded-friendly', 'geometric-open'], layout: ['modular-cards'], motion: ['springy-playful'], density: 1 },
  tension:    { composition: ['data-first', 'classic-stack'], effects: ['technical-drawing', 'flat-plain', 'brutalist-block'], palette: ['hazard-mono', 'noir-lime'], typography: ['mono-technical', 'condensed-heavy'], layout: ['rigid-grid', 'editorial-asymmetric'], motion: ['snap-mechanical'], density: 2 },
  nostalgia:  { composition: ['editorial-lede', 'manifesto'], effects: ['tactile-paper', 'hairline-editorial'], palette: ['paper-ink', 'bone-terracotta'], typography: ['editorial-serif'], layout: ['centered-measure', 'editorial-asymmetric'], motion: ['glacial'], density: 1 },
  mystery:    { composition: ['manifesto', 'editorial-lede'], effects: ['cinematic-depth', 'flat-plain'], palette: ['void-violet', 'hazard-mono'], typography: ['editorial-serif', 'mono-technical'], layout: ['editorial-asymmetric', 'full-bleed-cinematic'], motion: ['glacial', 'breath'], density: 1 },
  trust:      { composition: ['data-first', 'classic-stack'], effects: ['hairline-editorial', 'flat-plain'], palette: ['steel-signal', 'sage-mist'], typography: ['geometric-open', 'grotesk-tight'], layout: ['rigid-grid'], motion: ['snap-mechanical', 'buoyant'], density: 2 },
  energy:     { composition: ['gallery-first', 'bento-grid'], effects: ['brutalist-block', 'luminous-glass'], palette: ['electric-acid', 'noir-lime'], typography: ['condensed-heavy', 'grotesk-tight'], layout: ['full-bleed-cinematic', 'modular-cards'], motion: ['kinetic'], density: 2 },
  intimacy:   { composition: ['editorial-lede', 'manifesto'], effects: ['tactile-paper', 'soft-material'], palette: ['bone-terracotta', 'paper-ink'], typography: ['editorial-serif', 'humanist-light'], layout: ['centered-measure'], motion: ['breath', 'buoyant'], density: 0 },
  optimism:   { composition: ['bento-grid', 'split-hero'], effects: ['luminous-glass', 'soft-material', 'organic-mesh'], palette: ['aurora-glass', 'candy-pop'], typography: ['geometric-open', 'rounded-friendly'], layout: ['modular-cards', 'editorial-asymmetric'], motion: ['buoyant'], density: 1 },
};

function scoreCandidate(id: string, label: string, description: string, briefTokens: string[], boost: string[]): number {
  const bag = new Set(tokens(`${id} ${label} ${description}`));
  let score = 0;
  for (const t of briefTokens) {
    if (bag.has(t)) score += 1;
    else if ([...bag].some((b) => b.startsWith(t) || t.startsWith(b))) score += 0.5;
  }
  // Affinity with a leading option nudges coherent pairings.
  if (boost.includes(id)) score += 0.75;
  return score;
}

/** Convert a score vector into probabilities with a modest temperature. */
function toProbabilities(scores: number[], ids: string[], temperature = 0.75) {
  const max = Math.max(...scores, 0);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sum);
  const probabilities: Record<string, number> = {};
  ids.forEach((id, i) => (probabilities[id] = Number((probs[i] ?? 0).toFixed(4))));
  const best = Math.max(...probs);
  const n = scores.length;
  // Confidence = how far the winning shape is from uniform (Jev's notion).
  const shape = n > 1 ? (best - 1 / n) / (1 - 1 / n) : 1;
  return { probabilities, best, shape };
}

function localDecide(brief: string): JevResponse {
  const briefTokens = tokens(brief);
  // Evidence gate: with almost no keyword signal we must NOT be confident.
  const evidence = Math.min(1, briefTokens.length / 6);

  const choiceAxes = [
    { axis: 'emotion', candidates: EMOTIONS },
    { axis: 'composition', candidates: COMPOSITIONS },
    { axis: 'effects', candidates: EFFECT_KITS },
    { axis: 'palette', candidates: PALETTES },
    { axis: 'typography', candidates: TYPEFACES },
    { axis: 'layout', candidates: LAYOUTS },
    { axis: 'motion', candidates: MOTIONS },
  ] as const;

  // 1) emotion first — it drives the affinities for everything else.
  const emotionScores = EMOTIONS.map((c) => scoreCandidate(c.id, c.label, c.description, briefTokens, []));
  const emotionIds = EMOTIONS.map((c) => c.id);
  const emotionResult = toProbabilities(emotionScores, emotionIds);
  const leadEmotion = emotionIds[emotionScores.indexOf(Math.max(...emotionScores))] ?? 'other';

  // 2) supporting axes, boosted by the leading emotion's affinities.
  const answers: Record<string, unknown> = {};
  const aff = EMOTION_AFFINITY[leadEmotion];

  for (const { axis, candidates } of choiceAxes) {
    if (axis === 'emotion') {
      answers.emotion = {
        type: 'choice',
        choice: leadEmotion,
        confidence: Number((emotionResult.shape * evidence).toFixed(4)),
        probabilities: emotionResult.probabilities,
      };
      continue;
    }
    const boost = (aff ? (aff[axis as 'composition' | 'effects' | 'palette' | 'typography' | 'layout' | 'motion'] as string[]) : []) ?? [];
    const scores = candidates.map((c) => scoreCandidate(c.id, c.label, c.description, briefTokens, boost));
    const ids = candidates.map((c) => c.id);
    const result = toProbabilities(scores, ids);
    const picked = ids[scores.indexOf(Math.max(...scores))] ?? ids[0]!;
    answers[axis] = {
      type: 'choice',
      choice: picked,
      confidence: Number((result.shape * evidence).toFixed(4)),
      probabilities: result.probabilities,
    };
  }

  // 3) density — a Score over three described situations.
  const densityHint = aff ? aff.density : 1;
  const dense = /dense|detailed|data|table|spec|dashboard|many|rich|information/.test(brief.toLowerCase());
  const quiet = /calm|minimal|quiet|spacious|simple|calm|serene|breathing|airy/.test(brief.toLowerCase());
  const score = Math.max(0, Math.min(2, dense ? 2 : quiet ? 0 : densityHint));
  // A triangular distribution centred on the chosen level. This mirrors the
  // shape Jev returns for a Score, so nothing downstream can tell the two
  // backends apart.
  const dist: Record<string, number> = {};
  [0, 1, 2].forEach((i) => {
    const delta = Math.abs(i - score);
    dist[String(i)] = Number((delta === 0 ? 0.7 : delta === 1 ? 0.25 : 0.05).toFixed(4));
  });
  answers.density = {
    type: 'score',
    score,
    confidence: Number((0.4 * evidence).toFixed(4)),
    legend: Object.fromEntries(DENSITY_LEVELS.map((l, i) => [String(i), l])),
    probabilities: dist,
  };

  // 4) guardrails
  const lower = brief.toLowerCase();
  answers.wants_dark_ground = {
    type: 'noul',
    noul: /dark|black|night|moody|neon|glow|deep|void/.test(lower) ? 0.85 : /light|bright|white|airy|paper|day/.test(lower) ? 0.08 : 0.5,
  };
  answers.needs_high_contrast = {
    type: 'noul',
    noul: /accessib|contrast|wcag|public sector|health|government|finance|bank|regulation|safety/.test(lower) ? 0.9 : 0.15,
  };

  return {
    model: 'local-stand-in-1',
    answers: answers as JevResponse['answers'],
    usage: { input_tokens: JSON.stringify(brief).length, output_tokens: 0 },
  };
}

class LocalDecider implements Decider {
  readonly kind = 'local' as const;
  async decide(brief: string): Promise<DecideResult> {
    const started = Date.now();
    const response = localDecide(brief);
    return { response, kind: 'local', latencyMs: Date.now() - started };
  }
}

/* ================================================================== *
 * Factory
 * ================================================================== */
export type DeciderPreference = 'auto' | 'live' | 'local';

export interface CreateDeciderOptions {
  preference?: DeciderPreference;
  /** Skip the live attempt entirely (used by tests). */
  offline?: boolean;
}

export function createDecider(opts: CreateDeciderOptions = {}): Decider {
  const preference =
    opts.preference ?? ((process.env.FORGE_DECIDER as DeciderPreference | undefined) ?? 'auto');
  if (opts.offline || preference === 'local') return new LocalDecider();
  if (preference === 'live') return new LiveDecider();
  return hasApiKey() ? new LiveDecider() : new LocalDecider();
}

/**
 * Run the preferred decider, falling back to local if Jev is unreachable.
 * The fallback is always reported, never silent.
 */
export async function decideWithFallback(
  brief: string,
  opts: CreateDeciderOptions & { signal?: AbortSignal } = {},
): Promise<DecideResult> {
  const preference =
    opts.preference ?? ((process.env.FORGE_DECIDER as DeciderPreference | undefined) ?? 'auto');
  const primary = createDecider(opts);

  if (primary.kind === 'local') return primary.decide(brief, opts.signal);

  try {
    return await primary.decide(brief, opts.signal);
  } catch (err) {
    if (preference === 'live') throw err; // explicit live request: don't mask the failure
    const reason = err instanceof JevError ? err.message : String(err);
    const fallback = await new LocalDecider().decide(brief);
    return { ...fallback, fallbackReason: reason };
  }
}
