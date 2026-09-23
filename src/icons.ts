/**
 * TurboSlop — icon families.
 *
 * Two families share ONE house wrapper:
 *   - `turboslop` — ORIGINAL WORK. Every glyph is a simple geometric line
 *     drawing made by this project, specifically for TurboSlop. None of it is
 *     copied, traced or derived from a known icon library. Released under the
 *     repository's MIT licence (see LICENSE); `ICON_LICENSE` records the
 *     attribution so the repo can never ship unattributed third-party art.
 *   - `lucide` — 69 curated outline glyphs vendored from Lucide (ISC) at a
 *     pinned commit. The geometry is generated data in `src/iconpacks.ts`; the
 *     verbatim upstream licence travels in `public/icons/LICENSES.md`.
 *
 * FAMILY RULE — one consistent stroke family, identical for both:
 *   - 24 x 24 viewBox, drawn on a 1 unit grid with a comfortable inner margin
 *   - a single stroke width of 1.6 for every icon (no weight variation)
 *   - `stroke-linecap="round"` and `stroke-linejoin="round"` everywhere
 *   - outlines only: `fill="none"` on the root, no filled shapes mixed in
 *   - colour is always `stroke="currentColor"`, so an icon inherits its context
 * `ICON_PROFILES` states that rule as data; the consistency test in
 * test/assets.test.ts asserts it per family, so a future edit cannot quietly
 * break one family while the other still renders.
 *
 * A page uses exactly ONE family (the visual blueprint chooses it): an icon
 * vocabulary is a voice, and mixing two voices on one page reads as an accident.
 */

import {
  LUCIDE_GLYPHS,
  LUCIDE_ICON_NAMES,
  LUCIDE_COMMIT,
  LUCIDE_SOURCE,
  type LucideIconName,
} from './iconpacks.js';

