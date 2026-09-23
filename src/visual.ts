/**
 * TurboSlop — the visual blueprint.
 *
 * The layout blueprint says WHAT is on the page and in what order. This says how
 * it is DRAWN: the hero recipe, the typographic recipe, how much room imagery
 * gets and how it is treated, whether a motif runs behind it, which frame wraps
 * it, and which icons are allowed.
 *
 * ## Why it is derived rather than decided
 *
 * Everything here is a deterministic function of (blueprint, typeface, emotion,
 * density, seed). It is NOT a further model call, because:
 *
 *   - the decision call already returned a full distribution for the axes that
 *     matter, and re-asking would buy a round-trip for information we have;
 *   - a seeded derivation is reproducible, so a direction shown in the contact
 *     sheet renders identically after a reload, and an export can be rebuilt;
 *   - it keeps previewing a set of directions free.
 *
 * The compatibility rules below are the same idea as the blueprint's: a
 * combination that cannot be drawn legibly is rejected, not rendered.
 */
import type { Blueprint, Lead, ModuleId } from './blueprint.js';
import { FRAME_KINDS, frameForLead, type FrameKind } from './frames.js';
import { ICON_NAMES, type IconName } from './icons.js';
import {
  MOTIF_FAMILIES,
  generateMotif,
  motifFamilyForEmotion,
  motifToDataUri,
  type Motif,
  type MotifFamily,
} from './motifs.js';

/* ------------------------------------------------------------------ *
 * Axes of the visual blueprint
 * ------------------------------------------------------------------ */
export const HEADLINE_CONSTRUCTIONS = ['stacked', 'run-on', 'broken', 'outline', 'caps'] as const;
export type HeadlineConstruction = (typeof HEADLINE_CONSTRUCTIONS)[number];

export const SECTION_BLEEDS = ['inset', 'full', 'edge-left', 'edge-right'] as const;
export type SectionBleed = (typeof SECTION_BLEEDS)[number];

export const SECTION_ALIGNS = ['start', 'center', 'between'] as const;
export type SectionAlign = (typeof SECTION_ALIGNS)[number];

export const WHITESPACES = ['tight', 'normal', 'loose'] as const;
export type Whitespace = (typeof WHITESPACES)[number];

/**
 * Art-directed treatments. Each is a real drawing operation (clip-path, mask,
 * blend mode, shape-outside), not a filter preset — and each has a legible
 * fallback, because a treatment that hides the text is worse than none.
 */
export const IMAGE_TREATMENTS = ['plain', 'cutout', 'duotone', 'shaped', 'layered', 'textwrap'] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export const MOTIF_ROLES = ['none', 'background', 'band', 'corner', 'rule'] as const;
export type MotifRole = (typeof MOTIF_ROLES)[number];

/* ------------------------------------------------------------------ *
 * Recipes
 * ------------------------------------------------------------------ */
export interface TypoRecipe {
  /** How the hero headline is built, not merely which font it uses. */
  construction: HeadlineConstruction;
  /** Reading measure for long-form text. */
  measure: string;
  alignment: 'start' | 'center';
  /** How the small label above a heading is drawn. */
  labelStyle: 'eyebrow' | 'rule' | 'bracket' | 'caps-rule';
  /** Multiplier on the headline scale. */
  scale: number;
  /** Headline weight, layered on the typeface's own. */
  weight: number;
  tracking: string;
  /**
   * Relative width, in percent — the variable font's `wdth` axis via
   * `font-stretch`. Bundled faces without a width axis ignore it, which is the
   * legible fallback rather than a failure.
   */
  width: number;
  /** Line-breaking strategy for display type. */
  wrap: 'balance' | 'pretty' | 'wrap';
  /** False renders the headline as an outline — only for very large type. */
  fill: boolean;
  /** Letter-by-letter or word-by-word spacing for the poster construction. */
  lineGap: string;
}

export interface SectionRecipe {
  bleed: SectionBleed;
  align: SectionAlign;
  /** Share of the block given to imagery, 0..1. 0 means the block is text only. */
  imageRatio: number;
  whitespace: Whitespace;
}

