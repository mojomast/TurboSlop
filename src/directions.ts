/**
 * TurboSlop — direction selection.
 *
 * A single decision call produced a single argmax per axis, which is why every
 * page came out as a member of one family. Jev already returns a full
 * probability distribution for each axis; those ranked alternatives — plus
 * bounded variation of the layout blueprint itself — are the raw material for
 * several genuinely different directions.
 *
 * ## What a fit score is, and is not
 *
 * `fit` is a WEIGHTED SUM of independent per-axis probabilities plus a
 * structural term. It is a heuristic ranking device, **not** a calibrated
 * probability for a whole page. The axes are chosen independently by the
 * model, and treating the product (or sum) of their marginals as a joint
 * probability would be meaningless.
 *
 * ## What diversity is, here
 *
 * Diversity is an ENFORCED property of the selected set, measured on resolved
 * design fingerprints (`fingerprint.ts`): composition, headline construction,
 * typography proportions, image placement and scale, navigation, whitespace,
 * rhythm, surface treatment and motif. The selector:
 *
 *   1. keeps one strong best-fit option as the first direction;
 *   2. adds purposeful alternatives under an explicit minimum separation, with
 *      coverage bonuses for headline constructions, compositions and visual
 *      treatments the set does not have yet;
 *   3. rejects near-duplicates explicitly (same key, or below
 *      `NEAR_DUPLICATE` distance) and rejects candidates that repeat a recent
 *      design from project history;
 *   4. REPORTS any shortfall against the explore targets with the reason —
 *      locks, a dark-ground guardrail, a coherence floor or a starved pool may
 *      make a target unreachable, and padding the set with pages that fit the
 *      brief badly is not an option.
 *
 * The search is bounded: structures × styling is capped, and every stage is
 * deterministic for (version, inputs, seed, history snapshot).
 */
import {
  BLUEPRINTS,
  imageSlotsFor,
  resolveBlueprint,
  varyBlueprint,
  type Blueprint,
  type Lead,
  type ModuleId,
} from './blueprint.js';
import {
  GRAYSCALE_SEPARATION,
  HISTORY_SEPARATION,
  MIN_SEPARATION,
  NEAR_DUPLICATE,
  SELECTION_VERSION,
  featureDistance,
  featuresOf,
  fingerprintKey,
  grayscaleDistance,
  reportDiversity,
  targetsFor,
  type DesignFeatures,
  type DiversityReport,
  type DiversityTargets,
} from './fingerprint.js';
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
  /** Stable identity: derived from the direction's own inputs, not its slot. */
  id: string;
  /** The resolved layout (base blueprint or a bounded variant of it). */
  blueprint: Blueprint;
  /** The catalog blueprint this layout started from. */
  baseBlueprint: string;
  palette: string;
  typography: string;
  effects: string;
  motion: string;
  density: string;
  /** Heuristic fit, 0..1. A weighted sum of probabilities — not a chance. */
  fit: number;
  /**
   * Distance from the closest earlier direction in the set, on the measured
   * feature vector. Larger = further apart on these properties. Not a
   * percentage of perceptual uniqueness.
   */
  novelty: number;
  /** One line a human can read, explaining the pick. */
  rationale: string;
  /** Resolved design fingerprint — what the set's diversity is measured on. */
  features: DesignFeatures;
  /** Composition identity: lead + hero + chrome + rhythm + block sequence. */
  composition: string;
}

/* ------------------------------------------------------------------ *
 * Locks
 * ------------------------------------------------------------------ */
export const LOCK_NAMES = [
  'blueprint',
  'composition',
  'palette',
  'typography',
  'effects',
  'motion',
  'density',
] as const;
export type LockName = (typeof LOCK_NAMES)[number];

/** A lock bound to an explicit value (and, in the session, a source card). */
export interface SelectionLock {
  name: LockName;
  value: string;
}

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockError';
  }
}

const CATALOG_VALUES: Record<string, ReadonlySet<string>> = {
  palette: new Set(PALETTES.map((x) => x.id)),
  typography: new Set(TYPEFACES.map((x) => x.id)),
  effects: new Set(EFFECT_KITS.map((x) => x.id)),
  motion: new Set(MOTIONS.map((x) => x.id)),
  density: new Set(DENSITY_IDS as unknown as string[]),
};

