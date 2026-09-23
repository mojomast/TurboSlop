/**
 * TurboSlop — resolved design fingerprints.
 *
 * ## What this is for
 *
 * The old fingerprint described a BLUEPRINT: lead, hero, chrome, section order.
 * Two pages could share every one of those values and still read completely
 * differently — or differ by a palette swap and read identically. What a person
 * actually compares when six directions are on screen is the RESOLVED design:
 * the composition, how the headline is constructed, how big and how tightly it
 * is set, where imagery sits and at what scale, the navigation, the whitespace
 * rhythm, the surface treatment and the decorative motif.
 *
 * So a fingerprint here is a feature vector over exactly those properties, and
 * distance is a weighted mismatch over them. Three properties matter:
 *
 *  1. It is COMPUTED, never estimated. Nothing here claims to be a percentage
 *     of perceptual uniqueness — universal uniqueness is not a credible
 *     promise. What we can measure honestly is separation *within a set* and
 *     against *recent history*, and that is what these numbers are.
 *  2. It excludes copy and byte length, which differ while a page reads the
 *     same, and it separates HUE (palette/effects) from TONE so a set can be
 *     asked to differ even in grayscale.
 *  3. It is deterministic and versioned: the same inputs (version + seed +
 *     history snapshot) reproduce the same selection.
 *
 * ## Calibration
 *
 * Thresholds below (`NEAR_DUPLICATE`, `MIN_SEPARATION`, `GRAYSCALE_SEPARATION`)
 * are calibrated against rendered geometry and reviewed screenshots — see
 * `scripts/calibrate.ts` and the implementation report. They tune how hard the
 * selector pushes apart, not a claim about human perception.
 */

import type { Blueprint } from './blueprint.js';
import { typoRecipeFor, treatmentFor, type HeadlineConstruction } from './visual.js';
import { motifFamilyForEmotion, type MotifFamily } from './motifs.js';

/**
 * Versioned inputs. Any change to candidate generation, selection, feature
 * weights or thresholds must bump this: it is recorded on sessions and specs
 * so an old result can be explained and a new one reproduced.
 */
export const SELECTION_VERSION = 'turboslop/directions@2';

/* ------------------------------------------------------------------ *
 * Similarity thresholds
 *
 * Calibrated by comparing these distances against measured rendered geometry
 * (section heights, first-screen shape, hero height) for pairs of real pages.
 * ------------------------------------------------------------------ */
/** Two resolved designs at or below this distance are near-duplicates. */
export const NEAR_DUPLICATE = 0.06;
/** Minimum distance between two members of one direction set. */
export const MIN_SEPARATION = 0.2;
/** Minimum distance with colour removed (composition + type + tone only). */
export const GRAYSCALE_SEPARATION = 0.16;
/** Minimum distance from a recent design in project history. */
export const HISTORY_SEPARATION = 0.17;

/* ------------------------------------------------------------------ *
 * The feature vector
 * ------------------------------------------------------------------ */
export interface DesignFeatures {
  /* ---- composition ------------------------------------------------ */
  lead: string;
  hero: string;
  nav: string;
  footer: string;
  columns: number;
  rhythm: string;
  /** `module:variant>module:variant>…` — the block sequence as drawn. */
  sequence: string;

  /* ---- typography ------------------------------------------------- */
  typeface: string;
  construction: HeadlineConstruction;
  alignment: string;
  labelStyle: string;
  /** Reading measure in `ch`, as a number. */
  measureCh: number;
  /** Headline scale multiplier. */
  headScale: number;
  headWeight: number;
  /** Tracking in `em`, as a number. */
  trackingEm: number;

  /* ---- imagery and surface --------------------------------------- */
  treatment: string;
  motifFamily: MotifFamily | string;
  motifRole: string;
  /** How many image slots the composition renders. */
  imageSlots: number;
  /** `native`, `texture` or `none` — how imagery is scaled where it sits. */
  imageScale: 'native' | 'texture' | 'mixed' | 'none';
  /** Light or dark ground: visible in grayscale, so it stays in both metrics. */
  tone: 'light' | 'dark';
  density: string;
  effects: string;
  motion: string;
}