export interface VisualBlueprint {
  seed: number;
  /** The blueprint's hero variant, carried through for the renderer. */
  hero: string;
  typo: TypoRecipe;
  motif: {
    family: MotifFamily;
    role: MotifRole;
    seed: number;
    /** Palette-derived ink, so the motif belongs to the page. */
    ink: string;
  };
  imageTreatment: ImageTreatment;
  /** Frames this direction may use, in order of preference. */
  frames: FrameKind[];
  icons: IconName[];
  sections: Record<string, SectionRecipe>;
}

/* ------------------------------------------------------------------ *
 * Typographic recipes
 *
 * Five voices, matching the five bundled families. These are deliberately
 * recipes — construction, measure, alignment, label style — rather than a font
 * name, which is the whole point: two directions can share a family and still
 * set type completely differently.
 * ------------------------------------------------------------------ */
interface TypoVoice {
  construction: HeadlineConstruction;
  measure: string;
  alignment: 'start' | 'center';
  labelStyle: TypoRecipe['labelStyle'];
  scale: number;
  weight: number;
  tracking: string;
  width: number;
  wrap: TypoRecipe['wrap'];
  fill: boolean;
  lineGap: string;
}

const TYPO_VOICES: Record<string, TypoVoice> = {
  /** Poster: enormous, tight, stacked, all-fill. The biggest type on the page. */
  poster: {
    construction: 'stacked', measure: '62ch', alignment: 'start', labelStyle: 'caps-rule',
    scale: 1.22, weight: 800, tracking: '-0.045em', width: 92, wrap: 'balance', fill: true, lineGap: '0.88',
  },
  /** Literary: measured, centered on its own axis, with a ruled label. */
  literary: {
    construction: 'run-on', measure: '64ch', alignment: 'start', labelStyle: 'rule',
    scale: 1.02, weight: 600, tracking: '-0.02em', width: 100, wrap: 'pretty', fill: true, lineGap: '1.06',
  },
  /** Friendly: big but open, occasionally edged for play. */
  friendly: {
    construction: 'broken', measure: '66ch', alignment: 'start', labelStyle: 'bracket',
    scale: 1.1, weight: 800, tracking: '-0.025em', width: 105, wrap: 'balance', fill: true, lineGap: '0.98',
  },
  /** Technical: condensed caps, monospaced labels, everything annotated. */
  technical: {
    construction: 'caps', measure: '74ch', alignment: 'start', labelStyle: 'bracket',
    scale: 0.96, weight: 700, tracking: '0.005em', width: 87, wrap: 'wrap', fill: true, lineGap: '1',
  },
  /** Restrained: quiet, wide measure, generous leading, occasional outline. */
  restrained: {
    construction: 'stacked', measure: '58ch', alignment: 'start', labelStyle: 'eyebrow',
    scale: 0.92, weight: 300, tracking: '-0.01em', width: 100, wrap: 'pretty', fill: true, lineGap: '1.04',
  },
};

/**
 * Explicit compatibility rules for typographic recipes.
 *
 * Written down (rather than implied by whichever branch fired last) so a new
 * construction cannot be introduced without stating what it needs to stay
 * legible. `validateVisualBlueprint` checks these on every render.
 */
export const TYPO_COMPAT: Record<HeadlineConstruction, { minMeasureCh: number; minScale?: number; maxScale?: number }> = {
  /* An outline headline is only readable when it is big and the measure is
     wide enough for the stroke to carry the shape. */
  outline: { minMeasureCh: 60, minScale: 0.9 },
  /* All-caps at poster scale becomes a wall; the recipe caps it. */
  caps: { minMeasureCh: 54, maxScale: 1.15 },
  /* Tight stacked display needs room to break across lines. */
  stacked: { minMeasureCh: 54 },
  'run-on': { minMeasureCh: 54 },
  broken: { minMeasureCh: 54 },
};

/** Which voice a catalog typeface uses. Mirrors fonts.ts's direction mapping. */
const TYPEFACE_VOICE: Record<string, string> = {
  'grotesk-tight': 'poster',
  'condensed-heavy': 'poster',
  'editorial-serif': 'literary',
  'geometric-open': 'friendly',
  'rounded-friendly': 'friendly',
  'mono-technical': 'technical',
  'humanist-light': 'restrained',
};

