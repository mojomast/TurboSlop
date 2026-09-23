/**
 * TurboSlop — the bundled font pack.
 *
 * A tiny, self-hosted alternative to the `googleFonts` references in the
 * catalog: one genuinely variable, SIL Open Font License 1.1 family per
 * typographic direction, shipped as latin-subset woff2 files under
 * `public/fonts/`. Exported pages can therefore load type with no remote font
 * request at all.
 *
 * This module is deliberately pure — no `fs`, no network — so it is safe to
 * import from the browser bundle, the renderer and the tests alike. The byte
 * counts in `FONT_BYTES` describe the committed files and are asserted by
 * `test/fonts.test.ts`; they are not used for allocation, only for the ZIP
 * export manifest and the summary.
 *
 * Run `npx tsx scripts/fetch-fonts.ts` to (re)fetch the files and the licence
 * text. The script is idempotent: verified files are left untouched.
 */

export const FONT_DIRECTIONS = ['poster', 'literary', 'friendly', 'technical', 'restrained'] as const;
export type FontDirection = (typeof FONT_DIRECTIONS)[number];

export interface FontFace {
  direction: FontDirection;
  /** CSS font-family name to use, e.g. 'TS Poster'. */
  family: string;
  /** File under public/fonts/, e.g. 'archivo-latin-var.woff2'. */
  file: string;
  /** variable axis descriptor, e.g. "'wght' 100 900" or "'opsz' 8 60, 'wght' 200 900" */
  variation?: string;
  weightRange: [number, number];
  /**
   * Width axis range in percent, emitted as the @font-face `font-stretch`
   * descriptor so `font-stretch` on the page can actually move the `wdth` axis.
   * Omitted for faces without a width axis.
   */
  stretchRange?: [number, number];
  /** licences: spdx + human name + where the text lives */
  license: { spdx: string; name: string; file: string };
  /** what it is for, in one line */
  note: string;
}

/** Every file a bundled family ships, keyed by file name. */
const FONT_BYTES: Record<string, number> = {
  'archivo-latin-var.woff2': 90104,
  'source-serif-4-latin-var.woff2': 122360,
  'nunito-latin-var.woff2': 39128,
  'jetbrains-mono-latin-var.woff2': 40404,
  'inter-latin-var.woff2': 48256,
};

const OFL = { spdx: 'OFL-1.1', name: 'SIL Open Font License 1.1', file: 'public/fonts/LICENSES.md' } as const;

export const FONT_PACK: FontFace[] = [
  {
    direction: 'poster',
    family: 'Archivo',
    file: 'archivo-latin-var.woff2',
    variation: "'wdth' 62 125, 'wght' 100 900",
    weightRange: [100, 900],
    stretchRange: [62, 125],
    license: { ...OFL },
    note: 'Variable grotesque with a wide weight AND width axis — poster-scale display type that can condense or expand.',
  },
  {
    direction: 'literary',
    family: 'Source Serif 4',
    file: 'source-serif-4-latin-var.woff2',
    variation: "'opsz' 8 60, 'wght' 200 900",
    weightRange: [200, 900],
    license: { ...OFL },
    note: 'Optical-size serif for editorial reading, drop caps and literary long-form.',
  },
  {
    direction: 'friendly',
    family: 'Nunito',
    file: 'nunito-latin-var.woff2',
    variation: "'wght' 200 1000",
    weightRange: [200, 1000],
    license: { ...OFL },
    note: 'Rounded humanist sans — soft, toy-like and approachable.',
  },
  {
    direction: 'technical',
    family: 'JetBrains Mono',
    file: 'jetbrains-mono-latin-var.woff2',
    variation: "'wght' 100 800",
    weightRange: [100, 800],
    license: { ...OFL },
    note: 'Monospace for annotations, labels and control-panel body text.',
  },
  {
    direction: 'restrained',
    family: 'Inter',
    file: 'inter-latin-var.woff2',
    variation: "'wght' 100 900",
    weightRange: [100, 900],
    license: { ...OFL },
    note: 'Neutral low-contrast sans — quiet, legible, invisible when it should be.',
  },
];

