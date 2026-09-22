/**
 * TurboSlop — the catalog.
 *
 * This is the *only* vocabulary the tool can speak. Jev never authors markup or
 * invents a value: it selects and ranks from the candidates declared here. That
 * is the whole reason the output is guaranteed to be renderable and on-brand —
 * the model's freedom is deliberately bounded to "pick a card from the deck".
 *
 * Every entry carries a `description`, because Jev's criteria quality is the
 * single biggest lever on answer quality: descriptions must say what *belongs*
 * to an option and how it differs from its neighbour.
 */

export interface Candidate {
  id: string;
  /** Human label, but written primarily as machine-readable criteria for Jev. */
  label: string;
  description: string;
}

export interface PaletteCandidate extends Candidate {
  bg: string;
  bgRaised: string;
  fg: string;
  muted: string;
  accent: string;
  accentInk: string;
  secondary: string;
  /** Third accent for the richer palettes (the variations used up to four). */
  tertiary?: string;
}

export interface TypeCandidate extends Candidate {
  display: string;
  body: string;
  mono: string;
  /**
   * Italic face for the single accented phrase in a headline. Every variation
   * used one (Instrument Serif, Playfair italic, Fraunces italic, Caveat), and
   * it is one of the most recognisable moves in the whole set.
   */
  accent?: string;
  displayWeight: number;
  tracking: string;
  scale: number;
  googleFonts: string[];
}

export interface MotionCandidate extends Candidate {
  duration: string;
  ease: string;
  /** Multiplier applied to reveal delays. */
  tempo: number;
}

export interface LayoutCandidate extends Candidate {
  /** Column count for the main grid. */
  columns: number;
  maxWidth: string;
  gutter: string;
  radius: string;
  /** Whether to draw structural hairlines between regions. */
  rules: boolean;
  /**
   * How large display type may get in this layout. A narrow reading column
   * cannot carry an 11vw headline without wrapping to one word per line, so the
   * layout scales the display size to suit its own measure.
   */
  displayFactor: number;
}

/* ================================================================== *
 * EMOTION — the primary axis. Everything else is selected to serve it.
 * ================================================================== */
export const EMOTIONS: Candidate[] = [
  { id: 'awe', label: 'Awe', description: 'Monumental scale, cinematic pacing, vast negative space, one cold light source. The visitor feels small in front of something enormous.' },
  { id: 'serenity', label: 'Serenity', description: 'Calm, spa-like, weightless. Soft edges, low contrast, generous whitespace, slow gentle motion. The visitor exhales.' },
  { id: 'delight', label: 'Delight', description: 'Playful, toy-like, tactile, generous. Springy interactions and small rewards. The visitor smiles and wants to touch things.' },
  { id: 'tension', label: 'Tension', description: 'Industrial, precise, uncompromising. Hard right angles, mono type, hazard accents, mechanical instant transitions. The visitor feels alert and slightly on edge.' },
  { id: 'nostalgia', label: 'Nostalgia', description: 'Warm familiarity and wistfulness, like a beautiful printed object from decades ago. Cream paper, ink, serif, editorial device. Permanent and human.' },
  { id: 'mystery', label: 'Mystery', description: 'Curious and slightly unnerved. Light is scarce, content resolves only on engagement, text decodes. The visitor feels compelled to interact to reveal what is hidden.' },
  { id: 'trust', label: 'Trust', description: 'Competent, rigorous, safe, institutional. Clean ground, visible structure, honest data, tabular figures, zero decoration. The visitor feels this studio is safe with important work.' },
  { id: 'energy', label: 'Energy', description: 'Fast, loud, kinetic, competitive. Saturated accents, diagonal cuts, marquees, aggressive scale. The visitor feels adrenaline and that the page is already moving.' },
  { id: 'intimacy', label: 'Intimacy', description: 'Personally spoken to, as if a small careful studio wrote this page for one reader. Warm neutrals, narrow measure, hand-drawn marks, quiet voice. The visitor feels addressed.' },
  { id: 'optimism', label: 'Optimism', description: 'Lifted and hopeful about the future. Bright airy ground, iridescent gradients, glass, buoyant upward motion. The visitor feels a clear morning of a better decade.' },
  { id: 'other', label: 'Other', description: 'The brief does not clearly fit any of the emotions above, or deliberately asks for something outside them.' },
];