export interface FeatureInput {
  blueprint: Blueprint;
  typefaceId: string;
  density: string;
  emotion: string;
  paletteBg: string;
  effects: string;
  motion: string;
  /** Slots this composition actually renders, for the scale pattern. */
  imageScales?: ('native' | 'texture')[];
}

const isLight = (hex: string): boolean => {
  const n = parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return false;
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 140;
};

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve every feature of a direction the way the renderer will draw it,
 * without rendering. Deterministic: same inputs, same vector.
 */
export function featuresOf(input: FeatureInput): DesignFeatures {
  const bp = input.blueprint;
  const typo = typoRecipeFor(input.typefaceId, bp.lead, input.density);

  const scales = input.imageScales ?? [];
  const imageScale: DesignFeatures['imageScale'] =
    scales.length === 0
      ? 'none'
      : scales.every((s) => s === 'native')
        ? 'native'
        : scales.every((s) => s === 'texture')
          ? 'texture'
          : 'mixed';

  return {
    lead: bp.lead,
    hero: bp.hero,
    nav: bp.nav,
    footer: bp.footer,
    columns: bp.grid.columns,
    rhythm: bp.rhythm,
    sequence: bp.sections.map((s) => `${s.module}:${s.variant}`).join('>'),

    typeface: input.typefaceId,
    construction: typo.construction,
    alignment: typo.alignment,
    labelStyle: typo.labelStyle,
    measureCh: num(typo.measure),
    headScale: Number(typo.scale.toFixed(3)),
    headWeight: typo.weight,
    trackingEm: Number(typo.tracking.replace('em', '')) || 0,

    treatment: treatmentFor(bp.lead, input.emotion, bp.imageSlots > 0),
    motifFamily: motifFamilyForEmotion(input.emotion),
    motifRole: motifRoleOf(bp.lead, input.density),
    imageSlots: bp.imageSlots,
    imageScale,
    tone: isLight(input.paletteBg) ? 'light' : 'dark',
    density: input.density,
    effects: input.effects,
    motion: input.motion,
  };
}

/**
 * Motif role as the visual blueprint derives it, minus the seed draw.
 *
 * The seed decides *whether* a motif is placed; the role family is a property
 * of the lead. Including the seed's coin-flip would make two otherwise
 * identical directions look artificially different, so the coarse rule is used
 * here and the seed's contribution stays in the rendered page.
 */
function motifRoleOf(lead: string, _density: string): string {
  if (lead === 'statement' || lead === 'data') return 'corner/none';
  if (lead === 'image') return 'band/none';
  return 'band|corner|none';
}

/* ------------------------------------------------------------------ *
 * Identity keys — exact-match de-duplication
 * ------------------------------------------------------------------ */
/** A stable key: identical keys are the same resolved design. */
export function fingerprintKey(f: DesignFeatures): string {
  return [
    f.lead, f.hero, f.nav, f.footer, f.columns, f.rhythm, f.sequence,
    f.typeface, f.construction, f.alignment, f.labelStyle,
    f.measureCh, f.headScale, f.headWeight, f.trackingEm.toFixed(3),
    f.treatment, f.motifFamily, f.imageSlots, f.imageScale,
    f.tone, f.density, f.effects, f.motion,
  ].join('|');
}

/* ------------------------------------------------------------------ *
 * Distance
 * ------------------------------------------------------------------ */