/**
 * Which direction a catalog typeface id should draw from. Total: every id in
 * `TYPEFACES` is mapped, and anything unknown falls back to `'restrained'`
 * rather than returning `undefined`.
 */
const TYPEFACE_DIRECTION: Record<string, FontDirection> = {
  'grotesk-tight': 'poster',
  'condensed-heavy': 'poster',
  'editorial-serif': 'literary',
  'geometric-open': 'friendly',
  'rounded-friendly': 'friendly',
  'mono-technical': 'technical',
  'humanist-light': 'restrained',
};

/** Which direction a typeface id from the catalog should use. Total function. */
export function fontDirectionFor(typefaceId: string): FontDirection {
  return TYPEFACE_DIRECTION[typefaceId] ?? 'restrained';
}

/** The @font-face block for ONE direction, with a local url under `basePath`. */
export function fontFaceCss(direction: FontDirection, basePath = '../fonts/'): string {
  const face = FONT_PACK.find((f) => f.direction === direction);
  if (!face) return '';
  const [wMin, wMax] = face.weightRange;
  const lines = [
    '@font-face {',
    `  font-family: '${face.family}';`,
    '  font-style: normal;',
    `  font-weight: ${wMin} ${wMax};`,
    ...(face.stretchRange ? [`  font-stretch: ${face.stretchRange[0]}% ${face.stretchRange[1]}%;`] : []),
    '  font-display: swap;',
    `  src: url('${basePath}${face.file}') format('woff2');`,
  ];
  if (face.variation) lines.push(`  font-variation-settings: ${face.variation};`);
  lines.push('}');
  return lines.join('\n');
}

/** The @font-face block for ONLY the directions a page actually uses. */
export function fontFaceCssFor(directions: FontDirection[], basePath = '../fonts/'): string {
  const wanted = new Set(directions);
  return FONT_DIRECTIONS.filter((d) => wanted.has(d))
    .map((d) => fontFaceCss(d, basePath))
    .filter((css) => css.length > 0)
    .join('\n\n');
}

/** Every font file a set of directions needs, for the ZIP export manifest. */
export function fontFilesFor(directions: FontDirection[]): { file: string; path: string; bytes: number }[] {
  const wanted = new Set(directions);
  return FONT_PACK.filter((f) => wanted.has(f.direction)).map((f) => ({
    file: f.file,
    path: `public/fonts/${f.file}`,
    bytes: FONT_BYTES[f.file] ?? 0,
  }));
}

/** Human summary for the control surface: which families are bundled. */
export function describeFontPack(): string {
  const total = FONT_PACK.reduce((sum, f) => sum + (FONT_BYTES[f.file] ?? 0), 0);
  const families = FONT_PACK.map((f) => `${f.direction}=${f.family}`).join(', ');
  return `TurboSlop font pack: ${FONT_PACK.length} bundled OFL variable families, ${(total / 1024).toFixed(1)} KB — ${families}.`;
}

/* ------------------------------------------------------------------ *
 * Integration helpers
 *
 * A catalog typeface is a RECIPE (weight, tracking, scale, construction), and
 * the bundled pack supplies the actual file. Putting the bundled family first in
 * the stack is what makes an exported page render as intended with no network.
 * ------------------------------------------------------------------ */
/** The bundled family name serving a catalog typeface id, if any. */
export function bundledFamilyFor(typefaceId: string): string | undefined {
  return FONT_PACK.find((f) => f.direction === fontDirectionFor(typefaceId))?.family;
}

/** A CSS font stack with the bundled face first, falling back to `original`. */
export function bundledStackFor(typefaceId: string, original: string): string {
  const fam = bundledFamilyFor(typefaceId);
  if (!fam) return original;
  // If the original already names it, do not duplicate.
  return original.includes(fam) ? original : `'${fam}', ${original}`;
}

/** The directions a page needs, given the typeface it chose. */
export function directionsFor(typefaceId: string): FontDirection[] {
  return [fontDirectionFor(typefaceId)];
}

/** Every bundled family name, for the export manifest and the surface. */
export function bundledFamilies(): string[] {
  return FONT_PACK.map((f) => f.family);
}