/* ================================================================== *
 * PALETTE
 *
 * CURATED: every palette below is ported from a finished variation, using that
 * variation's real values (harvested mechanically, then verified against the
 * rendered page). These replace the earlier speculative set, which was invented
 * from the emotional briefs before any of them existed.
 * ================================================================== */
export const PALETTES: PaletteCandidate[] = [
  { id: 'arctic-cyan', label: 'Arctic + cyan', description: 'Near-black void lit by one cold pale-cyan source. Monumental, silent, vast. Light is distant and precise.', bg: '#05060a', bgRaised: '#0b1119', fg: '#eaf2f7', muted: '#8d9aa6', accent: '#a9e6ff', accentInk: '#04121a', secondary: '#6ea8c8' },
  { id: 'sage-mist', label: 'Sage + clay', description: 'Warm off-white with muted sage and clay. Calm, low contrast, breathable, never clinical.', bg: '#f7f4ee', bgRaised: '#fbf8f3', fg: '#3b3d37', muted: '#7c8074', accent: '#5f7263', accentInk: '#fbf8f3', secondary: '#8c5f44' },
  { id: 'candy-pop', label: 'Candy pop', description: 'Warm cream with several saturated confectionery accents. Joyful, friendly, deliberately not corporate.', bg: '#fff6e8', bgRaised: '#fffdf7', fg: '#2a1b3d', muted: '#5a4a70', accent: '#ff4d9e', accentInk: '#ffffff', secondary: '#ff7a2f', tertiary: '#5b3be0' },
  { id: 'hazard-mono', label: 'Hazard mono', description: 'Pure black and pure white with a single safety alarm. Severe, machined, deliberately alarming.', bg: '#000000', bgRaised: '#0a0a0a', fg: '#ffffff', muted: '#9b9b9b', accent: '#ff4d00', accentInk: '#000000', secondary: '#ffffff' },
  { id: 'paper-ink', label: 'Paper + brick', description: 'Aged cream paper, dense ink black and one brick spot colour. Printed, warm, permanent.', bg: '#f1e8d3', bgRaised: '#f7f0e0', fg: '#181410', muted: '#635b4d', accent: '#8e2f1c', accentInk: '#f1e8d3', secondary: '#2f4a63' },
  { id: 'void-violet', label: 'Void + violet', description: 'Deep near-black with violet and a candle-warm counterpoint. Scarce, precious light; mysterious and expensive.', bg: '#07060a', bgRaised: '#0e0b15', fg: '#ece7f2', muted: '#8d859c', accent: '#7c5cff', accentInk: '#0a0812', secondary: '#f2c98c' },
  { id: 'steel-signal', label: 'Steel + signal', description: 'Clean white with navy ink, one institutional blue and a restrained green. Rigorous, legible, financial-grade.', bg: '#ffffff', bgRaised: '#f6f8fb', fg: '#0b1727', muted: '#5a6b84', accent: '#1b4fd8', accentInk: '#ffffff', secondary: '#0b7a4b' },
  { id: 'electric-acid', label: 'Acid + electric', description: 'Black with acid green, electric blue and hot magenta at full saturation. Loud, fast, competitive.', bg: '#07070a', bgRaised: '#0c0c11', fg: '#f3f3f1', muted: '#9e9ea8', accent: '#d8ff3e', accentInk: '#07070a', secondary: '#3d7bff', tertiary: '#ff2d9b' },
  { id: 'bone-terracotta', label: 'Bone + terracotta', description: 'Warm neutrals with a muted terracotta accent. Handmade, gentle, human, unpolished on purpose.', bg: '#f6f1e8', bgRaised: '#fbf7f0', fg: '#2c2823', muted: '#6a6157', accent: '#a8452c', accentInk: '#fbf7f0', secondary: '#544d43' },
  { id: 'aurora-glass', label: 'Aurora glass', description: 'Light airy ground with iridescent violet, cyan and peach light. Optimistic, futuristic, luminous.', bg: '#f7f8fc', bgRaised: '#ffffff', fg: '#14162b', muted: '#4a5170', accent: '#7c5cff', accentInk: '#ffffff', secondary: '#38bdf8', tertiary: '#fdba74' },
  { id: 'noir-lime', label: 'Noir + lime', description: 'Near-black ground with one electric lime accent. High-impact, modern, editorial-dark.', bg: '#08080a', bgRaised: '#101014', fg: '#f2f0ea', muted: '#8a8a9b', accent: '#d8ff3e', accentInk: '#0b0d02', secondary: '#ff5c38' },
];