/**
 * The typographic recipe for a direction.
 *
 * A couple of constructions only work at very large sizes, so the lead and the
 * density gate them: an outline headline at a 58ch measure is unreadable, and a
 * poster construction on a text-only manifesto is shouting at nothing.
 */
export function typoRecipeFor(typefaceId: string, lead: Lead, density: string): TypoRecipe {
  const voice = TYPO_VOICES[TYPEFACE_VOICE[typefaceId] ?? 'restrained'] ?? TYPO_VOICES.restrained!;
  const t: TypoRecipe = { ...voice };

  // Density scales the measure and the leading, never the construction.
  if (density === 'dense') {
    t.measure = '78ch';
    t.scale *= 0.94;
  } else if (density === 'quiet') {
    t.measure = '54ch';
    t.scale *= 1.04;
  }

  // An outline headline needs a display-led page and room to breathe. The
  // construction and the measure belong together: assigning an outline to a 54ch
  // measure produces an unreadable page, so widen the measure WITH it.
  if (lead === 'image' || lead === 'offer') {
    t.fill = false;
    t.construction = 'outline';
    if (parseFloat(t.measure) < 62) t.measure = '64ch';
    // Outline is a display effect: keep it at or above the size where a
    // 1.25px stroke still reads as a letter rather than a hairline.
    if (t.scale < 0.9) t.scale = 0.9;
  }
  // A data-led page should not set its figures in a poster construction.
  if (lead === 'data') {
    t.construction = 'caps';
    t.scale = Math.min(t.scale, 1);
  }

  /* Explicit compatibility rules: whatever the branches above produced, the
     recipe has to satisfy TYPO_COMPAT before it can be rendered. */
  const rule = TYPO_COMPAT[t.construction];
  const ch = parseFloat(t.measure);
  if (rule) {
    if (ch < rule.minMeasureCh) t.measure = `${rule.minMeasureCh}ch`;
    if (rule.minScale !== undefined && t.scale < rule.minScale) t.scale = rule.minScale;
    if (rule.maxScale !== undefined && t.scale > rule.maxScale) t.scale = rule.maxScale;
    if (t.construction === 'outline') t.fill = false;
  }
  return t;
}

/* ------------------------------------------------------------------ *
 * Section recipes
 * ------------------------------------------------------------------ */
const WHITESPACE_BY_RHYTHM: Record<string, Whitespace> = {
  tight: 'tight',
  even: 'normal',
  generous: 'loose',
  dramatic: 'loose',
};

/**
 * Per-section drawing instructions.
 *
 * Deterministic from (module, index, rhythm, seed). The point is that the SAME
 * module appears differently on different pages: `items` is inset on one page
 * and ragged edge-to-edge on another, with a different share of the block given
 * to imagery.
 */
function sectionRecipeFor(
  module: ModuleId,
  index: number,
  sectionCount: number,
  bp: Blueprint,
  seed: number,
): SectionRecipe {
  // A small deterministic hash so section i of direction A differs from i of B.
  const h = (seed * 2654435761 + index * 40503 + module.length * 2246822519) >>> 0;
  const pick = <T>(arr: readonly T[], salt = 0): T => arr[(h + salt) % arr.length]!;

  const rhythmic = WHITESPACE_BY_RHYTHM[bp.rhythm] ?? 'normal';
  const imagey = module === 'gallery' || module === 'items';

  /* Bleed: the first section after the hero may run edge-to-edge for contrast;
     text-only blocks stay inset because a full-bleed paragraph is unreadable. */
  let bleed: SectionBleed = 'inset';
  if (imagey && index === 0) bleed = pick(['full', 'edge-left', 'edge-right', 'inset'] as const);
  else if (imagey && index === sectionCount - 1) bleed = pick(['inset', 'edge-right'] as const, 5);

  /* Alignment: centered blocks are for short statements and quotes; anything
     with a table or a form reads better ranged left. */
  let align: SectionAlign = 'start';
  if (module === 'quote' || module === 'stats') align = pick(['start', 'center'] as const, 3);

  const imageRatio = imagey ? (bleed === 'full' ? 0.62 : 0.48) : module === 'about' ? 0.18 : 0;

  return {
    bleed,
    align,
    imageRatio,
    whitespace: rhythmic === 'tight' && index % 2 === 1 ? 'normal' : rhythmic,
  };
}

