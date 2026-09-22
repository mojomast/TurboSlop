/**
 * TurboSlop — scoped revision.
 *
 * A revision is a change to the design you ALREADY CHOSE. It is not a
 * re-decision, not a re-selection and not a fresh generation: the resolved
 * spec is the input, and only what the request actually names is allowed to
 * move.
 *
 * The regression this file exists to prevent: an offline request to fix some
 * punctuation came back as a different page — `data-metrics` had become
 * `story-origin`, and the palette, typography and motion had changed with it.
 * That happened because revision re-ran the whole pipeline. Here:
 *
 *   - scope is CLASSIFIED first, and copy is the safe default — a wording
 *     request can never reach a visual axis;
 *   - copy scope preserves layout, styling, seed and assets byte-for-byte;
 *   - visual scope edits only the catalog axes the request names, starting
 *     from the SELECTED tokens (what the page actually uses), never the
 *     decider's original argmax metadata;
 *   - anything it cannot map into the catalog is reported and left alone,
 *     because the catalog is the only vocabulary this tool can speak.
 */
import { EFFECT_KITS, MOTIONS, PALETTES, TYPEFACES } from './catalog.js';
import type { Axis, DesignSpec } from './types.js';

export type RevisionScope = 'copy' | 'visual' | 'mixed';

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */
const VISUAL_RE = new RegExp(
  [
    'colou?rs?', 'palette', '\\bdark(er)?\\b', '\\blight(er)?\\b', '\\bblack\\b', '\\bwhite\\b',
    'background', 'ground', 'font', 'typeface', 'typograph', 'serif', 'mono(space)?',
    'spacing', 'margin', 'padding', 'whitespace', '\\blayout\\b', '\\bgrid\\b', '\\bsystem\\b',
    'motion', 'animat', 'transition', 'hover', 'rounded', 'corner', 'border', 'radius',
    'gradient', 'shadow', 'texture', 'pattern', '\\bicon', '\\bframe', 'photograph', 'imagery',
    'image', 'artwork', 'motif', '\\bstyle', '\\btheme', '\\bdense\\b', 'compact', 'air(y|ier|iness)',
    'center(ed|ed)?', 'centred', 'align', 'scale', 'bigger', 'smaller', 'larger type', 'smaller type',
  ].join('|'),
  'i',
);

const COPY_RE = new RegExp(
  [
    '\\bcopy\\b', '\\btext\\b', 'wording', '\\bwords\\b', 'reword', 'rewrit', 'rename', 'punctuation',
    'sentence', 'paragraph', 'headline', 'tagline', '\\blede\\b', 'proofread', 'spelling', '\\btypo',
    'voice', '\\btone\\b', '\\bsay\\b', 'phrase', 'caption', '\\btitles?\\b', 'description',
    'brand name', '\\bcta\\b', 'call to action', 'mention', '\\bwrite\\b', '\\bworded\\b',
  ].join('|'),
  'i',
);

/**
 * Which kind of change was asked for.
 *
 * Visual wins only when visual vocabulary is actually present; with neither
 * (a vague "make it feel premium"), COPY is the safe default, because the
 * failure mode of misreading a wording request as a visual one is exactly the
 * regression this classifier was written for.
 */
export function classifyRevision(instructions: string): RevisionScope {
  const visual = VISUAL_RE.test(instructions);
  const copy = COPY_RE.test(instructions);
  if (visual && copy) return 'mixed';
  if (visual) return 'visual';
  return 'copy';
}

/* ------------------------------------------------------------------ *
 * Visual edits — catalog axes only
 * ------------------------------------------------------------------ */
interface AxisEdit {
  axis: Axis;
  value: string;
  why: string;
}