/* ================================================================== *
 * TYPOGRAPHY
 * ================================================================== */
export const TYPEFACES: TypeCandidate[] = [
  { id: 'grotesk-tight', label: 'Grotesk, tight', description: 'Neo-grotesque display at very large sizes with tight negative tracking and light-to-medium weights. Modern, confident, editorial.', display: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 500, tracking: '-0.035em', scale: 1, googleFonts: ['Space+Grotesk:wght@400;500;600;700', 'Inter:wght@400;500;600', 'JetBrains+Mono:wght@400;500'] },
  { id: 'editorial-serif', label: 'Editorial serif', description: 'High-contrast serif display with real editorial character, drop caps and true small text. Printed, literary, permanent.', display: "'Playfair Display', Georgia, serif", body: "'Source Serif 4', Georgia, serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 600, tracking: '-0.02em', scale: 0.95, googleFonts: ['Playfair+Display:wght@500;600;700', 'Source+Serif+4:opsz,wght@8..60,400;8..60,600', 'JetBrains+Mono:wght@400;500'] },
  { id: 'humanist-light', label: 'Humanist, light', description: 'Light humanist sans with wide tracking and generous line height. Quiet, calm, unhurried, weightless.', display: "'Karla', system-ui, sans-serif", body: "'Karla', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 300, tracking: '-0.005em', scale: 0.9, googleFonts: ['Karla:wght@300;400;500;600', 'JetBrains+Mono:wght@400;500'] },
  { id: 'mono-technical', label: 'Mono, technical', description: 'Monospace for nearly everything with condensed uppercase headings. Mechanical, annotated, control-panel.', display: "'Archivo', 'Arial Narrow', sans-serif", body: "'IBM Plex Mono', ui-monospace, monospace", mono: "'IBM Plex Mono', ui-monospace, monospace", displayWeight: 700, tracking: '0.01em', scale: 1.05, googleFonts: ['Archivo:wght@600;700;800', 'IBM+Plex+Mono:wght@400;500;600'] },
  { id: 'geometric-open', label: 'Geometric, open', description: 'Friendly geometric sans at comfortable weights with open tracking. Optimistic, clear, contemporary.', display: "'Outfit', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 500, tracking: '-0.02em', scale: 1, googleFonts: ['Outfit:wght@400;500;600;700', 'Inter:wght@400;500', 'JetBrains+Mono:wght@400;500'] },
  { id: 'rounded-friendly', label: 'Rounded, friendly', description: 'Chunky rounded display with soft terminals and heavy weights. Playful, toy-like, approachable.', display: "'Nunito', system-ui, sans-serif", body: "'Nunito', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 800, tracking: '-0.02em', scale: 1.05, googleFonts: ['Nunito:wght@400;600;700;800', 'JetBrains+Mono:wght@400;500'] },
  { id: 'condensed-heavy', label: 'Condensed, heavy', description: 'Heavy condensed italic display, often skewed and cropped by the viewport edge. Athletic, loud, fast.', display: "'Archivo', 'Arial Narrow', sans-serif", body: "'Archivo', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", displayWeight: 800, tracking: '-0.03em', scale: 1.15, googleFonts: ['Archivo:ital,wght@0,600;1,700;1,800', 'JetBrains+Mono:wght@400;500'] },
];

/* ================================================================== *
 * LAYOUT
 * ================================================================== */
export const LAYOUTS: LayoutCandidate[] = [
  { id: 'editorial-asymmetric', label: 'Editorial asymmetric', description: 'Twelve-column grid used unevenly, with deliberate asymmetry, offset spans and broken alignment. Structured but not tidy.', columns: 12, maxWidth: '96rem', gutter: 'clamp(1.25rem,4vw,3.5rem)', radius: '0', rules: true, displayFactor: 1 },
  { id: 'centered-measure', label: 'Centered measure', description: 'A single narrow column at a comfortable reading measure, wide margins, letter-like. Intimate and unhurried.', columns: 1, maxWidth: '46rem', gutter: 'clamp(1.5rem,6vw,5rem)', radius: '2px', rules: false, displayFactor: 0.6 },
  { id: 'rigid-grid', label: 'Rigid grid', description: 'Strict visible grid with consistent columns, aligned edges, hairline rules between regions. Institutional and verifiable.', columns: 12, maxWidth: '84rem', gutter: '1.5rem', radius: '0', rules: true, displayFactor: 0.85 },
  { id: 'full-bleed-cinematic', label: 'Full-bleed cinematic', description: 'Edge-to-edge scale with enormous type dominating the viewport and vast negative space. Monumental and cinematic.', columns: 12, maxWidth: '120rem', gutter: 'clamp(1rem,3vw,2.5rem)', radius: '0', rules: false, displayFactor: 1.2 },
  { id: 'modular-cards', label: 'Modular cards', description: 'Repeating modular blocks on a regular grid with generous radii and soft separation. Friendly, scannable, product-like.', columns: 12, maxWidth: '88rem', gutter: 'clamp(1.25rem,4vw,3rem)', radius: '1.25rem', rules: false, displayFactor: 0.95 },
];

/* ================================================================== *
 * MOTION — one axis, expressed as a whole motion language.
 * ================================================================== */
export const MOTIONS: MotionCandidate[] = [
  { id: 'glacial', label: 'Glacial', description: 'Very slow, weighty transitions well over a second with long decelerating eases. Approaching something enormous.', duration: '1200ms', ease: 'cubic-bezier(0.16,1,0.3,1)', tempo: 1.4 },
  { id: 'breath', label: 'Breath', description: 'Long ambient loops that expand and contract slowly, with soft fades rather than travel. Calm and continuous.', duration: '900ms', ease: 'cubic-bezier(0.37,0,0.63,1)', tempo: 1.2 },
  { id: 'snap-mechanical', label: 'Snap mechanical', description: 'Instant, linear or stepped state changes with essentially no easing. A machine switching state. Alerts and urgency.', duration: '90ms', ease: 'linear', tempo: 0.4 },
  { id: 'springy-playful', label: 'Springy playful', description: 'Bouncy overshoot and elastic settling, squash and stretch on interaction. Toy-like and rewarding.', duration: '420ms', ease: 'cubic-bezier(0.34,1.56,0.64,1)', tempo: 0.9 },
  { id: 'kinetic', label: 'Kinetic', description: 'Fast decisive transitions with constant background travel — marquees and motion that never fully stops.', duration: '140ms', ease: 'cubic-bezier(0.2,0.9,0.2,1)', tempo: 0.6 },
  { id: 'buoyant', label: 'Buoyant', description: 'Gentle upward rising and settling, as if content is lifting into place. Hopeful and light.', duration: '700ms', ease: 'cubic-bezier(0.22,1,0.36,1)', tempo: 1 },
];

/* ================================================================== *
 * DENSITY — the one axis asked as a Score (a position on a scale),
 * because "how much visual information per screen" is a degree, not a
 * category. Demonstrates the Score primitive end-to-end.
 * ================================================================== */
export const DENSITY_LEVELS = [
  'Very quiet: large type, few elements per screen, lots of empty space, low contrast between regions',
  'Balanced: comfortable density, clear hierarchy, moderate type sizes, some breathing room',
  'Dense: many elements per screen, smaller type, tight spacing, information-rich, high contrast between regions',
] as const;

export const DENSITY_IDS = ['quiet', 'balanced', 'dense'] as const;
export type DensityId = (typeof DENSITY_IDS)[number];

/* ================================================================== *
 * COMPOSITION — the page archetype.
 *
 * The other axes decide how a page LOOKS; this decides how it is STRUCTURED.
 * Without it every output was the same skeleton — hero, rail, grid, stats,
 * about, contact — wearing different colours, which is the most visible kind of
 * sameness a design tool can produce.
 * ================================================================== */
export const COMPOSITIONS: Candidate[] = [
  {
    id: 'classic-stack',
    label: 'Classic stack',
    description:
      'Full-width hero, then sections stacked in a single confident column: work, capabilities, numbers, story, contact. The dependable default.',
  },
  {
    id: 'split-hero',
    label: 'Split hero',
    description:
      'The opening is divided: statement on one side, visual or facts on the other. Work alternates left and right down the page in a zig-zag.',
  },
  {
    id: 'editorial-lede',
    label: 'Editorial lede',
    description:
      'A magazine opening. Very large statement, an indexed list of work rather than cards, a pull quote set large, and running text in measured columns.',
  },
  {
    id: 'bento-grid',
    label: 'Bento grid',
    description:
      'The page is a modular board of mixed-size tiles rather than a sequence of bands. Cards, facts and quotes all share one grid.',
  },
  {
    id: 'gallery-first',
    label: 'Gallery first',
    description:
      'Visual work leads immediately below a compact masthead. Text is deliberately minimal; the grid of pieces is the argument.',
  },
  {
    id: 'data-first',
    label: 'Data first',
    description:
      'Numbers and specifics lead: a prominent figures row and a dense spec table. Copy is short and factual; decoration is minimal.',
  },
  {
    id: 'manifesto',
    label: 'Manifesto',
    description:
      'One long typographic argument. Numbered points, generous space, almost no imagery — the page reads like a position statement.',
  },
];

/* ================================================================== *
 * EFFECTS — a curated CSS effect kit.
 *
 * Bundles, not toggles. Individually, effects can combine into incoherence
 * (grain + glass + letterpress on one surface); as kits, the model picks a
 * coherent visual treatment and the engine knows how to build all of it.
 *
 * This is where most of the surface-level variety comes from: two designs can
 * share a palette, a typeface and a composition and still look nothing alike.
 * ================================================================== */
export const EFFECT_KITS: Candidate[] = [
  {
    id: 'flat-plain',
    label: 'Flat and plain',
    description:
      'No ornament. Solid fills, hairline borders, no shadow, no texture, no gradient. The design carries itself through type and spacing alone.',
  },
  {
    id: 'hairline-editorial',
    label: 'Hairline editorial',
    description:
      'One-pixel rules between every region, hanging punctuation, tabular figures, and an accent rule beside the opening paragraph. Printed-page discipline.',
  },
  {
    id: 'technical-drawing',
    label: 'Technical drawing',
    description:
      'A faint measurement grid, accent crosshairs at headings, dashed outlines around work items, and tick marks. Everything looks annotated and verified.',
  },
  {
    id: 'soft-material',
    label: 'Soft material',
    description:
      'Layered soft shadows, a light-from-above top edge, inner highlight, generous corner radii. Surfaces feel physical and slightly raised.',
  },
  {
    id: 'organic-mesh',
    label: 'Organic mesh',
    description:
      'Large blurred colour washes bleeding in from the edges, and asymmetric blob-like corner radii. Fluid, hand-made, never geometric.',
  },
  {
    id: 'brutalist-block',
    label: 'Brutalist block',
    description:
      'Two-pixel borders, hard offset shadows in the accent colour, square corners, and a slight rotation on some tiles. Loud, confrontational, print-poster energy.',
  },
  {
    id: 'cinematic-depth',
    label: 'Cinematic depth',
    description:
      'Letterbox gradient bands top and bottom, a vignette, soft glow behind display type and heavy shadow under imagery. Photographic and atmospheric.',
  },
  {
    id: 'luminous-glass',
    label: 'Luminous glass',
    description:
      'Frosted translucent panels with an iridescent gradient hairline, an inner highlight, and a soft glow on the primary action. Iridescent, modern, light.',
  },
  {
    id: 'tactile-paper',
    label: 'Tactile paper',
    description:
      'Visible paper grain on raised bands, letterpress inset shadows, and a subtle emboss on display type. Physical, worn, printed.',
  },
];

/* ------------------------------------------------------------------ */
export const CANDIDATES = {
  emotion: EMOTIONS,
  composition: COMPOSITIONS,
  effects: EFFECT_KITS,
  palette: PALETTES,
  typography: TYPEFACES,
  layout: LAYOUTS,
  motion: MOTIONS,
} as const;

export const PALETTE_BY_ID = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
export const TYPE_BY_ID = Object.fromEntries(TYPEFACES.map((t) => [t.id, t]));
export const LAYOUT_BY_ID = Object.fromEntries(LAYOUTS.map((l) => [l.id, l]));
export const MOTION_BY_ID = Object.fromEntries(MOTIONS.map((m) => [m.id, m]));
export const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map((e) => [e.id, e]));
export const COMPOSITION_BY_ID = Object.fromEntries(COMPOSITIONS.map((c) => [c.id, c]));
export const EFFECTS_BY_ID = Object.fromEntries(EFFECT_KITS.map((e) => [e.id, e]));

/* ================================================================== *
 * ATMOSPHERE — curated from the variation harvest.
 *
 * Radial-gradient atmosphere was the single most-used craft technique across
 * the 10 variations (8/10), and the engine emitted none of it: every generated
 * page was tonally flat. This adds the missing *texture layer*.
 *
 * Crucially the layers are built from PALETTE tokens, not literal colours,
 * because emotion and palette are chosen independently — a literal
 * emotion-coloured wash would clash whenever the two disagree. Shape and
 * intensity come from the emotion; hue comes from the palette, so they always
 * harmonise.
 *
 * This is a derived treatment, not a further Jev decision: asking a second
 * question here would cost a round-trip for something the emotion already
 * determines.
 * ================================================================== */
export interface AtmosphereSpec {
  /** Background layers as a CSS `background` shorthand. */
  layers: string;
  /** Grain overlay opacity; 0 disables it. */
  grain: number;
  /** Adds a single hairline horizon line — used for the vast emotions. */
  horizon: boolean;
}

const wash = (alpha: number) => `color-mix(in oklab, var(--accent) ${alpha}%, transparent)`;
const wash2 = (alpha: number) => `color-mix(in oklab, var(--secondary) ${alpha}%, transparent)`;

export const ATMOSPHERE: Record<string, AtmosphereSpec> = {
  awe: {
    layers: `radial-gradient(120% 70% at 50% -18%, ${wash(18)}, transparent 62%), radial-gradient(70% 40% at 50% 108%, ${wash(7)}, transparent 70%)`,
    grain: 0.05,
    horizon: true,
  },
  serenity: {
    layers: `radial-gradient(60% 50% at 12% 18%, ${wash(13)}, transparent 70%), radial-gradient(55% 45% at 88% 72%, ${wash2(15)}, transparent 72%)`,
    grain: 0.03,
    horizon: false,
  },
  delight: {
    layers: `radial-gradient(30% 26% at 18% 14%, ${wash(22)}, transparent 70%), radial-gradient(26% 22% at 84% 26%, ${wash2(20)}, transparent 70%), radial-gradient(34% 30% at 62% 88%, ${wash(16)}, transparent 72%)`,
    grain: 0,
    horizon: false,
  },
  tension: {
    // Deliberately flat: severity reads better against nothing. Scanlines only.
    layers: `repeating-linear-gradient(0deg, color-mix(in oklab, var(--fg) 3%, transparent) 0 1px, transparent 1px 4px)`,
    grain: 0,
    horizon: false,
  },
  nostalgia: {
    layers: `radial-gradient(120% 100% at 50% 40%, transparent 55%, ${wash2(12)}), radial-gradient(70% 50% at 50% 0%, ${wash(9)}, transparent 70%)`,
    grain: 0.07,
    horizon: false,
  },
  mystery: {
    layers: `radial-gradient(50% 40% at 70% 12%, ${wash(14)}, transparent 68%), radial-gradient(120% 100% at 50% 50%, transparent 42%, color-mix(in oklab, var(--bg) 78%, transparent))`,
    grain: 0.06,
    horizon: false,
  },
  trust: {
    // Barely there on purpose: clarity is the aesthetic.
    layers: `radial-gradient(90% 60% at 50% -10%, ${wash(4)}, transparent 70%)`,
    grain: 0,
    horizon: false,
  },
  energy: {
    layers: `conic-gradient(from 210deg at 78% 12%, ${wash(20)}, transparent 28%, ${wash2(18)} 46%, transparent 62%), radial-gradient(80% 50% at 10% 90%, ${wash(12)}, transparent 70%)`,
    grain: 0.04,
    horizon: false,
  },
  intimacy: {
    layers: `radial-gradient(110% 90% at 50% 45%, transparent 58%, ${wash2(10)}), radial-gradient(60% 45% at 30% 8%, ${wash(8)}, transparent 72%)`,
    grain: 0.08,
    horizon: false,
  },
  optimism: {
    layers: `radial-gradient(55% 45% at 15% 8%, ${wash(20)}, transparent 70%), radial-gradient(50% 42% at 88% 22%, ${wash2(18)}, transparent 72%), radial-gradient(70% 55% at 55% 105%, ${wash(12)}, transparent 74%)`,
    grain: 0.02,
    horizon: false,
  },
  other: {
    layers: `radial-gradient(90% 60% at 50% -10%, ${wash(8)}, transparent 70%)`,
    grain: 0.03,
    horizon: false,
  },
};

export function atmosphereFor(emotion: string): AtmosphereSpec {
  return ATMOSPHERE[emotion] ?? ATMOSPHERE.other!;
}

/* ================================================================== *
 * PALETTE → VISIBLE CHARACTERISTICS
 *
 * Image models do not know what "hazard-mono" or "aurora-glass" means. Feeding
 * a palette id into a prompt gets whatever the model associates with the word,
 * not the palette — the first generated pass came back cream-coloured on a
 * black-and-orange page for exactly this reason.
 *
 * These phrases translate a palette into visible colour and light, which is
 * what an image prompt actually needs.
 * ================================================================== */
export const PALETTE_VISUAL: Record<string, string> = {
  'arctic-cyan': 'near-black depths lit by a single cold pale-cyan source, deep shadow',
  'sage-mist': 'soft warm off-white, muted sage green and clay, low contrast',
  'candy-pop': 'bright cream with saturated pink, tangerine and grape accents',
  'hazard-mono': 'stark black and white with a single safety-orange accent, very high contrast',
  'paper-ink': 'aged cream paper with dense black ink and brick-red spot colour',
  'void-violet': 'deep near-black with violet light and a candle-warm amber counterpoint',
  'steel-signal': 'clean white and pale grey with navy ink and institutional blue',
  'electric-acid': 'black with acid green and electric blue, high saturation',
  'bone-terracotta': 'warm bone and oatmeal with muted terracotta, low saturation',
  'aurora-glass': 'pale luminous ground with violet, cyan and peach iridescence',
  'noir-lime': 'near-black with a single electric lime accent',
};

export function paletteVisual(paletteId: string): string {
  return PALETTE_VISUAL[paletteId] ?? 'restrained neutral colour, moderate contrast';
}

