/**
 * TurboSlop — questions, thresholds and weights.
 *
 * THIS IS THE FILE A HUMAN REVIEWS.
 *
 * Every judgment the tool makes is declared here, in one place, so questions,
 * criteria and decision thresholds can be read, diffed and versioned together.
 * When you change how the tool decides, you change this file — not a prompt
 * buried somewhere in the pipeline.
 *
 * Design rules applied throughout (see JEV-RESEARCH.md §4):
 *   - ONE judgment per question.
 *   - Criteria DESCRIBE SITUATIONS, not degrees.
 *   - Every Choice gets an exit option.
 *   - All independent questions go in ONE call (speculative fan-out) — the
 *     answers run in parallel against the same state and cost only their own
 *     tokens, so we ask everything we might need up front and let code decide
 *     which answers it uses.
 */
import { CANDIDATES, COMPOSITIONS, EFFECT_KITS, DENSITY_LEVELS, EMOTIONS, PALETTES, TYPEFACES, LAYOUTS, MOTIONS } from './catalog.js';
import type { Axis } from './types.js';

/* ------------------------------------------------------------------ *
 * Thresholds — the decision policy.
 *
 * `confidence` is the shape of the probability distribution collapsed to one
 * number. Below the floor we do not pretend to know: the axis is flagged for
 * review and the ranked alternatives are surfaced instead.
 *
 * These are STARTING POINTS, not truth. Calibrate them against real briefs.
 * ------------------------------------------------------------------ */
export const THRESHOLDS: Record<Axis, number> = {
  emotion: 0.5,
  composition: 0.45,
  effects: 0.45,
  palette: 0.5,
  typography: 0.5,
  layout: 0.45,
  motion: 0.45,
  density: 0.5,
};

/* ------------------------------------------------------------------ *
 * Composite weights — how much each axis contributes to the overall
 * confidence of a composed direction. Weights live in code so that
 * "make emotion matter more" is a one-number change, not a prompt rewrite.
 * ------------------------------------------------------------------ */
export const WEIGHTS: Record<Axis, number> = {
  emotion: 0.2,
  composition: 0.13,
  effects: 0.12,
  palette: 0.14,
  typography: 0.14,
  layout: 0.1,
  motion: 0.09,
  density: 0.08,
};

/* ------------------------------------------------------------------ *
 * Answer types — the wire format.
 * ------------------------------------------------------------------ */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: Record<string, string>;
}
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionSet = Record<string, Question>;

/** Turn a candidate list into Choice criteria: id -> description. */
function criteriaFrom(candidates: { id: string; label: string; description: string }[]): Record<string, string> {
  return Object.fromEntries(candidates.map((c) => [c.id, `${c.label}. ${c.description}`]));
}

/**
 * Build the full question set for a brief.
 *
 * Speculative fan-out in practice: we ask about every axis in a single request,
 * including the guardrails, rather than making a second round-trip to discover
 * something we could have asked the first time.
 */
export function buildQuestions(): QuestionSet {
  return {
    /* ---- primary axis ---- */
    emotion: {
      type: 'choice',
      instructions:
        'What emotional response should `brief` produce in a first-time visitor within the first three seconds? ' +
        'Choose the single dominant emotion the page is built to evoke. If the brief names a feeling, weight that heavily.',
      criteria: criteriaFrom(EMOTIONS),
    },

    /* ---- structural axis: how the page is put together ---- */
    composition: {
      type: 'choice',
      instructions:
        'Which page structure best serves what `brief` describes? This decides how content is ARRANGED, not how it looks. ' +
        'Choose a structure that suits what the brief actually needs — a product with strong visuals wants a gallery, a technical ' +
        'offering wants data, an opinionated studio wants a manifesto, a general business is usually a classic stack.',
      criteria: criteriaFrom(COMPOSITIONS),
    },

    /* ---- surface treatment: the CSS effect kit ---- */
    effects: {
      type: 'choice',
      instructions:
        'Which surface treatment should this page use? This controls ornament: rules, shadows, texture, blur, borders and rotation. ' +
        'Choose the treatment that best expresses the emotional intent in `brief` and suits its subject. ' +
        'Prefer the plainer kit when the brief is about clarity or restraint.',
      criteria: criteriaFrom(EFFECT_KITS),
    },

    /* ---- supporting axes ---- */
    palette: {
      type: 'choice',
      instructions:
        'Which colour system best serves the emotional intent described in `brief`? ' +
        'Choose the ground and accent treatment the design should be built on.',
      criteria: criteriaFrom(PALETTES),
    },
    typography: {
      type: 'choice',
      instructions:
        'Which typographic voice best serves the emotional intent described in `brief`? ' +
        'Consider weight, contrast and how loudly the type speaks.',
      criteria: criteriaFrom(TYPEFACES),
    },
    layout: {
      type: 'choice',
      instructions:
        'Which layout system best serves the emotional intent described in `brief`? ' +
        'Consider how tightly structured or how open the composition should feel.',
      criteria: criteriaFrom(LAYOUTS),
    },
    motion: {
      type: 'choice',
      instructions:
        'Which motion language best serves the emotional intent described in `brief`? ' +
        'Consider pace and weight: how fast things move and how they settle.',
      criteria: criteriaFrom(MOTIONS),
    },

    /* ---- the Score axis: a degree, not a category ---- */
    density: {
      type: 'score',
      instructions: 'How much visual information should each screen carry, according to `brief`?',
      criteria: [...DENSITY_LEVELS],
    },

    /* ---- guardrails: asked up front so code can branch without a 2nd call ---- */
    wants_dark_ground: {
      type: 'noul',
      instructions:
        'Does `brief` describe or imply a dark background rather than a light one?',
      criteria: {
        true: 'Explicitly dark, night, black, deep, moody, neon, glowing',
        false: 'Light, bright, white, airy, paper, daylight, or simply not stated',
      },
    },
    needs_high_contrast: {
      type: 'noul',
      instructions:
        'Does `brief` require maximum legibility and accessibility-critical contrast, for example public sector, healthcare, finance, or an explicitly accessibility-led brief?',
      criteria: {
        true: 'Names a regulated, safety-critical or accessibility-critical context',
        false: 'No such requirement is stated',
      },
    },
  };
}

/** Axis question ids in significance order — the order decisions are composed. */
export const AXIS_QUESTION_IDS: { axis: Axis; id: string }[] = [
  { axis: 'emotion', id: 'emotion' },
  { axis: 'composition', id: 'composition' },
  { axis: 'effects', id: 'effects' },
  { axis: 'palette', id: 'palette' },
  { axis: 'typography', id: 'typography' },
  { axis: 'layout', id: 'layout' },
  { axis: 'motion', id: 'motion' },
  { axis: 'density', id: 'density' },
];

/** All candidate ids per axis — used to validate that Jev stayed in the deck. */
export const AXIS_CANDIDATE_IDS: Record<Axis, string[]> = {
  emotion: CANDIDATES.emotion.map((c) => c.id),
  composition: COMPOSITIONS.map((c) => c.id),
  effects: EFFECT_KITS.map((e) => e.id),
  palette: CANDIDATES.palette.map((c) => c.id),
  typography: CANDIDATES.typography.map((c) => c.id),
  layout: CANDIDATES.layout.map((c) => c.id),
  motion: CANDIDATES.motion.map((c) => c.id),
  density: ['quiet', 'balanced', 'dense'],
};

/** Published Jev pricing, USD per million input tokens. Output is free. */
export const JEV_USD_PER_MTOKEN_INPUT = 0.042;