/**
 * Validate lock names and values.
 *
 * Unknown names are REJECTED with the list of what can be locked — silently
 * ignoring a lock is how "I locked the palette and it changed" bugs happen.
 */
export function validateLocks(locks: SelectionLock[]): void {
  const seen = new Set<string>();
  for (const lock of locks) {
    if (!LOCK_NAMES.includes(lock.name)) {
      throw new LockError(
        `unknown lock "${String(lock.name)}" — this version can lock: ${LOCK_NAMES.join(', ')} (${SELECTION_VERSION})`,
      );
    }
    if (seen.has(lock.name)) throw new LockError(`lock "${lock.name}" was supplied more than once`);
    seen.add(lock.name);
    const allowed = CATALOG_VALUES[lock.name];
    if (allowed && !allowed.has(lock.value)) {
      throw new LockError(`lock "${lock.name}" value "${lock.value}" is not in the catalog (have: ${[...allowed].join(', ')})`);
    }
    if (lock.name === 'blueprint' && !BLUEPRINTS.some((b) => b.id === lock.value)) {
      throw new LockError(`lock "blueprint" value "${lock.value}" is not a blueprint id`);
    }
    if (lock.name === 'composition' && !resolveBlueprint(lock.value)) {
      throw new LockError(`lock "composition" value "${lock.value}" does not resolve to a layout`);
    }
  }
  /* Compatibility: a composition IS a layout, so it implies its blueprint.
     Locking the composition of one card and the blueprint of a different,
     unrelated card cannot both hold — say which, rather than picking one. */
  const composition = locks.find((l) => l.name === 'composition');
  const blueprint = locks.find((l) => l.name === 'blueprint');
  if (composition && blueprint) {
    const resolved = resolveBlueprint(composition.value);
    const base = resolved ? baseOf(resolved.id) : null;
    if (base && base !== blueprint.value) {
      throw new LockError(
        `incompatible locks: composition "${composition.value}" belongs to blueprint "${base}", not the locked blueprint "${blueprint.value}" — drop one or lock both from the same card`,
      );
    }
  }
}

/** The catalog blueprint a (possibly varied) blueprint id descends from. */
export function baseOf(id: string): string {
  const v = /^([a-z0-9-]+)~[0-9a-f]+[0-4]$/.exec(id);
  return v ? v[1]! : id;
}

/* ------------------------------------------------------------------ *
 * Brief-to-blueprint fit
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
  other: ['statement', 'product', 'catalogue', 'story', 'date', 'data', 'image', 'offer'],
};

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

/** Which bundled voice a typeface sets its headlines in. Mirrors visual.ts. */
const TYPEFACE_VOICE: Record<string, string> = {
  'grotesk-tight': 'poster',
  'condensed-heavy': 'poster',
  'editorial-serif': 'literary',
  'geometric-open': 'friendly',
  'rounded-friendly': 'friendly',
  'mono-technical': 'technical',
  'humanist-light': 'restrained',
};

/* ------------------------------------------------------------------ *
 * Coherence
 * ------------------------------------------------------------------ */