const hexLuminance = (hex: string): number => {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

type Rule = { re: RegExp; pick: (current: string) => string | null };

const PALETTE_RULES: { re: RegExp; value: string }[] = [
  { re: /acid|neon|electric|\blime\b|fluoro/i, value: 'electric-acid' },
  { re: /\blime\b|noir|dark mode|editorial-dark/i, value: 'noir-lime' },
  { re: /violet|purple|indigo/i, value: 'void-violet' },
  { re: /sage|clay|olive|botanic|garden/i, value: 'sage-mist' },
  { re: /terracotta|brick|rust|earth/i, value: 'bone-terracotta' },
  { re: /candy|pink|magenta|confection/i, value: 'candy-pop' },
  { re: /hazard|mono(chrome)?|black and white|b&w/i, value: 'hazard-mono' },
  { re: /paper|cream|aged|print/i, value: 'paper-ink' },
  { re: /steel|blue|navy|institution|financial/i, value: 'steel-signal' },
  { re: /arctic|cyan|ice|glacier/i, value: 'arctic-cyan' },
  { re: /aurora|iridescent|glass|pastel/i, value: 'aurora-glass' },
];

const TYPE_RULES: Rule[] = [
  { re: /serif|editorial face|didone/i, pick: () => 'editorial-serif' },
  { re: /mono(space)?|terminal|\bcode\b/i, pick: () => 'mono-technical' },
  { re: /condensed|heavy|impact|athletic|poster face/i, pick: () => 'condensed-heavy' },
  { re: /rounded|friendly|soft terminals|playful type/i, pick: () => 'rounded-friendly' },
  /* Type-context required: "the light ground is washed out" is a PALETTE
     sentence, and must never be read as a request for a lighter typeface. */
  {
    re: /\b(light|lighter|thin|delicate)\b(?:\s+\w+){0,3}\s+(type|typeface|font)s?\b|\b(type|typeface|font)s?\b(?:\s+\w+){0,3}\s+(light|lighter|thin|delicate)\b/i,
    pick: () => 'humanist-light',
  },
  { re: /\bgeometric|grotesk|grotesque|neo-?grotesque|\bsans\b/i, pick: () => 'geometric-open' },
];

const MOTION_RULES: Rule[] = [
  { re: /still|static|no motion|reduce(d)? motion|calm down/i, pick: () => 'glacial' },
  { re: /\bslow(er)?\b|glacial|weighty|unhurried/i, pick: () => 'glacial' },
  { re: /\bbounc|spring|playful/i, pick: () => 'springy-playful' },
  { re: /\bsnap(ped|py)?\b|instant|mechanical|immediate/i, pick: () => 'snap-mechanical' },
  { re: /kinetic|marquee|\bfast(er)?\b|energetic/i, pick: () => 'kinetic' },
  { re: /\bbuoyant\b|\blift\b|\bfloat\b|\bdrift\b/i, pick: () => 'buoyant' },
  { re: /breathe|breath|ambient|gentle|soft loop/i, pick: () => 'breath' },
];

const DENSITY_RULES: Rule[] = [
  { re: /\bdenser\b|\btight(er)?\b|\bcompact\b|more per screen/i, pick: () => 'dense' },
  { re: /\bairier\b|\bair(y|iness)\b|\bspacious\b|more whitespace|\blooser\b|\bbreathing\b/i, pick: () => 'quiet' },
  { re: /comfortable density|balanced density/i, pick: () => 'balanced' },
];

const EFFECT_RULES: Rule[] = [
  { re: /flat|minimal ornament|plainer|no decoration/i, pick: () => 'flat-plain' },
  { re: /mesh|gradient field|organic/i, pick: () => 'organic-mesh' },
  { re: /brutal|block(y)?|stencil/i, pick: () => 'brutalist-block' },
  { re: /hairline|rule(d)?|editorial rule/i, pick: () => 'hairline-editorial' },
  { re: /technical|drafting|engineering|blueprint/i, pick: () => 'technical-drawing' },
  { re: /soft material|paper|tactile|craft/i, pick: () => 'tactile-paper' },
  { re: /glass|frosted|luminous/i, pick: () => 'luminous-glass' },
  { re: /depth|cinematic|dimensional/i, pick: () => 'cinematic-depth' },
  { re: /pillow|soft material|material/i, pick: () => 'soft-material' },
];

export interface VisualEditResult {
  changed: { axis: string; from: string; to: string }[];
  notes: string[];
}

const inCatalog = (ids: readonly string[], value: string) => ids.includes(value);

/**
 * Apply visual edits to a resolved spec.
 *
 * Starts from `spec.tokens` — what the page actually uses — and touches only
 * axes the request names. Everything else (blueprint, seed, content, assets,
 * and the unmoved axes) is untouched by construction.
 */
export function applyVisualEdit(spec: DesignSpec, instructions: string): VisualEditResult {
  const changed: VisualEditResult['changed'] = [];
  const notes: string[] = [];
  const current = spec.tokens;

  const apply = (axis: Axis, next: string | null, why: string) => {
    if (!next || next === current[axis]) return;
    const set: Record<string, readonly string[]> = {
      palette: PALETTES.map((p) => p.id),
      typography: TYPEFACES.map((t) => t.id),
      motion: MOTIONS.map((m) => m.id),
      effects: EFFECT_KITS.map((e) => e.id),
      density: ['quiet', 'balanced', 'dense'],
    };
    if (!inCatalog(set[axis] ?? [], next)) return;
    const from = current[axis] ?? '';
    changed.push({ axis, from, to: next });
    current[axis] = next;
    /* Keep the decision record honest: the page's token moved, so the record
       must show the value the page uses, with its provenance. */
    const d = spec.decisions.find((x) => x.axis === axis);
    if (d && d.picked !== next) {
      d.picked = next;
      d.rationale = `Revised to "${next}" (${why}). Originally "${from}" per the decision call.`;
    }
    notes.push(`${axis}: ${from} → ${next} (${why})`);
  };

  /* ---- palette: named hues first, then tone ---------------------------- */
  const namedPalette = PALETTE_RULES.find((r) => r.re.test(instructions));
  if (namedPalette) {
    apply('palette', namedPalette.value, 'named in the request');
  } else if (/\bdark(er)?\b|\bblack\b|night|noir|moody/i.test(instructions)) {
    const dark = PALETTES.filter((p) => hexLuminance(p.bg) <= 140);
    const pick = dark[hash(instructions) % dark.length]!;
    apply('palette', pick.id, 'the request asks for a darker ground');
  } else if (/\blight(er)?\b|\bwhite\b|bright|airy|pale/i.test(instructions)) {
    const light = PALETTES.filter((p) => hexLuminance(p.bg) > 140);
    const pick = light[hash(instructions) % light.length]!;
    apply('palette', pick.id, 'the request asks for a lighter ground');
  }

  for (const [axis, rules] of [
    ['typography', TYPE_RULES],
    ['motion', MOTION_RULES],
    ['density', DENSITY_RULES],
    ['effects', EFFECT_RULES],
  ] as [Axis, Rule[]][]) {
    const rule = rules.find((r) => r.re.test(instructions));
    if (rule) apply(axis, rule.pick(current[axis] ?? ''), 'named in the request');
  }

  return { changed, notes };
}
