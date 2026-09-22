/**
 * TurboSlop — direction selection.
 *
 * A single decision call produced a single argmax per axis, which is why every
 * page came out as a member of one family. Jev already returns a full
 * probability distribution for each axis; those ranked alternatives are the raw
 * material for several genuinely different directions.
 *
 * ## What a fit score is, and is not
 *
 * `fit` is a WEIGHTED SUM of independent per-axis probabilities. It is a
 * heuristic ranking device, **not** a calibrated probability for a whole page.
 * The axes are chosen independently by the model, and treating the product (or
 * sum) of their marginals as a joint probability would be meaningless.
 *
 * ## Selection
 *
 * Candidates are scored for fit, filtered by coherence, then selected as a SET
 * with a diversity objective: repeatedly take the candidate that maximises
 * `fit - λ · similarity-to-already-selected`. Deterministic for a given seed.
 *
 * Novelty is never forced past usefulness — below a fit floor we stop adding
 * directions rather than invent a page that fits the brief badly.
 */
import { BLUEPRINTS, fingerprintDistance, type Blueprint, type Lead, LEADS } from './blueprint.js';
import { EMOTION_AFFINITY } from './decider.js';
import { DENSITY_IDS, EFFECT_KITS, EMOTIONS, MOTIONS, PALETTES, TYPEFACES } from './catalog.js';
import { WEIGHTS } from './questions.js';
import type { Axis } from './types.js';

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */
/** Per-axis option -> probability, straight from Jev's Choice answers. */
export type Distributions = Partial<Record<Axis, Record<string, number>>>;

export interface Direction {
  id: string;
  /** The layout grammar this direction uses. */
  blueprint: Blueprint;
  palette: string;
  typography: string;
  effects: string;
  motion: string;
  density: string;
  /**
   * Heuristic fit, 0..1. A weighted sum of per-axis probabilities, NOT a
   * probability that the page is correct.
   */
  fit: number;
  /** Structural distance from the best-scoring direction chosen before it. */
  novelty: number;
  /** One line a human can read, explaining the pick. */
  rationale: string;
}

export interface BuildOptions {
  /** The brief itself, so candidate blueprints can be scored for relevance. */
  brief: string;
  distributions: Distributions;
  count: number;
  seed: number;
  /** Fingerprint keys already generated recently, to avoid near-duplicates. */
  excludeFingerprints?: string[];
  /** Guardrail from the brief: it reads as a dark ground. */
  wantsDark?: boolean;
  /** How hard to push apart. 0 = pure fit, 1 = fit and diversity weighted equally. */
  diversity?: number;
  /**
   * Fit-first <-> explore dial, 0..1. At 0 only leads that suit the brief's
   * emotional register are considered; at 1 the page is free to try any lead
   * that can still be filled honestly. This is what lets one brief yield both
   * a safe best-fit direction and a genuinely different one.
   */
  explore?: number;
}

/* ------------------------------------------------------------------ *
 * Brief-to-blueprint fit
 *
 * Without this, `fit` was constant across blueprints: every candidate sharing a
 * palette scored identically and the structure was chosen purely by the novelty
 * pass. Which lead suits which emotional register is judgement, so it is written
 * down explicitly rather than inferred.
 * ------------------------------------------------------------------ */
const LEADS_BY_EMOTION: Record<string, Lead[]> = {
  awe: ['statement', 'image'],
  serenity: ['statement', 'catalogue', 'story'],
  delight: ['catalogue', 'image', 'offer'],
  tension: ['data', 'product'],
  nostalgia: ['story', 'statement'],
  mystery: ['story', 'image'],
  trust: ['data', 'product'],
  energy: ['date', 'image', 'offer'],
  intimacy: ['story', 'statement'],
  optimism: ['product', 'offer', 'catalogue'],
  other: [...LEADS],
};

/**
 * 1 for a first-choice lead, decaying down the list. A lead outside the list
 * scores the floor, which the explore dial raises: at explore=0 an unlisted
 * lead is all but excluded, at explore=1 it is a legitimate alternative.
 */
function leadScore(emotion: string, lead: Lead, explore: number): number {
  const order = LEADS_BY_EMOTION[emotion] ?? LEADS_BY_EMOTION.other!;
  const idx = order.indexOf(lead);
  if (idx < 0) return 0.15 + 0.6 * explore;
  return Math.max(0.2, 1 - idx * 0.22);
}

const STOP = new Set([
  'a','an','the','and','or','but','for','to','of','in','on','with','that','this','it','is','are','be','as',
  'we','i','you','they','our','their','my','me','us','at','by','from','into','than','then','so','if','not',
  'small','new','good','best','high','low','more','most','very','some','one','two','three',
]);
const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Lexical overlap between the brief and what a blueprint says it suits.
 * A cheap, honest signal — and deliberately weak, so it can break ties without
 * overriding the emotional register.
 */