function coherencePenalty(
  emotion: string,
  picks: { palette: string; typography: string; effects: string; motion: string },
): number {
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
 * Bounds — the search is finite and says so
 * ------------------------------------------------------------------ */
/** Distinct styling combinations scored per structure. */
export const MAX_STYLING = 48;
/** Total candidates considered, however the pools multiply out. */
export const MAX_CANDIDATES = 2400;
/** Bounded blueprint variants considered per base blueprint (plus the base). */
const MAX_VARIANTS = 2;

export interface BuildOptions {
  brief: string;
  distributions: Distributions;
  count: number;
  seed: number;
  wantsDark?: boolean;
  /** Fit-first (0) <-> explore (1) dial. Also drives the diversity targets. */
  explore?: number;
  /** Weight of the similarity penalty in selection. Default 0.65. */
  diversity?: number;
  /**
   * Recent RESOLVED design fingerprints (project history, snapshotted before
   * selection). Candidates this close to history are rejected so a project
   * stops converging on one page — with an explicit starvation escape, because
   * a repeat that fits the brief is better than no page at all.
   */
  history?: DesignFeatures[];
  /**
   * Modules the available content can honestly fill. Candidates that need
   * anything else are dropped: a diversity target never justifies a pricing
   * table with no prices or an empty gallery.
   */
  availableModules?: ReadonlySet<ModuleId>;
  /** Locks applied DURING selection (constrained search), not patched on. */
  locks?: SelectionLock[];
}

export interface BuildStats {
  /** Structurally distinct layouts considered. */
  structures: number;
  /** Candidates generated (bounded by MAX_CANDIDATES). */
  generated: number;
  /** After exact-key de-duplication. */
  unique: number;
  /** After explicit near-duplicate rejection. */
  afterNearDuplicate: number;
  /** After project-history separation. */
  afterHistory: number;
  /** After content-availability filtering. */
  afterContent: number;
  /** Whether the history filter had to be relaxed to avoid starving. */
  historyRelaxed: boolean;
  /** Selection stages used (1 = strict separation held for the whole set). */
  stages: number;
}

export interface BuildResult {
  directions: Direction[];
  report: DiversityReport;
  stats: BuildStats;
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
  features: DesignFeatures;
  key: string;
}

interface Styling {
  palette: string;
  typography: string;
  effects: string;
  motion: string;
  density: string;
  axisScore: number;
}

/** The bounded styling pool: top combinations by axis fit, after locks. */
function stylingPool(opts: BuildOptions): Styling[] {
  const dist = opts.distributions;
  const locks = new Map((opts.locks ?? []).map((l) => [l.name, l.value]));
  const emotionRanked = ranked(dist.emotion, optionsOf(EMOTIONS));
  const topEmotion = emotionRanked[0]?.id ?? 'other';

  const palettes = locks.has('palette')
    ? [{ id: locks.get('palette')!, p: dist.palette?.[locks.get('palette')!] ?? 1 }]
    : ranked(dist.palette, optionsOf(PALETTES)).slice(0, 4);

  /* Typefaces carry the headline CONSTRUCTION, so at high explore the pool is
     widened until it spans at least three distinct voices where the
     distribution allows it. One voice across six directions is one
     typographic idea wearing six colours. */
  const typeAll = ranked(dist.typography, optionsOf(TYPEFACES));
  const wantedVoices = (opts.explore ?? 0.45) >= 0.5 ? 3 : 2;
  let types: { id: string; p: number }[];
  if (locks.has('typography')) {
    types = [{ id: locks.get('typography')!, p: dist.typography?.[locks.get('typography')!] ?? 1 }];
  } else {
    types = [];
    const voices = new Set<string>();
    for (const t of typeAll) {
      types.push(t);
      voices.add(TYPEFACE_VOICE[t.id] ?? t.id);
      if (types.length >= 6 || (voices.size >= wantedVoices && types.length >= 4)) break;
    }
  }

  const effects = locks.has('effects')
    ? [{ id: locks.get('effects')!, p: dist.effects?.[locks.get('effects')!] ?? 1 }]
    : ranked(dist.effects, optionsOf(EFFECT_KITS)).slice(0, 4);
  const motions = locks.has('motion')
    ? [{ id: locks.get('motion')!, p: dist.motion?.[locks.get('motion')!] ?? 1 }]
    : ranked(dist.motion, optionsOf(MOTIONS)).slice(0, 3);
  const densities = locks.has('density')
    ? [{ id: locks.get('density')!, p: 1 }]
    : DENSITY_IDS.map((id, i) => ({ id, p: dist.density?.[String(i)] ?? 0 }));

  const bestPossible =
    WEIGHTS.emotion * (emotionRanked[0]?.p ?? 0) +
    WEIGHTS.palette * (palettes[0]?.p ?? 0) +
    WEIGHTS.typography * (types[0]?.p ?? 0) +
    WEIGHTS.effects * (effects[0]?.p ?? 0) +
    WEIGHTS.motion * (motions[0]?.p ?? 0) +
    WEIGHTS.density * (densities[0]?.p ?? 0);
  const normalise = bestPossible > 0 ? 1 / bestPossible : 1;

  const out: Styling[] = [];
  for (const pal of palettes) {
    if (opts.wantsDark && isLight(PALETTE_BG[pal.id] ?? '#ffffff')) continue;
    for (const typ of types) {
      for (const eff of effects) {
        for (const mot of motions) {
          for (const den of densities) {
            const penalty = coherencePenalty(topEmotion, {
              palette: pal.id,
              typography: typ.id,
              effects: eff.id,
              motion: mot.id,
            });
            if (penalty >= 3) continue; // three or four misses is noise, not a direction
            const raw =
              WEIGHTS.emotion * (emotionRanked[0]?.p ?? 0) +
              WEIGHTS.palette * pal.p +
              WEIGHTS.typography * typ.p +
              WEIGHTS.effects * eff.p +
              WEIGHTS.motion * mot.p +
              WEIGHTS.density * den.p -
              penalty * 0.04;
            out.push({
              palette: pal.id,
              typography: typ.id,
              effects: eff.id,
              motion: mot.id,
              density: den.id,
              axisScore: Math.max(0, raw * normalise),
            });
          }
        }
      }
    }
  }
  out.sort((a, b) => b.axisScore - a.axisScore || `${a.palette}${a.typography}`.localeCompare(`${b.palette}${b.typography}`));

  /* The bounded slice must SPAN THE TYPEFACES, not fill up with one
     typeface's motion/density permutations. Round-robin across typeface
     groups (each group in score order): with 48 slots and ≤7 typefaces,
     every pooled face — and therefore its headline construction — is
     represented, and selection's coverage bonus can then choose between
     constructions. Under a composition+palette lock this is the difference
     between six cards that differ only in motion and six that differ in
     their headline construction. */
  const byType = new Map<string, Styling[]>();
  for (const s of out) {
    const list = byType.get(s.typography) ?? [];
    list.push(s);
    byType.set(s.typography, list);
  }
  const groups = [...byType.values()].sort(
    (a, b) => (b[0]?.axisScore ?? 0) - (a[0]?.axisScore ?? 0) || (a[0]?.typography ?? '').localeCompare(b[0]?.typography ?? ''),
  );
  const interleaved: Styling[] = [];
  for (let i = 0; interleaved.length < MAX_STYLING; i++) {
    let added = false;
    for (const group of groups) {
      const next = group[i];
      if (!next) continue;
      if (interleaved.length >= MAX_STYLING) break;
      interleaved.push(next);
      added = true;
    }
    if (!added) break;
  }
  return interleaved;
}

/**
 * The structural pool: base blueprints plus bounded variants.
 *
 * Under a `composition` lock exactly one layout is offered — the lock is a
 * constraint on the SEARCH, not a patch applied afterwards. Under a
 * `blueprint` lock only that catalog blueprint (and its bounded variants) is
 * considered.
 */
function structurePool(opts: BuildOptions): Blueprint[] {
  const locks = new Map((opts.locks ?? []).map((l) => [l.name, l.value]));
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.45));

  if (locks.has('composition')) {
    const locked = resolveBlueprint(locks.get('composition')!);
    return locked ? [locked] : [];
  }

  let bases = BLUEPRINTS;
  const blueprintLock = locks.get('blueprint');
  if (blueprintLock) bases = bases.filter((b) => b.id === blueprintLock);
  if (!bases.length) return [];

  const variants = explore < 0.25 ? 0 : explore < 0.65 ? 1 : MAX_VARIANTS;
  const out: Blueprint[] = [];
  for (const [i, bp] of bases.entries()) {
    out.push(bp);
    for (let v = 0; v < variants; v++) {
      /* Variant seeds derive from (session seed, base index, variant slot) —
         stable direction-specific seeds, so a batch does not inherit one
         decoration and two runs of the same seed reproduce the same layouts. */
      const vseed = (opts.seed * 2654435761 + i * 40503 + (v + 1) * 97) >>> 0;
      out.push(varyBlueprint(bp, vseed, { explore }));
    }
  }
  return out;
}

