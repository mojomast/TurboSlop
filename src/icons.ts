/**
 * TurboSlop — icon set.
 *
 * ORIGINAL WORK. Every glyph below is a simple geometric line drawing made by
 * this project, specifically for TurboSlop. None of it is copied, traced or
 * derived from a known icon library. Released under the repository's MIT
 * licence (see LICENSE); `ICON_LICENSE` records the attribution so the repo can
 * never ship unattributed third-party art.
 *
 * FAMILY RULE — one consistent stroke family:
 *   - 24 x 24 viewBox, drawn on a 1 unit grid with a comfortable inner margin
 *   - a single stroke width of 1.6 for every icon (no weight variation)
 *   - `stroke-linecap="round"` and `stroke-linejoin="round"` everywhere
 *   - outlines only: `fill="none"` on the root, no filled shapes mixed in
 *   - colour is always `stroke="currentColor"`, so an icon inherits its context
 * The consistency test in test/assets.test.ts asserts the shared stroke width,
 * caps/joins and viewBox so a future edit cannot quietly break the family.
 */

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

/** The one stroke width shared by every icon in the family. */
const ICON_STROKE = 1.6;
/** The grid every icon is drawn on. */
const ICON_GRID = 24;

/**
 * Original line icons by the TurboSlop project. `spdx: 'MIT'` matches the
 * repository licence; `origin` states plainly that these were drawn here.
 */
export const ICON_LICENSE = {
  name: 'TurboSlop icon set',
  spdx: 'MIT',
  origin: 'Original geometric line icons drawn for the TurboSlop project; not derived from any third-party icon library.',
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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Render one standalone `<svg>`. Without a `title` the icon is decorative and
 * hidden from assistive tech; with one it becomes a labelled `role="img"`.
 */
export function renderIcon(name: IconName, opts: { size?: number; title?: string } = {}): string {
  const body = ICONS[name];
  if (typeof body !== 'string') {
    throw new Error(`Unknown icon: ${String(name)}. Expected one of ${ICON_NAMES.join(', ')}.`);
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

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}"${dims}` +
    ` fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round"` +
    ` stroke-linejoin="round" focusable="false"${a11y}${body}</svg>`
  );
}