/** Ordered-sequence distance: 0 identical, 1 disjoint. Uses LCS length. */
function sequenceDistance(a: string, b: string): number {
  if (a === b) return 0;
  const x = a.split('>');
  const y = b.split('>');
  // Longest common subsection — small lists, so the quadratic table is free.
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i]![j] = x[i - 1] === y[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const lcs = dp[x.length]![y.length]!;
  return 1 - (2 * lcs) / (x.length + y.length);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

interface Term {
  weight: number;
  /** Grayscale visibility: false when the property is hue-only. */
  gray: boolean;
  d: (a: DesignFeatures, b: DesignFeatures) => number;
}

const eq = (a: string, b: string) => (a === b ? 0 : 1);

/**
 * The weighted feature set. Weights sum to 1 before normalisation and are
 * owned HERE, so "structure matters more than tracking" is a number a reviewer
 * can see rather than the output of a model.
 *
 * Weights were CALIBRATED against rendered geometry (scripts/calibrate.ts):
 * pages whose section sequences differ measure ~0.40 apart vertically while
 * chrome-only differences barely move the render, so the block sequence carries
 * the largest single weight and nav/footer/grid carry little.
 *
 * `gray: false` marks hue-only terms — dropped for the grayscale comparison.
 * Motion is dropped too: it is invisible in a still screenshot.
 */
const TERMS: Term[] = [
  /* composition — 0.44 */
  { weight: 0.09, gray: true, d: (a, b) => eq(a.lead, b.lead) },
  { weight: 0.06, gray: true, d: (a, b) => eq(a.hero, b.hero) },
  { weight: 0.18, gray: true, d: (a, b) => sequenceDistance(a.sequence, b.sequence) },
  { weight: 0.03, gray: true, d: (a, b) => eq(a.nav, b.nav) },
  { weight: 0.03, gray: true, d: (a, b) => eq(a.footer, b.footer) },
  { weight: 0.015, gray: true, d: (a, b) => (a.columns === b.columns ? 0 : 1) },
  { weight: 0.035, gray: true, d: (a, b) => eq(a.rhythm, b.rhythm) },

  /* typography — 0.27 */
  { weight: 0.09, gray: true, d: (a, b) => eq(a.construction, b.construction) },
  { weight: 0.05, gray: true, d: (a, b) => eq(a.typeface, b.typeface) },
  { weight: 0.035, gray: true, d: (a, b) => clamp01(Math.abs(a.measureCh - b.measureCh) / 30) },
  { weight: 0.045, gray: true, d: (a, b) => clamp01(Math.abs(a.headScale - b.headScale) / 0.6) },
  { weight: 0.03, gray: true, d: (a, b) => eq(a.alignment, b.alignment) },
  { weight: 0.02, gray: true, d: (a, b) => eq(a.labelStyle, b.labelStyle) },
  { weight: 0.02, gray: true, d: (a, b) => clamp01(Math.abs(a.headWeight - b.headWeight) / 500) },

  /* imagery and surface — 0.32 */
  { weight: 0.08, gray: true, d: (a, b) => eq(a.treatment, b.treatment) },
  { weight: 0.04, gray: true, d: (a, b) => eq(a.motifFamily, b.motifFamily) },
  { weight: 0.02, gray: true, d: (a, b) => eq(a.motifRole, b.motifRole) },
  { weight: 0.035, gray: true, d: (a, b) => clamp01(Math.abs(a.imageSlots - b.imageSlots) / 7) },
  { weight: 0.03, gray: true, d: (a, b) => eq(a.imageScale, b.imageScale) },
  { weight: 0.04, gray: true, d: (a, b) => eq(a.tone, b.tone) },
  { weight: 0.03, gray: true, d: (a, b) => eq(a.density, b.density) },
  { weight: 0.05, gray: false, d: (a, b) => eq(a.effects, b.effects) },
  { weight: 0.025, gray: false, d: (a, b) => eq(a.motion, b.motion) },
];

function weighted(a: DesignFeatures, b: DesignFeatures, grayOnly: boolean): number {
  let sum = 0;
  let total = 0;
  for (const t of TERMS) {
    if (grayOnly && !t.gray) continue;
    sum += t.weight * clamp01(t.d(a, b));
    total += t.weight;
  }
  return total > 0 ? Number((sum / total).toFixed(4)) : 0;
}

/**
 * Full distance, 0..1. 0 means the same resolved design; larger means further
 * apart *on these measured properties*. It is not a probability and not a
 * claim about how different two pages look to a person.
 */
export function featureDistance(a: DesignFeatures, b: DesignFeatures): number {
  return weighted(a, b, false);
}

/**
 * Distance with hue-only terms removed: does the set differ even in grayscale?
 * Composition, typography, imagery scale, motif and tone all still count.
 */
export function grayscaleDistance(a: DesignFeatures, b: DesignFeatures): number {
  return weighted(a, b, true);
}

/* ------------------------------------------------------------------ *
 * Set-level diversity — what a batch is asked to achieve
 * ------------------------------------------------------------------ */
export interface DiversityTargets {
  directions: number;
  /** Distinct resolved compositions (sequence + hero + chrome). */
  compositions: number;
  /** Distinct headline constructions. */
  constructions: number;
  /** Distinct image treatments. */
  treatments: number;
  /** Members at least `GRAYSCALE_SEPARATION` from the first (best-fit) one. */
  grayscaleDistinct: number;
}

export interface DiversityAchieved {
  directions: number;
  compositions: number;
  constructions: number;
  treatments: number;
  grayscaleDistinct: number;
  /** Smallest full distance between any two members. */
  minSeparation: number;
  /** Smallest grayscale distance between any two members. */
  minGrayscaleSeparation: number;
}

export interface DiversityShortfall {
  target: keyof DiversityTargets;
  wanted: number;
  got: number;
  reason: string;
}

export interface DiversityReport {
  targets: DiversityTargets;
  achieved: DiversityAchieved;
  shortfall: DiversityShortfall[];
  /** True when every target was met. */
  met: boolean;
}

/**
 * Targets for a set.
 *
 * `explore` is the dial: at 0 the set is fit-first and the targets are the
 * floor a good set reaches anyway; at 1 this asks for the full spread — six
 * directions, four compositions, three headline constructions, three visual
 * treatments, and several members that still differ in grayscale. These are
 * evaluation targets, never a licence to violate the brief: locks, a dark-ground
 * guardrail or a coherence floor may make a target unreachable, and the report
 * says so rather than padding the set with pages that fit badly.
 */
export function targetsFor(count: number, explore: number): DiversityTargets {
  const e = clamp01(explore);
  const scale = (full: number, floor: number) => Math.round(floor + (full - floor) * e);
  return {
    directions: count,
    compositions: scale(4, 2),
    constructions: scale(3, 1),
    treatments: scale(3, 1),
    grayscaleDistinct: scale(Math.min(4, count - 2), Math.min(2, count - 2)),
  };
}

const compositionId = (f: DesignFeatures) => [f.lead, f.hero, f.nav, f.footer, f.columns, f.rhythm, f.sequence].join('|');

/**
 * Measure a selected set against its targets.
 *
 * `reasons` lets the caller explain a shortfall (locked blueprint, coherence
 * floor, starved pool) instead of silently missing it.
 */
export function reportDiversity(
  features: DesignFeatures[],
  targets: DiversityTargets,
  reasons: Partial<Record<keyof DiversityTargets, string>> = {},
): DiversityReport {
  const compositions = new Set(features.map(compositionId));
  const constructions = new Set(features.map((f) => f.construction));
  const treatments = new Set(features.map((f) => f.treatment));
  const leader = features[0];
  const grayscaleDistinct = leader
    ? features.filter((f, i) => i === 0 || grayscaleDistance(leader, f) >= GRAYSCALE_SEPARATION).length
    : 0;

  let minSeparation = 1;
  let minGrayscaleSeparation = 1;
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      minSeparation = Math.min(minSeparation, featureDistance(features[i]!, features[j]!));
      minGrayscaleSeparation = Math.min(minGrayscaleSeparation, grayscaleDistance(features[i]!, features[j]!));
    }
  }
  if (features.length < 2) {
    minSeparation = 1;
    minGrayscaleSeparation = 1;
  }

  const achieved: DiversityAchieved = {
    directions: features.length,
    compositions: compositions.size,
    constructions: constructions.size,
    treatments: treatments.size,
    grayscaleDistinct,
    minSeparation: Number(minSeparation.toFixed(4)),
    minGrayscaleSeparation: Number(minGrayscaleSeparation.toFixed(4)),
  };

  const shortfall: DiversityShortfall[] = [];
  const check = (target: keyof DiversityTargets, got: number) => {
    const want = targets[target];
    if (got < want) {
      shortfall.push({
        target,
        wanted: want,
        got,
        reason: reasons[target] ?? 'the candidate pool under the brief and its locks contained no eligible option',
      });
    }
  };
  check('compositions', achieved.compositions);
  check('constructions', achieved.constructions);
  check('treatments', achieved.treatments);
  check('grayscaleDistinct', achieved.grayscaleDistinct);

  return { targets, achieved, shortfall, met: shortfall.length === 0 };
}
