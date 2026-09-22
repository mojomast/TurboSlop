/**
 * TurboSlop — motif generator.
 *
 * A motif is a small, decorative SVG field used as a background or ornament
 * layer on a generated page: halftone dots, topographic contours, hatch lines,
 * a drafting grid, or a perforated stamp edge. Each family is a genuinely
 * different drawing, not a parameter tweak of another.
 *
 * Everything here is a PURE STRING GENERATOR. No DOM, no network, no
 * filesystem, no dependencies, no clock: given the same MotifSpec the output is
 * byte-identical. That makes motifs safe to build in Node, in a worker, or in a
 * browser-like context, and safe to cache by `id`.
 *
 * ## Why the geometry is bounded
 *
 * A motif is ornament, not content, so every builder caps its own element count.
 * At 1200x800 and density 1 the worst cases, measured as `<`-tag counts
 * (opening tags plus the closing `</svg>`), are:
 *   - halftone:  23x15 grid             = 345 circles          -> 347
 *   - hatching:  172 + 140 hatch lines   = 312 lines            -> 314
 *   - stamp:     2*(46+30) perforations  = 152 dots + 2 rules   -> 156
 *   - technical: 50 grid + 50 ticks + 4 crosshair arms + 1 dimension -> 107
 *   - contour:   10 nested rings                                -> 12
 * All well under the ~400 element budget. Numbers are rounded to two decimals
 * to keep bytes down, and every value goes through `f()` so NaN, Infinity and
 * undefined can never reach the markup.
 *
 * ## Colour
 *
 * Geometry is painted with `var(--motif-ink, <ink>)` so a page can recolour a
 * motif from CSS, while the concrete palette-derived ink remains as the
 * fallback so the standalone `.svg` file looks right on its own.
 */

export const MOTIF_FAMILIES = ['halftone', 'contour', 'hatching', 'technical', 'stamp'] as const;
export type MotifFamily = (typeof MOTIF_FAMILIES)[number];

export interface MotifSpec {
  family: MotifFamily;
  seed: number;
  width: number;
  height: number;
  /** Palette-derived ink colour, e.g. '#a9e6ff'. */
  ink: string;
  /** Palette-derived ground colour, used only for masking/contrast decisions. */
  ground: string;
  /** 0..1 — how dense/busy the field is. Comes from the page's density axis. */
  density?: number;
}