function buildCandidates(opts: BuildOptions): Candidate[] {
  const structures = structurePool(opts);
  const styling = stylingPool(opts);
  if (!structures.length || !styling.length) return [];

  const emotionRanked = ranked(opts.distributions.emotion, optionsOf(EMOTIONS));
  const topEmotion = emotionRanked[0]?.id ?? 'other';
  const briefWords = new Set(words(opts.brief ?? ''));
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.45));

  /* Bound the cross product: every structure gets its share of the styling
     pool, rotated so two structures do not always share the same top look. */
  const perStructure = Math.max(6, Math.min(styling.length, Math.floor(MAX_CANDIDATES / structures.length)));

  const out: Candidate[] = [];
  for (const [si, bp] of structures.entries()) {
    const scales = imageSlotsFor(bp).map((s) => s.scale);
    const structureFit =
      0.7 * leadScore(topEmotion, bp.lead, explore) + 0.3 * lexicalScore(briefWords, bp);

    for (let k = 0; k < perStructure; k++) {
      const st = styling[(si * 7 + k) % styling.length]!;
      /* `axisScore` is already normalised against the best the distributions
         allow (see stylingPool). Structure carries the larger share: the axes
         say how well the STYLING matches, not whether this is the right KIND
         of page for the brief. */
      const fit = 0.45 * st.axisScore + 0.55 * structureFit;
      const features = featuresOf({
        blueprint: bp,
        typefaceId: st.typography,
        density: st.density,
        emotion: topEmotion,
        paletteBg: PALETTE_BG[st.palette] ?? '#ffffff',
        effects: st.effects,
        motion: st.motion,
        imageScales: scales,
      });
      out.push({
        blueprint: bp,
        palette: st.palette,
        typography: st.typography,
        effects: st.effects,
        motion: st.motion,
        density: st.density,
        fit: Number(fit.toFixed(4)),
        emotion: topEmotion,
        features,
        key: fingerprintKey(features),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * De-duplication
 * ------------------------------------------------------------------ */
/**
 * Exact-key de-duplication, then EXPLICIT near-duplicate rejection.
 *
 * Candidates are grouped by their block sequence so the pairwise distance
 * check stays bounded (a full n² pass over thousands of candidates is not
 * "bounded search" — it is a stall). Within a group, anything at or below
 * `NEAR_DUPLICATE` distance from a better-fitting kept candidate is dropped:
 * two pages that differ only in a rhythm step are one page.
 */
function dedupe(pool: Candidate[]): { kept: Candidate[]; unique: number; nearDupFree: number } {
  const seenKeys = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of pool) {
    if (seenKeys.has(c.key)) continue;
    seenKeys.add(c.key);
    unique.push(c);
  }

  const bySequence = new Map<string, Candidate[]>();
  const kept: Candidate[] = [];
  for (const c of unique) {
    const seq = c.features.sequence;
    const group = bySequence.get(seq) ?? [];
    let near = false;
    for (const k of group) {
      if (featureDistance(c.features, k.features) <= NEAR_DUPLICATE) {
        near = true;
        break;
      }
    }
    if (near) continue;
    /* One group holds the best-fitting members; the cap keeps the check cheap
       without letting a low-fit near-duplicate squat in the pool. */
    if (group.length < 64) group.push(c);
    kept.push(c);
  }
  return { kept, unique: unique.length, nearDupFree: kept.length };
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */
export function buildDirections(opts: BuildOptions): BuildResult {
  const rand = mulberry32(opts.seed);
  const wanted = Math.max(1, Math.min(8, opts.count));
  const lambda = opts.diversity ?? 0.65;
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.45));
  const history = opts.history ?? [];

  const raw = buildCandidates(opts);
  const { kept, unique, nearDupFree } = dedupe(raw);

  /* ---- project history: reject recent repeats, escape starvation ---- */
  const historyPass = (c: Candidate) =>
    !history.some((h) => featureDistance(c.features, h) < HISTORY_SEPARATION);
  let pool = kept.filter(historyPass);
  let historyRelaxed = false;
  if (pool.length < wanted && kept.length >= wanted) {
    pool = kept; // a repeat that fits beats having nothing to show
    historyRelaxed = history.length > 0;
  }

  /* ---- content compatibility: never render what cannot be filled ---- */
  let afterContent = pool;
  if (opts.availableModules) {
    afterContent = pool.filter((c) =>
      c.blueprint.sections.every((s) => opts.availableModules!.has(s.module)),
    );
    if (!afterContent.length) afterContent = pool; // nothing is renderable as-is: say so via the report
  }

  /* Deterministic shuffle so equal-fit candidates do not always win in
     catalog order, then sort by fit. */
  for (let i = afterContent.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = afterContent[i]!;
    afterContent[i] = afterContent[j]!;
    afterContent[j] = tmp;
  }
  afterContent.sort((a, b) => b.fit - a.fit);

  const stats: BuildStats = {
    structures: new Set(raw.map((c) => c.blueprint.id)).size,
    generated: raw.length,
    unique,
    afterNearDuplicate: nearDupFree,
    afterHistory: pool.length,
    afterContent: afterContent.length,
    historyRelaxed,
    stages: 1,
  };

  if (!afterContent.length) {
    return {
      directions: [],
      report: reportDiversity([], targetsFor(wanted, explore), {
        compositions: 'no candidate survived the brief, locks, history and content constraints',
        constructions: 'no candidate survived the brief, locks, history and content constraints',
        treatments: 'no candidate survived the brief, locks, history and content constraints',
        grayscaleDistinct: 'no candidate survived the brief, locks, history and content constraints',
      }),
      stats,
    };
  }

  const bestFit = afterContent[0]!.fit;
  const floor = bestFit * 0.55;
  const targets = targetsFor(wanted, explore);

  const compositionOf = (c: Candidate) =>
    [c.features.lead, c.features.hero, c.features.nav, c.features.footer, c.features.columns,
     c.features.rhythm, c.features.sequence].join('|');

  /* Coverage bonus: how much a candidate gives the SET something it lacks. */
  const coverage = (
    c: Candidate,
    leader: DesignFeatures,
    have: { compositions: Set<string>; constructions: Set<string>; treatments: Set<string> },
  ): number => {
    let b = 0;
    if (!have.compositions.has(compositionOf(c))) b += 0.1;
    if (!have.constructions.has(c.features.construction)) b += 0.12;
    if (!have.treatments.has(c.features.treatment)) b += 0.1;
    if (grayscaleDistance(leader, c.features) >= GRAYSCALE_SEPARATION) b += 0.06;
    return b * explore;
  };

  /* Escalating relaxation. Separation is a promise the first pass keeps;
     later passes trade it for a count only when nothing else qualifies. */
  const stages = [
    { sep: MIN_SEPARATION, gray: GRAYSCALE_SEPARATION, bonusScale: 1 },
    { sep: MIN_SEPARATION, gray: GRAYSCALE_SEPARATION * 0.5, bonusScale: 0.6 },
    { sep: MIN_SEPARATION * 0.6, gray: 0, bonusScale: 0.3 },
    { sep: 0, gray: 0, bonusScale: 0 },
  ];

  const remaining = [...afterContent];
  const selected: Candidate[] = [];
  const have = {
    compositions: new Set<string>(),
    constructions: new Set<string>(),
    treatments: new Set<string>(),
  };
  const leader = afterContent[0]!.features;

  /* The best-fit option always leads: the set must contain the page this
     brief most wants, or the alternatives are alternatives to nothing. */
  const first = remaining.shift()!;
  selected.push(first);
  have.compositions.add(compositionOf(first));
  have.constructions.add(first.features.construction);
  have.treatments.add(first.features.treatment);

  let stage = 0;
  while (selected.length < wanted && remaining.length && stage < stages.length) {
    const s = stages[stage]!;
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      if (selected.length > 0 && c.fit < floor) continue; // never pad with a bad fit
      let minDist = Infinity;
      let ok = true;
      for (const p of selected) {
        const d = featureDistance(c.features, p.features);
        if (d < s.sep) ok = false;
        if (s.gray > 0 && grayscaleDistance(c.features, p.features) < s.gray) ok = false;
        minDist = Math.min(minDist, d);
      }
      if (!ok) continue;
      /* Penalty is closeness to the CLOSEST member: far from everything costs
         nothing, one step from an existing direction costs the most. */
      const score = c.fit - lambda * (1 - (Number.isFinite(minDist) ? minDist : 0)) + coverage(c, leader, have) * s.bonusScale;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      stage++;
      stats.stages = stage + 1;
      continue;
    }
    const chosenOne = remaining[bestIdx]!;
    remaining.splice(bestIdx, 1);
    selected.push(chosenOne);
    have.compositions.add(compositionOf(chosenOne));
    have.constructions.add(chosenOne.features.construction);
    have.treatments.add(chosenOne.features.treatment);
  }

  /* Shortfall reasons, so a miss is explained rather than hidden. */
  const reasons: Partial<Record<keyof DiversityTargets, string>> = {};
  const lockNames = (opts.locks ?? []).map((l) => l.name);
  const structureLocked = lockNames.includes('composition') || lockNames.includes('blueprint');
  const lockedLead = selected[0]?.features.lead;
  const leadForcesConstruction =
    lockedLead === 'image' || lockedLead === 'offer' ? 'outline' : lockedLead === 'data' ? 'caps' : null;

  /* Constraint-aware targets. A composition/blueprint lock ASKS for one
     composition, and a fixed lead can force the headline construction and the
     imagery treatment outright. Targets are clamped to what the constraints
     allow — never the other way round: nothing is ever added to a set just to
     hit a number. */
  if (structureLocked && selected.length) {
    targets.compositions = 1;
    targets.treatments = 1; // (lead, emotion, imagery) fully determine it
    if (leadForcesConstruction) targets.constructions = 1;
  }

  if (lockNames.length) {
    const names = lockNames.join(', ');
    const lockedNote = `locked: ${names} — constrained selection cannot move a locked axis`;
    reasons.compositions = lockedNote;
    reasons.constructions = leadForcesConstruction
      ? `the locked ${lockedLead}-led first screen sets a "${leadForcesConstruction}" headline construction for every card`
      : lockedNote;
    reasons.treatments = `the locked ${lockedLead} composition draws its imagery in a single treatment (one lead, one emotion)`;
    reasons.grayscaleDistinct = `with ${names} pinned, the remaining axes cannot separate this set far enough in grayscale`;
  } else if (stage > 0) {
    const why =
      'the fit floor stopped the set growing — no remaining candidate was both far enough apart and a good enough fit for this brief';
    reasons.compositions = why;
    reasons.constructions = why;
    reasons.treatments = why;
    reasons.grayscaleDistinct = why;
  } else if (stats.afterContent < wanted * 2) {
    const why = `only ${stats.afterContent} candidates survived history separation and content availability`;
    reasons.compositions = why;
    reasons.constructions = why;
    reasons.treatments = why;
    reasons.grayscaleDistinct = why;
  }
  if (historyRelaxed) {
    const note = 'project history separation was relaxed: the recent-fingerprint filter would have starved the set';
    reasons.compositions = reasons.compositions ?? note;
    reasons.grayscaleDistinct = reasons.grayscaleDistinct ?? note;
  }

  const features = selected.map((c) => c.features);
  const report = reportDiversity(features, targets, reasons);

  const directions = selected.map((c, i) => {
    const novelty =
      i === 0
        ? 1
        : Number(Math.min(...selected.slice(0, i).map((p) => featureDistance(c.features, p.features))).toFixed(3));
    /* Stable identity: a direction's id comes from its OWN inputs, so it does
       not change when a sibling is added, removed or reordered. */
    const id = `dir_${fnv(
      `${c.blueprint.id}|${c.palette}|${c.typography}|${c.effects}|${c.motion}|${c.density}|${opts.seed}|${c.key}`,
    ).toString(16)}`;
    return {
      id,
      blueprint: c.blueprint,
      baseBlueprint: baseOf(c.blueprint.id),
      palette: c.palette,
      typography: c.typography,
      effects: c.effects,
      motion: c.motion,
      density: c.density,
      fit: c.fit,
      novelty: i === 0 ? 1 : novelty,
      rationale:
        i === 0
          ? `Best fit: ${c.blueprint.label} — ${c.features.construction} headline, ${c.features.treatment} imagery, ${c.palette}/${c.effects}.`
          : `${c.blueprint.label} — separation ${novelty.toFixed(2)} from the closest earlier direction ` +
            `(${c.features.construction} headline, ${c.features.treatment} treatment), fit ${c.fit.toFixed(3)}.`,
      features: c.features,
      composition: compositionOf(c),
    } satisfies Direction;
  });

  return { directions, report, stats };
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
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

export { SELECTION_VERSION, NEAR_DUPLICATE, MIN_SEPARATION, GRAYSCALE_SEPARATION, HISTORY_SEPARATION };
export type { DesignFeatures, DiversityReport };