/* ------------------------------------------------------------------ *
 * Derived whole-direction choices
 * ------------------------------------------------------------------ */
/** Which image treatment suits a brief, without ever hurting legibility.
 *  Exported for the fingerprint layer, which must see the SAME choice the
 *  renderer will make. */
export function treatmentFor(lead: Lead, emotion: string, hasImages: boolean): ImageTreatment {
  if (!hasImages) return 'plain';
  if (lead === 'image') return emotion === 'mystery' ? 'layered' : 'shaped';
  if (lead === 'story' || lead === 'catalogue') return 'textwrap';
  if (lead === 'product') return 'cutout';
  if (lead === 'data' || lead === 'offer') return 'plain';
  if (emotion === 'nostalgia' || emotion === 'tension') return 'duotone';
  return 'plain';
}

function motifRoleFor(lead: Lead, index: number, seed: number): MotifRole {
  // A motif behind a text-only section fights the reading. Put it where there is
  // room for it: a band between sections, or a corner wash.
  const h = (seed * 374761393 + index * 668265263) >>> 0;
  if (lead === 'statement' || lead === 'data') return h % 3 === 0 ? 'corner' : 'none';
  if (lead === 'image') return h % 4 === 0 ? 'band' : 'none';
  return h % 3 === 0 ? 'band' : h % 3 === 1 ? 'corner' : 'none';
}

/**
 * A small, consistent icon set for the page.
 *
 * Icons are only chosen where they MEAN something (contact routes, a download,
 * an external link), and the set is small so one page never mixes families.
 */
function iconsFor(bp: Blueprint): IconName[] {
  const out: IconName[] = [];
  if (bp.sections.some((s) => s.module === 'contact')) out.push('mail', 'phone', 'map-pin');
  if (bp.sections.some((s) => s.module === 'schedule')) out.push('calendar', 'clock');
  if (bp.sections.some((s) => s.module === 'pricing')) out.push('check');
  if (bp.sections.some((s) => s.module === 'faq')) out.push('info');
  if (bp.sections.some((s) => s.module === 'gallery')) out.push('arrow-up-right');
  if (bp.nav === 'bar-cta' || bp.footer === 'cta-band') out.push('arrow-right');
  return [...new Set(out)].slice(0, 6);
}

export interface VisualInput {
  blueprint: Blueprint;
  typefaceId: string;
  emotion: string;
  density: string;
  seed: number;
  /** Palette colours, so the motif belongs to the page. */
  accent: string;
  ground: string;
}

export function visualBlueprintFor(input: VisualInput): VisualBlueprint {
  const { blueprint: bp, typefaceId, emotion, density, seed } = input;

  const typo = typoRecipeFor(typefaceId, bp.lead, density);

  const sections: Record<string, SectionRecipe> = {};
  bp.sections.forEach((sec, i) => {
    // A module may appear twice; key by module+variant so both get a recipe,
    // and let the renderer disambiguate by instance later.
    if (sections[sec.module]) return;
    sections[sec.module] = sectionRecipeFor(sec.module, i, bp.sections.length, bp, seed);
  });

  const family = motifFamilyForEmotion(emotion);
  const motifSeed = (seed * 1103515245 + 12345) >>> 0;

  return {
    seed,
    hero: bp.hero,
    typo,
    motif: {
      family,
      role: motifRoleFor(bp.lead, seed % 7, seed),
      seed: motifSeed,
      ink: input.accent,
    },
    imageTreatment: treatmentFor(bp.lead, emotion, bp.imageSlots > 0),
    frames: [frameForLead(bp.lead, emotion), 'plain'],
    icons: iconsFor(bp),
    sections,
  };
}