function lexicalScore(briefWords: Set<string>, bp: Blueprint): number {
  const text = new Set(words(`${bp.suits} ${bp.label} ${bp.lead} ${bp.family}`));
  if (!text.size || !briefWords.size) return 0;
  let hits = 0;
  for (const w of text) if (briefWords.has(w)) hits++;
  return Math.min(1, hits / 3);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const optionsOf = (c: { id: string }[]) => c.map((x) => x.id);

/** Ranked options for an axis, by probability, falling back to catalog order. */
function ranked(dist: Record<string, number> | undefined, ids: string[]): { id: string; p: number }[] {
  const d = dist ?? {};
  return ids
    .map((id) => ({ id, p: d[id] ?? 0 }))
    .sort((a, b) => b.p - a.p || a.id.localeCompare(b.id));
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 140;
}

const PALETTE_BG = Object.fromEntries(PALETTES.map((p) => [p.id, p.bg]));

/* ------------------------------------------------------------------ *
 * Coherence
 *
 * Compatibility between axes, derived from the same affinity model the local
 * decider uses. A combination that violates these is dropped rather than
 * rendered: incoherent pages are not a feature.
 * ------------------------------------------------------------------ */
function coherencePenalty(emotion: string, picks: { palette: string; typography: string; effects: string; motion: string }): number {
  const aff = EMOTION_AFFINITY[emotion];
  if (!aff) return 0;
  let misses = 0;
  if (!aff.palette.includes(picks.palette)) misses++;
  if (!aff.typography.includes(picks.typography)) misses++;
  if (!aff.effects.includes(picks.effects)) misses++;
  if (!aff.motion.includes(picks.motion)) misses++;
  return misses;
}

/* ------------------------------------------------------------------ *
 * Candidate generation
 * ------------------------------------------------------------------ */
interface Candidate {
  blueprint: Blueprint;
  palette: string;
  typography: string;
  effects: string;
  motion: string;
  density: string;
  fit: number;
  emotion: string;
}

/**
 * Build the candidate pool.
 *
 * We do NOT cross every axis with every other — that is 19 × 11 × 7 × 9 × 6 × 3.
 * Instead each axis contributes its top few alternatives, and we walk the
 * blueprints (the structural axis) against the leading non-structural picks.
 */
function buildCandidates(opts: BuildOptions): Candidate[] {
  const dist = opts.distributions;
  const emotionRanked = ranked(dist.emotion, optionsOf(EMOTIONS));
  const topEmotion = emotionRanked[0]?.id ?? 'other';

  const palettes = ranked(dist.palette, optionsOf(PALETTES));
  const types = ranked(dist.typography, optionsOf(TYPEFACES));
  const effects = ranked(dist.effects, optionsOf(EFFECT_KITS));
  const motions = ranked(dist.motion, optionsOf(MOTIONS));

  // Top alternatives per axis. Wider on the structural axes than on colour.
  const palettePool = palettes.slice(0, 4);
  const typePool = types.slice(0, 4);
  const effectPool = effects.slice(0, 4);
  const motionPool = motions.slice(0, 3);
  const densityPool = DENSITY_IDS.map((id, i) => ({ id, p: dist.density?.[String(i)] ?? 0 }));

  const out: Candidate[] = [];
  const briefWords = new Set(words(opts.brief ?? ''));
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.45));

  /* Normaliser: the best combination the axis distributions allow. Dividing by
     it makes `fit` a 0..1 "how close to the best available" score, which is
     interpretable and makes a floor meaningful regardless of how peaked the
     distributions are (Jev returns ~0.95 tops; the local decider spreads). */
  const bestPossible =
    WEIGHTS.emotion * (emotionRanked[0]?.p ?? 0) +
    WEIGHTS.palette * (palettePool[0]?.p ?? 0) +
    WEIGHTS.typography * (typePool[0]?.p ?? 0) +
    WEIGHTS.effects * (effectPool[0]?.p ?? 0) +
    WEIGHTS.motion * (motionPool[0]?.p ?? 0) +
    WEIGHTS.density * (densityPool[0]?.p ?? 0);
  const normalise = bestPossible > 0 ? 1 / bestPossible : 1;

  for (const bp of BLUEPRINTS) {
    for (const pal of palettePool) {
      // Guardrail: a brief that reads dark must not be given a light ground.
      if (opts.wantsDark && isLight(PALETTE_BG[pal.id] ?? '#ffffff')) continue;
      for (const typ of typePool) {
        for (const eff of effectPool) {
          for (const mot of motionPool) {
            for (const den of densityPool) {
              const penalty = coherencePenalty(topEmotion, {
                palette: pal.id,
                typography: typ.id,
                effects: eff.id,
                motion: mot.id,
              });
              // Three or four independent misses is not a direction, it is noise.
              if (penalty >= 3) continue;

              const raw =
                WEIGHTS.emotion * (emotionRanked[0]?.p ?? 0) +
                WEIGHTS.palette * pal.p +
                WEIGHTS.typography * typ.p +
                WEIGHTS.effects * eff.p +
                WEIGHTS.motion * mot.p +
                WEIGHTS.density * den.p -
                penalty * 0.04;

              /* Structural fit is weighted separately and heavily: the axes above
                 say how well the STYLING matches, not whether this is the right
                 KIND of page for the brief. */
              const axisScore = Math.max(0, raw * normalise);
              const structure =
                0.7 * leadScore(topEmotion, bp.lead, explore) + 0.3 * lexicalScore(briefWords, bp);
              const fit = 0.45 * axisScore + 0.55 * structure;

              out.push({
                blueprint: bp,
                palette: pal.id,
                typography: typ.id,
                effects: eff.id,
                motion: mot.id,
                density: den.id,
                fit: Number(fit.toFixed(4)),
                emotion: topEmotion,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */
export function buildDirections(opts: BuildOptions): Direction[] {
  const rand = mulberry32(opts.seed);
  const wanted = Math.max(1, Math.min(8, opts.count));
  const lambda = opts.diversity ?? 0.65;
  const excluded = new Set(opts.excludeFingerprints ?? []);

  let pool = buildCandidates(opts);

  // Drop blueprints we have just used, unless that would starve the pool.
  const fresh = pool.filter((c) => !excluded.has(c.blueprint.id));
  if (fresh.length >= wanted * 3) pool = fresh;

  // Deterministic shuffle so equal-fit candidates do not always win in catalog
  // order, then sort by fit.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  pool.sort((a, b) => b.fit - a.fit);

  const chosen: Candidate[] = [];
  const remaining = [...pool];

  /* A RELATIVE floor. An absolute one is meaningless here: fit is a weighted sum
     whose ceiling depends on how peaked the distributions are. We stop adding
     directions when nothing left is within this fraction of the best candidate,
     rather than inventing a page that fits the brief badly to reach a count. */
  const bestFit = pool[0]?.fit ?? 0;
  const floor = bestFit * 0.55;

  /**
   * Greedy selection under a minimum structural separation.
   *
   * Same-family blueprints sit roughly 0.5-0.66 apart structurally; different
   * families sit 0.8-1.0 apart. Without a threshold, several statement-led
   * pages win on fit alone and the set reads as one design again — the exact
   * failure this work exists to remove.
   */
  const greedy = (minSeparation: number, uniqueFamily: boolean): Candidate[] => {
    const picked: Candidate[] = [];
    const left = [...remaining];
    while (picked.length < wanted && left.length) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < left.length; i++) {
        const c = left[i]!;
        let penalty = 0;
        let blocked = false;
        if (uniqueFamily && picked.some((p) => p.blueprint.family === c.blueprint.family)) continue;
        for (const already of picked) {
          const structural = fingerprintDistance(c.blueprint, already.blueprint);
          if (structural < minSeparation) blocked = true;
          // Identical styling across every direction is also a kind of sameness,
          // so it carries a smaller penalty alongside the structural one.
          const sameAxis =
            (c.palette === already.palette ? 1 : 0) +
            (c.effects === already.effects ? 1 : 0) +
            (c.typography === already.typography ? 1 : 0) +
            (c.motion === already.motion ? 1 : 0);
          const sim = 0.8 * (1 - structural) + 0.2 * (sameAxis / 4);
          penalty = Math.max(penalty, sim);
        }
        if (blocked && picked.length) continue;
        const score = c.fit - (picked.length ? lambda * penalty : 0);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const pick = left[bestIdx]!;
      // Do not invent a direction that fits the brief badly just to reach a count.
      if (picked.length > 0 && pick.fit < floor) break;
      picked.push(pick);
      left.splice(bestIdx, 1);
    }
    return picked;
  };

  /* Escalating relaxation. First demand a different FAMILY for every direction
     (so the set cannot be three statement-led pages), then relax distance,
     then relax everything. We only sacrifice diversity to reach the count. */
  let selected = greedy(0.7, true);
  if (selected.length < wanted) selected = greedy(0.7, false);
  if (selected.length < wanted) selected = greedy(0.5, false);
  if (selected.length < wanted) selected = greedy(0, false);
  chosen.push(...selected);

  return chosen.map((c, i) => {
    const novelty = i === 0 ? 1 : Math.min(...chosen.slice(0, i).map((p) => fingerprintDistance(c.blueprint, p.blueprint)));
    return {
      id: `${c.blueprint.id}-${c.palette}-${c.effects}-${opts.seed}-${i}`,
      blueprint: c.blueprint,
      palette: c.palette,
      typography: c.typography,
      effects: c.effects,
      motion: c.motion,
      density: c.density,
      fit: c.fit,
      novelty: Number(novelty.toFixed(3)),
      rationale:
        i === 0
          ? `Best fit: ${c.blueprint.label} with ${c.palette}/${c.effects}.`
          : `${c.blueprint.label} — ${Math.round(novelty * 100)}% structurally apart from the others, fit ${c.fit.toFixed(3)}.`,
    };
  });
}

/* Re-exported for callers that only need ids. */
export const AXIS_IDS = {
  emotion: optionsOf(EMOTIONS),
  palette: optionsOf(PALETTES),
  typography: optionsOf(TYPEFACES),
  effects: optionsOf(EFFECT_KITS),
  motion: optionsOf(MOTIONS),
  density: [...DENSITY_IDS],
};