export const ICON_NAMES = [
  'arrow-right',
  'arrow-up-right',
  'check',
  'plus',
  'minus',
  'menu',
  'close',
  'search',
  'mail',
  'phone',
  'map-pin',
  'clock',
  'calendar',
  'download',
  'external',
  'quote',
  'star',
  'cart',
  'play',
  'chevron-down',
  'info',
  'shield',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** The families a page may draw from. Exactly one per page. */
export const ICON_FAMILIES = ['turboslop', 'lucide'] as const;
export type IconFamily = (typeof ICON_FAMILIES)[number];

/** The one stroke width shared by every icon in every family. */
const ICON_STROKE = 1.6;
/** The grid every icon is drawn on. */
const ICON_GRID = 24;

export interface IconLicense {
  /** Human-facing family name. */
  name: string;
  /** SPDX identifier the artwork travels under. */
  spdx: string;
  /**
   * Plain statement of where the art came from — and, for original work, that
   * it WAS original. Never a paraphrase of the licence itself.
   */
  origin: string;
  /** Where the verbatim licence text lives, when one is vendored. */
  licenseFile?: string;
  /** Upstream commit, for third-party families fetched from a repository. */
  commit?: string;
  /** Upstream source page, for third-party families. */
  source?: string;
}

/**
 * Original line icons by the TurboSlop project. `spdx: 'MIT'` matches the
 * repository licence; `origin` states plainly that these were drawn here.
 */
export const ICON_LICENSE: IconLicense = {
  name: 'TurboSlop icon set',
  spdx: 'MIT',
  origin: 'Original geometric line icons drawn for the TurboSlop project; not derived from any third-party icon library.',
  licenseFile: 'LICENSE',
};

/**
 * The vendored third-party family. Lucide's outlined icons sit closest to the
 * house voice; the geometry below was normalised, never redrawn, and the ISC
 * notice (plus the MIT notice for Feather-derived glyphs) is reproduced
 * verbatim in the licence document.
 */
export const LUCIDE_LICENSE: IconLicense = {
  name: 'Lucide',
  spdx: 'ISC',
  origin:
    'Outline glyphs vendored verbatim in shape from Lucide; presentation was stripped and every glyph re-emitted through the house wrapper.',
  licenseFile: 'public/icons/LICENSES.md',
  commit: LUCIDE_COMMIT,
  source: LUCIDE_SOURCE,
};

/** Every family's licence record, keyed by family. */
export const ICON_LICENSES: Record<IconFamily, IconLicense> = {
  turboslop: ICON_LICENSE,
  lucide: LUCIDE_LICENSE,
};

/**
 * The drawing profile of a family. Both families currently share the same
 * numbers — that is the point of the wrapper — but the profile is data so a
 * future family cannot silently change stroke, grid or cap style.
 */
export interface IconFamilyProfile {
  /** The square viewBox grid. */
  grid: number;
  /** The one stroke width in the family. */
  stroke: number;
  linecap: 'round';
  linejoin: 'round';
  fill: 'none';
  color: 'currentColor';
  license: IconLicense;
}

export const ICON_PROFILES: Record<IconFamily, IconFamilyProfile> = {
  turboslop: {
    grid: ICON_GRID,
    stroke: ICON_STROKE,
    linecap: 'round',
    linejoin: 'round',
    fill: 'none',
    color: 'currentColor',
    license: ICON_LICENSE,
  },
  lucide: {
    grid: ICON_GRID,
    stroke: ICON_STROKE,
    linecap: 'round',
    linejoin: 'round',
    fill: 'none',
    color: 'currentColor',
    license: LUCIDE_LICENSE,
  },
};

/**
 * Inner geometry only. The wrapper (viewBox, stroke family, a11y) is applied by
 * `renderIcon`, so no glyph carries its own presentation.
 */
const ICONS: Record<IconName, string> = {
  'arrow-right': '<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/>',
  'arrow-up-right': '<path d="M6 18 18 6"/><path d="M9 6h9v9"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.8 4.8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4.5 7.5 12 13l7.5-5.5"/>',
  phone:
    '<path d="M5 4h4l2 5-2.4 1.6a11.5 11.5 0 0 0 4.8 4.8L15 13l5 2v4a1 1 0 0 1-1 1C10.5 20 4 13.5 4 5a1 1 0 0 1 1-1Z"/>',
  'map-pin':
    '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.6 2.1"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 19h14"/>',
  external: '<path d="M14 4h6v6M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  quote:
    '<path d="M9.5 7.5C6.7 9 5 11.4 5 14.2 5 16 6 17 7.4 17c1.2 0 2.1-.9 2.1-2.1 0-1.1-.8-1.9-1.9-1.9h-.5c.4-1.5 1.5-2.6 3-3.4Z"/><path d="M18.5 7.5C15.7 9 14 11.4 14 14.2c0 1.8 1 2.8 2.4 2.8 1.2 0 2.1-.9 2.1-2.1 0-1.1-.8-1.9-1.9-1.9h-.5c.4-1.5 1.5-2.6 3-3.4Z"/>',
  star: '<path d="M12 3.5l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9Z"/>',
  cart: '<path d="M3 4h2.3l2.3 10.6a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17.5" cy="19.5" r="1.4"/>',
  play: '<path d="M8 5.2v13.6l11-6.8Z"/>',
  'chevron-down': '<path d="M6 9.5 12 15.5 18 9.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="0.8"/>',
  shield: '<path d="M12 3.5 19 6.4v5c0 4.4-2.9 7.5-7 9-4.1-1.5-7-4.6-7-9v-5Z"/>',
};

export function hasIcon(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** The names a family can draw, in declaration order. */
export function iconNamesFor(family: IconFamily): readonly string[] {
  return family === 'turboslop' ? ICON_NAMES : LUCIDE_ICON_NAMES;
}

/** True when `name` resolves in `family`. The selection layer relies on this. */
export function hasIconIn(family: IconFamily, name: string): boolean {
  return family === 'turboslop'
    ? hasIcon(name)
    : Object.prototype.hasOwnProperty.call(LUCIDE_GLYPHS, name);
}

/** Inner geometry for one glyph, or `undefined` when it is not in the family. */
function glyphBody(family: IconFamily, name: string): string | undefined {
  if (family === 'turboslop') return hasIcon(name) ? ICONS[name] : undefined;
  if (!Object.prototype.hasOwnProperty.call(LUCIDE_GLYPHS, name)) return undefined;
  return LUCIDE_GLYPHS[name as LucideIconName].body;
}

/* ------------------------------------------------------------------ *
 * Roles — what an icon MEANS where it is drawn
 *
 * A block asks for a role ("the email route", "the price is included"), never
 * for a specific glyph: that is what lets a page choose its own vocabulary
 * without any block knowing which family is on the page. The candidates are
 * curated 2-3 per role, and the visual blueprint picks exactly one per seed.
 * ------------------------------------------------------------------ */
export const ICON_ROLES = [
  'contact-email',
  'contact-phone',
  'contact-address',
  'schedule-date',
  'schedule-time',
  'pricing-included',
  'faq-answer',
  'gallery-link',
  'nav-cta',
] as const;
export type IconRole = (typeof ICON_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ICON_ROLES);

function isIconRole(value: string): value is IconRole {
  return ROLE_SET.has(value);
}

/** Original family: the role IS the glyph name. */
const TURBOSLOP_ROLE_GLYPHS: Record<IconRole, readonly string[]> = {
  'contact-email': ['mail'],
  'contact-phone': ['phone'],
  'contact-address': ['map-pin'],
  'schedule-date': ['calendar'],
  'schedule-time': ['clock'],
  'pricing-included': ['check'],
  'faq-answer': ['info'],
  'gallery-link': ['arrow-up-right'],
  'nav-cta': ['arrow-right'],
};

/** Lucide: derived from the generated allowlist, so the fetch script stays the
 *  single source of truth for which glyph can carry which meaning. */
const roleGlyphs: Record<IconRole, string[]> = {
  'contact-email': [],
  'contact-phone': [],
  'contact-address': [],
  'schedule-date': [],
  'schedule-time': [],
  'pricing-included': [],
  'faq-answer': [],
  'gallery-link': [],
  'nav-cta': [],
};
for (const name of LUCIDE_ICON_NAMES) {
  for (const role of LUCIDE_GLYPHS[name].roles) {
    if (isIconRole(role)) roleGlyphs[role].push(name);
  }
}
const LUCIDE_ROLE_GLYPHS: Record<IconRole, readonly string[]> = roleGlyphs;

/** Candidate glyphs per family and role. */
export const ICON_ROLE_GLYPHS: Record<IconFamily, Record<IconRole, readonly string[]>> = {
  turboslop: TURBOSLOP_ROLE_GLYPHS,
  lucide: LUCIDE_ROLE_GLYPHS,
};

/**
 * The chosen glyph for one role, or null when the page's allowlist dropped it.
 * Resolution is by the role's own candidate order, which is why the selection
 * layer can store nothing but the plain name list on the blueprint.
 */
export function resolveIconRole(
  family: IconFamily,
  role: IconRole,
  allowed: readonly string[],
): string | null {
  for (const candidate of ICON_ROLE_GLYPHS[family][role]) {
    if (allowed.includes(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export interface IconRenderOptions {
  size?: number;
  title?: string;
  className?: string;
}

/**
 * Render one standalone `<svg>`. Without a `title` the icon is decorative and
 * hidden from assistive tech; with one it becomes a labelled `role="img"`.
 *
 * Call as `renderIcon(name)` / `renderIcon(name, { size })` for the original
 * family, or `renderIcon(name, family, { size })` when the visual blueprint
 * chose a family. Both spellings emit the SAME wrapper: a page's icons must be
 * indistinguishable in stroke, caps, grid and colour whatever the vocabulary.
 */
export function renderIcon(name: string, family?: IconFamily, opts?: IconRenderOptions): string;
export function renderIcon(name: string, opts?: IconRenderOptions): string;
export function renderIcon(
  name: string,
  familyOrOpts?: IconFamily | IconRenderOptions,
  maybeOpts: IconRenderOptions = {},
): string {
  const family: IconFamily = typeof familyOrOpts === 'string' ? familyOrOpts : 'turboslop';
  const opts = typeof familyOrOpts === 'string' ? maybeOpts : (familyOrOpts ?? {});
  const profile = ICON_PROFILES[family];
  if (!profile) {
    throw new Error(`Unknown icon family: ${String(family)}. Expected one of ${ICON_FAMILIES.join(', ')}.`);
  }

  const body = glyphBody(family, name);
  if (typeof body !== 'string') {
    throw new Error(
      `Unknown icon: ${String(name)} in family ${family}. Expected one of ${iconNamesFor(family).join(', ')}.`,
    );
  }

  const size = opts.size;
  const dims =
    typeof size === 'number' && Number.isFinite(size) && size > 0
      ? ` width="${Math.round(size)}" height="${Math.round(size)}"`
      : '';

  const title = typeof opts.title === 'string' && opts.title.length > 0 ? opts.title : undefined;
  const a11y = title
    ? ` role="img"><title>${esc(title)}</title>`
    : ' aria-hidden="true">';

  /* A class is emitted by default so the host stylesheet can size and align the
     icon without the caller having to wrap it. `className: ''` opts out. */
  const cls = opts.className === undefined ? 'icon' : opts.className;
  const classAttr = cls ? ` class="${esc(cls)}"` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${profile.grid} ${profile.grid}"${classAttr}${dims}` +
    ` fill="${profile.fill}" stroke="${profile.color}" stroke-width="${profile.stroke}" stroke-linecap="${profile.linecap}"` +
    ` stroke-linejoin="${profile.linejoin}" focusable="false"${a11y}${body}</svg>`
  );
}