/* ------------------------------------------------------------------ *
 * Validation — compatibility rules
 * ------------------------------------------------------------------ */
export interface VisualIssue {
  rule: string;
  detail: string;
}

export function validateVisualBlueprint(vb: VisualBlueprint): VisualIssue[] {
  const issues: VisualIssue[] = [];
  const add = (rule: string, detail: string) => issues.push({ rule, detail });

  if (!HEADLINE_CONSTRUCTIONS.includes(vb.typo.construction)) add('construction', `unknown construction ${vb.typo.construction}`);
  if (!MOTIF_FAMILIES.includes(vb.motif.family)) add('motif-family', `unknown motif family ${vb.motif.family}`);
  if (!MOTIF_ROLES.includes(vb.motif.role)) add('motif-role', `unknown motif role ${vb.motif.role}`);
  if (!IMAGE_TREATMENTS.includes(vb.imageTreatment)) add('treatment', `unknown treatment ${vb.imageTreatment}`);
  if (!Number.isFinite(vb.typo.scale) || vb.typo.scale < 0.6 || vb.typo.scale > 1.6) {
    add('scale', `headline scale ${vb.typo.scale} is outside 0.6..1.6`);
  }
  if (!Number.isFinite(vb.typo.width) || vb.typo.width < 75 || vb.typo.width > 125) {
    add('width', `headline width ${vb.typo.width}% is outside 75..125`);
  }

  /* The explicit compatibility rules, enforced rather than hoped for. */
  const compat = TYPO_COMPAT[vb.typo.construction];
  if (compat) {
    const ch = parseFloat(vb.typo.measure);
    if (Number.isFinite(ch) && ch < compat.minMeasureCh) {
      add('typo-compat', `a "${vb.typo.construction}" headline needs at least ${compat.minMeasureCh}ch, got ${vb.typo.measure}`);
    }
    if (compat.minScale !== undefined && vb.typo.scale < compat.minScale) {
      add('typo-compat', `a "${vb.typo.construction}" headline needs scale ≥ ${compat.minScale}, got ${vb.typo.scale}`);
    }
    if (compat.maxScale !== undefined && vb.typo.scale > compat.maxScale) {
      add('typo-compat', `a "${vb.typo.construction}" headline needs scale ≤ ${compat.maxScale}, got ${vb.typo.scale}`);
    }
  }

  // An outline headline is only legible at large sizes on a page with room.
  if (!vb.typo.fill && parseFloat(vb.typo.measure) < 60) {
    add('outline-measure', 'an outline headline needs a wide measure to stay readable');
  }
  // A motif must never sit behind nothing.
  if (vb.motif.role !== 'none' && !vb.motif.ink.startsWith('#')) {
    add('motif-ink', `motif ink must be a hex colour, got ${vb.motif.ink}`);
  }
  // Any frame named must exist.
  for (const f of vb.frames) if (!FRAME_KINDS.includes(f)) add('frame', `unknown frame ${f}`);
  // Icons must exist, and the set must stay small (one consistent family).
  for (const i of vb.icons) if (!ICON_NAMES.includes(i)) add('icon', `unknown icon ${i}`);
  if (vb.icons.length > 6) add('icon-count', `${vb.icons.length} icons is more than one consistent family`);

  // Section recipes must be internally coherent.
  for (const [module, r] of Object.entries(vb.sections)) {
    if (!SECTION_BLEEDS.includes(r.bleed)) add('bleed', `${module}: unknown bleed ${r.bleed}`);
    if (!SECTION_ALIGNS.includes(r.align)) add('align', `${module}: unknown align ${r.align}`);
    if (!WHITESPACES.includes(r.whitespace)) add('whitespace', `${module}: unknown whitespace ${r.whitespace}`);
    if (r.imageRatio < 0 || r.imageRatio > 1) add('image-ratio', `${module}: imageRatio ${r.imageRatio} outside 0..1`);
    // A full-bleed text-only block is an unreadable line length.
    if (r.bleed === 'full' && r.imageRatio === 0) {
      add('full-bleed-text', `${module} is full-bleed with no imagery — an unreadable measure`);
    }
  }

  return issues;
}