export interface Motif {
  /** Stable, deterministic: `${family}-${seed}-${width}x${height}`. */
  id: string;
  family: MotifFamily;
  /** A complete, standalone <svg> element string. */
  svg: string;
  width: number;
  height: number;
  /** Suggested filename when persisted, e.g. 'motif-halftone-42.svg'. */
  filename: string;
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 *
 * The EXACT mulberry32 used by src/directions.ts, copied here rather than
 * imported so this module has no dependency on the direction selector (and so
 * no import cycle). Do not "improve" it — the byte-for-byte reproducibility of
 * every motif depends on this algorithm.
 * ------------------------------------------------------------------ */
function mulberry32(seed: number): () => number {
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
 * Bounds and numeric safety
 * ------------------------------------------------------------------ */
const MIN_SIZE = 64;
const MAX_SIZE = 4000;
const DEFAULT_SIZE = 512;
const DEFAULT_DENSITY = 0.5;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function clampSize(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SIZE;
  return Math.round(clamp(v, MIN_SIZE, MAX_SIZE));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_DENSITY;
  return clamp(v, 0, 1);
}

/** Round for markup. Guards every numeric value; never emits NaN/Infinity/-0. */
function f(x: number): string {
  let v = Number.isFinite(x) ? x : 0;
  if (Math.abs(v) < 0.005) v = 0;
  return v.toFixed(2);
}

/**
 * Colours are interpolated straight into attribute values, so anything that is
 * not a hex literal or a plain named colour is replaced by the fallback. This
 * is also the injection guard for the generated markup.
 */
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim() : fallback;
}

/* ------------------------------------------------------------------ *
 * Colour maths (used by motifInk)
 * ------------------------------------------------------------------ */
type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  const c = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB relative luminance, 0 (black) .. 1 (white). */
function relLum([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function isLightGround(ground: string): boolean {
  const g = parseHex(ground);
  return g ? relLum(g) > 0.4 : false;
}

/* ------------------------------------------------------------------ *
 * Public colour API
 * ------------------------------------------------------------------ */
/**
 * Derive a motif ink from a real accent colour and the ground it will sit on.
 * If the accent already separates from the ground we keep it; if it would sink
 * into the ground we push it toward white (on dark grounds) or black (on light
 * grounds) until it is legible. Deterministic, and always `#rrggbb`.
 */
export function motifInk(accent: string, ground: string): string {
  const a = parseHex(accent);
  if (!a) return '#000000';
  const g = parseHex(ground);
  if (!g) return toHex(a);
  if (contrast(a, g) >= 2.2) return toHex(a);
  const target: Rgb = relLum(g) < 0.4 ? [255, 255, 255] : [0, 0, 0];
  return toHex(mix(a, target, 0.55));
}

/* ------------------------------------------------------------------ *
 * Shared SVG scaffold
 * ------------------------------------------------------------------ */
function openSvg(family: MotifFamily, w: number, h: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" ` +
    `aria-hidden="true" focusable="false" data-motif="${family}">`
  );
}

/* ------------------------------------------------------------------ *
 * halftone — a dot grid whose radius varies smoothly across the field.
 * Worst case (1200x800, density 1): 23x15 grid = 345 circles -> 347 tags.
 * ------------------------------------------------------------------ */
function buildHalftone(seed: number, w: number, h: number, density: number, ink: string): string {
  const rand = mulberry32(seed);
  const inkVar = `var(--motif-ink, ${ink})`;
  const cols = Math.max(4, Math.round(9 + density * 14)); // 9..23
  const rows = Math.max(3, Math.round(6 + density * 9)); // 6..15
  const cw = w / cols;
  const ch = h / rows;
  const base = Math.min(cw, ch) * 0.5;
  const scale = 0.3 + 0.7 * density;
  const phaseX = rand() * Math.PI * 2;
  const phaseY = rand() * Math.PI * 2;
  const out: string[] = [openSvg('halftone', w, h)];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = (i + 0.5) * cw;
      const cy = (j + 0.5) * ch;
      // A smooth two-axis standing wave, seeded in phase: radius drifts from
      // small to large across the field instead of looking like random noise.
      const wave = 0.5 + 0.5 * Math.sin(i * 0.55 + phaseX + Math.cos(j * 0.42 + phaseY));
      const r = Math.max(0.5, base * (0.12 + 0.88 * wave) * scale);
      out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${inkVar}"/>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * contour — nested topographic lines sliced from a seeded elliptical field.
 * Worst case (1200x800, density 1): 10 nested rings -> 12 tags.
 * ------------------------------------------------------------------ */
function buildContour(seed: number, w: number, h: number, density: number, ink: string): string {
  const rand = mulberry32(seed);
  const inkVar = `var(--motif-ink, ${ink})`;
  const rings = Math.max(2, Math.round(3 + density * 7)); // 3..10
  const PTS = 18;
  const cx = w * (0.32 + 0.36 * rand());
  const cy = h * (0.32 + 0.36 * rand());
  const baseR = Math.min(w, h);
  const a1 = 0.06 + 0.1 * rand();
  const k1 = 2 + Math.floor(rand() * 3);
  const p1 = rand() * Math.PI * 2;
  const a2 = 0.04 + 0.08 * rand();
  const k2 = 3 + Math.floor(rand() * 3);
  const p2 = rand() * Math.PI * 2;
  const aspect = 0.9 + 0.6 * rand();
  const out: string[] = [openSvg('contour', w, h)];
  for (let ri = 0; ri < rings; ri++) {
    const t = (ri + 1) / rings;
    const R = baseR * (0.06 + 0.44 * t);
    const rx = R * aspect;
    const ry = R / aspect;
    const pts: [number, number][] = [];
    for (let k = 0; k < PTS; k++) {
      const th = (k / PTS) * Math.PI * 2;
      // Shared harmonics keep the rings nested; the seed moves where the
      // "terrain" bulges, so two seeds are different maps of the same island.
      const wob = 1 + a1 * Math.sin(k1 * th + p1) + a2 * Math.sin(k2 * th + p2);
      pts.push([
        clamp(cx + rx * Math.cos(th) * wob, 0, w),
        clamp(cy + ry * Math.sin(th) * wob, 0, h),
      ]);
    }
    const sw = 1.1 - 0.35 * t;
    const opacity = 0.9 - t * 0.4;
    out.push(
      `<path d="${smoothClosed(pts)}" stroke="${inkVar}" stroke-width="${f(sw)}" ` +
        `stroke-opacity="${f(opacity)}" fill="none"/>`,
    );
  }
  out.push('</svg>');
  return out.join('');
}

/** Catmull-Rom through the points, converted to closed cubic Bezier segments. */
function smoothClosed(p: [number, number][]): string {
  const n = p.length;
  const first = p[0]!;
  let d = `M ${f(first[0])} ${f(first[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!;
    const p1 = p[i]!;
    const p2 = p[(i + 1) % n]!;
    const p3 = p[(i + 2) % n]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

/* ------------------------------------------------------------------ *
 * hatching — a parallel (and, when busy, cross) line field.
 * Worst case (1200x800, density 1): 172 + 140 = 312 lines -> 314 tags.
 * Gaps are drawn as extra subpaths inside one element, so they do not grow
 * the element budget.
 * ------------------------------------------------------------------ */
function buildHatching(seed: number, w: number, h: number, density: number, ink: string, ground: string): string {
  const rand = mulberry32(seed);
  const inkVar = `var(--motif-ink, ${ink})`;
  const out: string[] = [openSvg('hatching', w, h)];
  const diag = Math.hypot(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const sw = Math.max(0.35, 1.4 - density * 0.7);
  const opacity = isLightGround(ground) ? 0.55 : 0.7;
  const baseAngle = rand() * Math.PI;

  const draw = (angle: number, count: number): void => {
    if (count < 1) return;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const nx = -dy;
    const ny = dx;
    const spacing = diag / count;
    const half = diag / 2;
    for (let i = 0; i < count; i++) {
      let t = (i - (count - 1) / 2) * spacing;
      t += (rand() - 0.5) * spacing * 0.3; // seeded spacing jitter
      const px = cx + nx * t;
      const py = cy + ny * t;
      const x1 = px - dx * half;
      const y1 = py - dy * half;
      const x2 = px + dx * half;
      const y2 = py + dy * half;
      if (rand() < 0.12) {
        const g0 = 0.3 + rand() * 0.15;
        const g1 = 0.6 + rand() * 0.15;
        const ax = x1 + (x2 - x1) * g0;
        const ay = y1 + (y2 - y1) * g0;
        const bx = x1 + (x2 - x1) * g1;
        const by = y1 + (y2 - y1) * g1;
        out.push(
          `<path d="M ${f(x1)} ${f(y1)} L ${f(ax)} ${f(ay)} M ${f(bx)} ${f(by)} L ${f(x2)} ${f(y2)}" ` +
            `stroke="${inkVar}" stroke-width="${f(sw)}" stroke-opacity="${f(opacity)}"/>`,
        );
      } else {
        out.push(
          `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ` +
            `stroke="${inkVar}" stroke-width="${f(sw)}" stroke-opacity="${f(opacity)}"/>`,
        );
      }
    }
  };

  const primary = Math.max(2, Math.round(22 + density * 150)); // 22..172
  draw(baseAngle, primary);
  if (density >= 0.45) {
    const cross = Math.round(((density - 0.45) / 0.55) * 140); // 0..140
    draw(baseAngle + Math.PI / 2 - rand() * 0.35, cross);
  }
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * technical — a drafting grid with ticks, crosshairs and one dimension line.
 * Worst case (1200x800, density 1): 50 grid + 50 ticks + 4 crosshair arms +
 * 1 dimension path -> 107 tags.
 * ------------------------------------------------------------------ */
function buildTechnical(seed: number, w: number, h: number, density: number, ink: string, ground: string): string {
  const rand = mulberry32(seed);
  const inkVar = `var(--motif-ink, ${ink})`;
  const out: string[] = [openSvg('technical', w, h)];
  const cols = Math.max(4, Math.round(8 + density * 20)); // 8..28
  const rows = Math.max(3, Math.round(6 + density * 14)); // 6..20
  const cw = w / cols;
  const ch = h / rows;
  const edgeOpacity = isLightGround(ground) ? 0.42 : 0.6;

  for (let i = 0; i <= cols; i++) {
    const x = i * cw;
    const major = i % 4 === 0;
    out.push(
      `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${f(h)}" stroke="${inkVar}" ` +
        `stroke-width="${major ? '0.9' : '0.4'}" stroke-opacity="${f(major ? edgeOpacity : edgeOpacity * 0.55)}"/>`,
    );
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * ch;
    const major = j % 4 === 0;
    out.push(
      `<line x1="0" y1="${f(y)}" x2="${f(w)}" y2="${f(y)}" stroke="${inkVar}" ` +
        `stroke-width="${major ? '0.9' : '0.4'}" stroke-opacity="${f(major ? edgeOpacity : edgeOpacity * 0.55)}"/>`,
    );
  }

  const tick = Math.min(16, ch * 0.8);
  for (let i = 0; i <= cols; i++) {
    const x = i * cw;
    out.push(
      `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${f(tick)}" stroke="${inkVar}" ` +
        `stroke-width="1" stroke-opacity="${f(edgeOpacity + 0.15)}"/>`,
    );
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * ch;
    out.push(
      `<line x1="0" y1="${f(y)}" x2="${f(tick)}" y2="${f(y)}" stroke="${inkVar}" ` +
        `stroke-width="1" stroke-opacity="${f(edgeOpacity + 0.15)}"/>`,
    );
  }

  for (let c = 0; c < 2; c++) {
    const cxp = w * (0.18 + 0.64 * rand());
    const cyp = h * (0.18 + 0.64 * rand());
    const arm = Math.min(w, h) * (0.045 + 0.035 * rand());
    out.push(
      `<line x1="${f(cxp - arm)}" y1="${f(cyp)}" x2="${f(cxp + arm)}" y2="${f(cyp)}" ` +
        `stroke="${inkVar}" stroke-width="1.4" stroke-opacity="0.9"/>`,
    );
    out.push(
      `<line x1="${f(cxp)}" y1="${f(cyp - arm)}" x2="${f(cxp)}" y2="${f(cyp + arm)}" ` +
        `stroke="${inkVar}" stroke-width="1.4" stroke-opacity="0.9"/>`,
    );
  }

  const dlineY = h * 0.87;
  const x0 = w * 0.1;
  const x1 = x0 + w * (0.32 + 0.28 * rand());
  const dtick = Math.min(14, ch);
  out.push(
    `<path d="M ${f(x0)} ${f(dlineY)} L ${f(x1)} ${f(dlineY)} ` +
      `M ${f(x0)} ${f(dlineY - dtick)} L ${f(x0)} ${f(dlineY + dtick)} ` +
      `M ${f(x1)} ${f(dlineY - dtick)} L ${f(x1)} ${f(dlineY + dtick)}" ` +
      `stroke="${inkVar}" stroke-width="1" stroke-opacity="0.8"/>`,
  );
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * stamp — a perforated postage-stamp edge plus inner rules.
 * Worst case (1200x800, density 1): 2*(46+30) = 152 perforations + 2 rules
 * -> 156 tags. Each edge count is hard-capped at 70, so even a 4000x4000 field
 * stays at 284 tags.
 * ------------------------------------------------------------------ */
function buildStamp(seed: number, w: number, h: number, density: number, ink: string): string {
  const rand = mulberry32(seed);
  const inkVar = `var(--motif-ink, ${ink})`;
  const out: string[] = [openSvg('stamp', w, h)];
  const spacing = Math.max(12, 92 - density * 66); // 92..26
  const nx = clamp(Math.floor(w / spacing), 6, 70);
  const ny = clamp(Math.floor(h / spacing), 5, 70);
  const rr = spacing * 0.3 * (0.85 + 0.3 * density);

  const dot = (x: number, y: number): void => {
    const r = Math.max(1.2, rr * (0.82 + 0.36 * rand()));
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${inkVar}"/>`);
  };
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * (w / nx);
    dot(x, 0);
    dot(x, h);
  }
  for (let j = 0; j < ny; j++) {
    const y = (j + 0.5) * (h / ny);
    dot(0, y);
    dot(w, y);
  }

  const inset = Math.max(6, Math.min(w, h) * (0.06 + 0.02 * density));
  out.push(
    `<rect x="${f(inset)}" y="${f(inset)}" width="${f(w - inset * 2)}" height="${f(h - inset * 2)}" ` +
      `stroke="${inkVar}" stroke-width="1" stroke-opacity="0.75" fill="none"/>`,
  );
  out.push(
    `<rect x="${f(inset * 2)}" y="${f(inset * 2)}" width="${f(w - inset * 4)}" height="${f(h - inset * 4)}" ` +
      `stroke="${inkVar}" stroke-width="0.6" stroke-opacity="0.4" stroke-dasharray="6 5" fill="none"/>`,
  );
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */
type Builder = (seed: number, w: number, h: number, density: number, ink: string, ground: string) => string;

const BUILDERS: Record<MotifFamily, Builder> = {
  halftone: (s, w, h, d, ink) => buildHalftone(s, w, h, d, ink),
  contour: (s, w, h, d, ink) => buildContour(s, w, h, d, ink),
  hatching: buildHatching,
  technical: buildTechnical,
  stamp: (s, w, h, d, ink) => buildStamp(s, w, h, d, ink),
};

/**
 * Deterministic: the same spec yields a byte-identical svg. Inputs are clamped
 * and sanitised rather than trusted; an unknown family is the only hard error.
 */
export function generateMotif(spec: MotifSpec): Motif {
  const family = spec.family;
  if (!Object.prototype.hasOwnProperty.call(BUILDERS, family)) {
    throw new Error(
      `motif: unknown family "${String(family)}" (expected one of ${MOTIF_FAMILIES.join(', ')})`,
    );
  }
  const seed = Number.isFinite(spec.seed) ? Math.trunc(spec.seed) : 0;
  const width = clampSize(spec.width);
  const height = clampSize(spec.height);
  const density = clamp01(spec.density ?? DEFAULT_DENSITY);
  const ink = safeColor(spec.ink, '#000000');
  const ground = safeColor(spec.ground, '#ffffff');
  const svg = BUILDERS[family](seed, width, height, density, ink, ground);
  return {
    id: `${family}-${seed}-${width}x${height}`,
    family,
    svg,
    width,
    height,
    filename: `motif-${family}-${seed}.svg`,
  };
}

/* ------------------------------------------------------------------ *
 * Emotion -> family
 *
 * Coordinate, do not randomise: every direction built for the same emotion
 * should reach for the same decorative language. Unlisted emotions fall back
 * to a valid family rather than undefined.
 * ------------------------------------------------------------------ */
const MOTIF_BY_EMOTION: Record<string, MotifFamily> = {
  awe: 'contour',
  serenity: 'hatching',
  delight: 'halftone',
  tension: 'technical',
  nostalgia: 'stamp',
  mystery: 'contour',
  trust: 'technical',
  energy: 'hatching',
  intimacy: 'hatching',
  optimism: 'halftone',
  other: 'stamp',
};

/** Which motif family suits an emotion. Total: never returns undefined. */
export function motifFamilyForEmotion(emotion: string): MotifFamily {
  return MOTIF_BY_EMOTION[emotion] ?? 'halftone';
}

/**
 * A URL-encoded (NOT base64) data URI for inlining in CSS
 * `background-image: url(...)`. Encoding is what keeps `#` in the ink colour,
 * and the `<`/`>`/quotes, from breaking the stylesheet.
 */
export function motifToDataUri(motif: Motif): string {
  return `data:image/svg+xml,${encodeURIComponent(motif.svg)}`;
}