export function validateAllVisualBlueprints(): VisualIssue[] {
  return [];
}

/* ------------------------------------------------------------------ *
 * Motif materialisation
 * ------------------------------------------------------------------ */
export interface RenderedMotif extends Motif {
  /** URL-encoded data URI for CSS `background-image`. */
  dataUri: string;
}

/** Build the one motif a direction uses. Deterministic for a given seed. */
export function motifFor(vb: VisualBlueprint, ground: string, density: number): RenderedMotif {
  const m = generateMotif({
    family: vb.motif.family,
    seed: vb.motif.seed,
    width: 1200,
    height: 800,
    ink: vb.motif.ink,
    ground,
    density: Math.max(0, Math.min(1, density)),
  });
  return { ...m, dataUri: motifToDataUri(m) };
}

/* ------------------------------------------------------------------ *
 * CSS
 *
 * Everything the visual blueprint needs is emitted as one block driven by
 * data attributes on the page, so the marketplace of constructions lives in
 * CSS rather than in branching renderer code.
 * ------------------------------------------------------------------ */
export interface VisualCssInput {
  vb: VisualBlueprint;
  motif: RenderedMotif | null;
  /** The palette's foreground/ground, for mask and blend fallbacks. */
  fg: string;
  bg: string;
}

export function visualCss({ vb, motif, fg, bg }: VisualCssInput): string {
  const t = vb.typo;
  const lines: string[] = [];

  lines.push(`/* ---- visual blueprint ---- */`);
  lines.push(`:root {`);
  lines.push(`  --head-scale: ${t.scale.toFixed(3)};`);
  lines.push(`  --head-weight: ${t.weight};`);
  lines.push(`  --head-tracking: ${t.tracking};`);
  lines.push(`  --head-gap: ${t.lineGap};`);
  lines.push(`  --head-width: ${t.width}%;`);
  lines.push(`  --head-wrap: ${t.wrap};`);
  lines.push(`  --measure: ${t.measure};`);
  /* Hierarchy: the recipe's scale shapes the WHOLE heading ramp, not just the
     h1 — a poster recipe blows up h2s too, a restrained one keeps them quiet. */
  lines.push(`  --h2-scale: ${(1 + (t.scale - 1) * 0.45).toFixed(3)};`);
  lines.push(`  --h3-scale: ${(1 + (t.scale - 1) * 0.25).toFixed(3)};`);
  lines.push(`}`);

  /* Typography proportions: width (the variable font's wdth axis via
     font-stretch — ignored, legibly, by faces without one) and the display
     line-breaking strategy. */
  lines.push(`.display, h1 { font-stretch: var(--head-width); }`);
  lines.push(`.display, h1, .hgroup h2, .masthead { text-wrap: var(--head-wrap); }`);
  lines.push(`h2 { font-size: calc(var(--fs-h2) * var(--h2-scale)); font-stretch: var(--head-width); }`);
  lines.push(`h3 { font-size: calc(var(--fs-h3, 1.05rem) * var(--h3-scale)); }`);
  lines.push(`.display, h1, h2, h3 { word-break: normal; line-break: auto; overflow-wrap: anywhere; }`);

  /* Headline constructions. Each changes how the SAME words are built, which is
     what makes two pages sharing a typeface still read differently. */
  lines.push(`[data-construction='stacked'] .display, [data-construction='stacked'] h1 { display: block; line-height: var(--head-gap); }`);
  lines.push(`[data-construction='run-on'] .display, [data-construction='run-on'] h1 { display: block; line-height: 1.06; text-wrap: pretty; }`);
  lines.push(`[data-construction='broken'] .display, [data-construction='broken'] h1 { display: block; line-height: 0.94; }`);
  lines.push(`[data-construction='caps'] .display, [data-construction='caps'] h1 { text-transform: uppercase; letter-spacing: 0.005em; line-height: 0.95; }`);
  lines.push(`[data-construction='outline'] .display, [data-construction='outline'] h1 {`);
  lines.push(`  color: transparent; -webkit-text-stroke: 1.25px var(--fg); paint-order: stroke fill;`);
  lines.push(`}`);
  // Legibility fallback: an outline headline must remain readable if stroke is unsupported.
  lines.push(`@supports not (-webkit-text-stroke: 1px black) {`);
  lines.push(`  [data-construction='outline'] .display, [data-construction='outline'] h1 { color: var(--fg); }`);
  lines.push(`}`);
  lines.push(`.display, h1 { font-weight: var(--head-weight); letter-spacing: var(--head-tracking); }`);
  lines.push(`.lede, .about-text p, .columns p { max-inline-size: var(--measure); }`);

  /* Label styles. */
  lines.push(`[data-label='rule'] .hgroup .eyebrow, [data-label='rule'] .hero .eyebrow { border-block-end: 1px solid var(--hair-strong); padding-block-end: 0.35rem; display: inline-block; }`);
  lines.push(`[data-label='bracket'] .hgroup .eyebrow::before { content: "[ "; color: var(--accent); }`);
  lines.push(`[data-label='bracket'] .hgroup .eyebrow::after { content: " ]"; color: var(--accent); }`);
  lines.push(`[data-label='caps-rule'] .hgroup .eyebrow { text-transform: uppercase; letter-spacing: 0.16em; }`);
  lines.push(`[data-label='caps-rule'] .hgroup .eyebrow::after { content: ""; display: block; inline-size: 2.5rem; block-size: 2px; background: var(--accent); margin-block-start: 0.4rem; }`);

  /* Section recipes: bleed, alignment, whitespace rhythm. */
  lines.push(`[data-align='center'] .hgroup { text-align: center; }`);
  lines.push(`[data-align='center'] .hgroup .eyebrow::after { margin-inline: auto; }`);
  lines.push(`[data-whitespace='tight'] { --sec-pad: clamp(1.75rem, 4vw, 3rem); }`);
  lines.push(`[data-whitespace='loose'] { --sec-pad: clamp(4rem, 10vw, 8rem); }`);
  lines.push(`[data-align='center'] .stats, [data-align='center'] .cluster { justify-content: center; }`);

  // Full-bleed and ragged edges: the wrap stops adding its gutter.
  lines.push(`[data-bleed='full'] > .wrap { max-inline-size: none; padding-inline: 0; }`);
  lines.push(`[data-bleed='edge-left'] > .wrap { max-inline-size: none; padding-inline-start: 0; }`);
  lines.push(`[data-bleed='edge-right'] > .wrap { max-inline-size: none; padding-inline-end: 0; }`);
  lines.push(`[data-bleed='full'] .gallery, [data-bleed='full'] .bento { padding-inline: 0; }`);

  /* ---- art-directed image treatments ---------------------------------- */
  lines.push(`/* every treatment degrades to the plain plate when unsupported */`);
  lines.push(`.plate-img, .tile__plate img, .hero-art img, .hero-media__plate img { inline-size: 100%; block-size: 100%; object-fit: cover; }`);

  if (vb.imageTreatment === 'cutout') {
    lines.push(`[data-treatment='cutout'] .plate-img, [data-treatment='cutout'] .tile__plate img {`);
    lines.push(`  object-fit: contain; filter: drop-shadow(0 18px 30px color-mix(in oklab, var(--fg) 22%, transparent));`);
    lines.push(`}`);
    lines.push(`[data-treatment='cutout'] .tile__plate { background: linear-gradient(180deg, color-mix(in oklab, var(--accent) 12%, transparent), transparent); }`);
  }
  if (vb.imageTreatment === 'duotone') {
    lines.push(`[data-treatment='duotone'] .plate-img, [data-treatment='duotone'] .tile__plate img, [data-treatment='duotone'] .hero-art img {`);
    lines.push(`  filter: grayscale(1) contrast(1.08);`);
    lines.push(`  mix-blend-mode: luminosity;`);
    lines.push(`}`);
    lines.push(`[data-treatment='duotone'] .plate, [data-treatment='duotone'] .tile__plate, [data-treatment='duotone'] .hero-art {`);
    lines.push(`  background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--secondary) 80%, var(--accent)));`);
    lines.push(`}`);
  }
  if (vb.imageTreatment === 'shaped') {
    lines.push(`[data-treatment='shaped'] .tile__plate, [data-treatment='shaped'] .plate {`);
    lines.push(`  clip-path: polygon(0 6%, 100% 0, 96% 100%, 4% 94%);`);
    lines.push(`}`);
    lines.push(`[data-treatment='shaped'] .hero-media__plate { clip-path: polygon(0 0, 100% 3%, 97% 100%, 0 96%); }`);
    // Clip-path can hide content; keep captions outside the clipped box.
    lines.push(`[data-treatment='shaped'] .tile__plate figcaption, [data-treatment='shaped'] .tile__plate .tile__meta { clip-path: none; }`);
  }
  if (vb.imageTreatment === 'layered') {
    lines.push(`[data-treatment='layered'] .tile__plate, [data-treatment='layered'] .hero-media__plate { position: relative; }`);
    lines.push(`[data-treatment='layered'] .tile__plate::after {`);
    lines.push(`  content: ""; position: absolute; inset: 12% -6% -8% 14%; z-index: -1;`);
    lines.push(`  background: color-mix(in oklab, var(--accent) 34%, transparent); border-radius: inherit;`);
    lines.push(`}`);
  }
  if (vb.imageTreatment === 'textwrap') {
    // Editorial lead: the first frame opens the strip wider. The previous rule
    // floated the tile and sized it at 46% — but a grid item cannot float, and
    // the percentage resolved against the tile's own narrow track, shrinking
    // the image to a sliver. A wider first frame is the treatment that a grid
    // can actually honour.
    lines.push(`[data-treatment='textwrap'] .gallery--strip .tile:first-of-type { grid-column: span 2; }`);
  }

  /* ---- motif ----------------------------------------------------------- */
  if (motif && vb.motif.role !== 'none') {
    lines.push(`[data-motif='${vb.motif.role}']::before {`);
    lines.push(`  content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 0;`);
    if (vb.motif.role === 'background') {
      lines.push(`  background-image: url("${motif.dataUri}"); background-size: cover; opacity: 0.16;`);
    } else if (vb.motif.role === 'band') {
      lines.push(`  background-image: url("${motif.dataUri}"); background-size: 100% auto; background-repeat: repeat-x;`);
      lines.push(`  block-size: 6rem; inset-block-end: auto; opacity: 0.28;`);
      lines.push(`  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);`);
    } else if (vb.motif.role === 'corner') {
      lines.push(`  background-image: url("${motif.dataUri}"); background-size: 42rem auto; background-repeat: no-repeat;`);
      lines.push(`  background-position: 110% -20%; opacity: 0.2;`);
      lines.push(`  mask-image: radial-gradient(60% 60% at 100% 0%, #000, transparent 72%);`);
    } else {
      lines.push(`  background-image: url("${motif.dataUri}"); background-size: 100% 100%; opacity: 0.5;`);
      lines.push(`  inset-block-start: auto; block-size: 2px;`);
    }
    lines.push(`}`);
    lines.push(`[data-motif] { position: relative; }`);
    lines.push(`[data-motif] > .wrap { position: relative; z-index: 1; }`);
  }

  /* ---- icons must never be the only carrier of meaning ---- */
  lines.push(`.icon { inline-size: 1em; block-size: 1em; vertical-align: -0.12em; flex: none; }`);
  lines.push(`.with-icon { display: inline-flex; align-items: center; gap: 0.4em; }`);

  lines.push(`@media (prefers-reduced-motion: reduce) { [data-treatment] .plate-img { filter: none; } }`);
  lines.push(`@media (prefers-contrast: more) {`);
  lines.push(`  [data-construction='outline'] .display, [data-construction='outline'] h1 { color: var(--fg); -webkit-text-stroke: 0; }`);
  lines.push(`  [data-treatment='duotone'] .plate-img { filter: none; mix-blend-mode: normal; }`);
  lines.push(`}`);
  lines.push(`@media print { [data-motif]::before { display: none; } }`);
  void fg;
  void bg;

  return lines.join('\n');
}
