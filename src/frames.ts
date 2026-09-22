/**
 * TurboSlop — presentation frames.
 *
 * A generated page should show the product in context, not float its artwork in
 * a void. This module draws that context in code: a browser window for software,
 * a handset for an app, packaging for a shop, a ticket stub for an event, a
 * cover for a publication, an editorial plate for a figure. A frame is
 * structural — it decides how much of a slot the image may occupy and how the
 * block around it reads — so it is not decoration.
 *
 * Each `renderFrame` call returns one self-contained, escaped HTML fragment.
 * Colour is read from the page's own custom properties (`--fg`, `--accent`,
 * `--hair`, `--bg-raised`), each with a fallback, so frames inherit whatever
 * palette the blueprint selected. The modules are pure: no DOM, no network, no
 * filesystem. Output is deterministic given `seed`.
 */

export const FRAME_KINDS = [
  'browser',
  'device',
  'packaging',
  'ticket',
  'cover',
  'figure',
  'plain',
] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

export interface FrameSpec {
  kind: FrameKind;
  /** The HTML for the thing inside the frame (usually a plate/img). */
  inner: string;
  /** Short label rendered in the frame chrome, e.g. a URL or product name. */
  label?: string;
  /** Decorative detail, seeded: window dots, stamp serial, ticket number. */
  seed?: number;
  /** Aspect ratio hint, e.g. '16 / 9'. */
  ratio?: string;
}

export interface Frame {
  kind: FrameKind;
  /** Complete HTML for the framed block. */
  html: string;
  /** What the frame is for, for the blueprint/asset layer. */
  role: string;
  /** Suggested slot aspect ratio. */
  ratio: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/* ------------------------------------------------------------------ *
 * Palette tokens — every colour the frames use is a custom property with
 * a fallback, so a frame belongs to whichever palette is on the page.
 * ------------------------------------------------------------------ */
const FG = 'var(--fg, #1b1b1f)';
const ACCENT = 'var(--accent, #7c5cff)';
const HAIR = 'var(--hair, rgba(20, 20, 30, .18))';
const RAISED = 'var(--bg-raised, #ffffff)';

const DEFAULT_RATIO: Record<FrameKind, string> = {
  browser: '16 / 9',
  device: '9 / 19.5',
  packaging: '4 / 5',
  ticket: '2 / 1',
  cover: '3 / 4',
  figure: '4 / 3',
  plain: '16 / 9',
};

const ROLE: Record<FrameKind, string> = {
  browser: 'software or web product shown running in a browser viewport',
  device: 'mobile app or product shown on a handset screen',
  packaging: 'physical product, box or goods for a shop',
  ticket: 'event admission stub or dated programme pass',
  cover: 'publication cover, report or issue artwork',
  figure: 'editorial figure or printed plate with a caption',
  plain: 'unframed image slot; the honest fallback when no device is implied',
};

/** How much of the frame's area is available to the inner content. */
const INSET: Record<FrameKind, number> = {
  browser: 0.86,
  device: 0.74,
  packaging: 0.66,
  ticket: 0.7,
  cover: 0.82,
  figure: 0.8,
  plain: 1,
};

/** A finite, non-negative integer — never NaN, never undefined. */
function normSeed(seed?: number): number {
  return typeof seed === 'number' && Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
}

/** BEM class helper: every internal class carries both its name and its kind. */
const cx = (name: string, kind: FrameKind) => `frame__${name} frame__${name}--${kind}`;

/** One traffic-light dot for the browser chrome. */
const dot = (kind: FrameKind) =>
  `<i class="${cx('dot', kind)}" style="inline-size:.55rem;block-size:.55rem;border-radius:50%;background:${HAIR};display:inline-block"></i>`;

function browserFrame(inner: string, label: string, seed: number, ratio: string): string {
  const tabs = (seed % 3) + 1;
  const tab =
    `<span class="${cx('tab', 'browser')}" style="inline-size:1.5rem;block-size:.45rem;border-radius:3px;` +
    `background:${HAIR};opacity:.7;display:inline-block"></span>`;
  return `<figure class="frame frame--browser" data-frame="browser" style="--ratio:${esc(ratio)}">
  <div class="${cx('chrome', 'browser')}" style="display:flex;align-items:center;gap:.5rem;padding:.5rem .65rem;background:${RAISED};border:1px solid ${HAIR};border-block-end:0;border-radius:10px 10px 0 0">
    <span class="${cx('dots', 'browser')}" aria-hidden="true" style="display:inline-flex;gap:.3rem">${dot('browser').repeat(3)}</span>
    <span class="${cx('tabs', 'browser')}" aria-hidden="true" style="display:inline-flex;gap:.25rem">${tab.repeat(tabs)}</span>
    <span class="${cx('addr', 'browser')}" style="flex:1;text-align:center;font:500 .72rem/1.4 ui-monospace,monospace;color:${FG};border:1px solid ${HAIR};border-radius:999px;padding:.2rem .6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label || 'example.com')}</span>
  </div>
  <div class="${cx('viewport', 'browser')}" style="aspect-ratio:var(--ratio);background:${RAISED};border:1px solid ${HAIR};border-radius:0 0 10px 10px;overflow:hidden;display:grid">${inner}</div>
</figure>`;
}

function deviceFrame(inner: string, label: string, seed: number, ratio: string): string {
  const battery = (seed % 96) + 4;
  const carrier = label
    ? `<span class="${cx('carrier', 'device')}" style="color:${FG}">${esc(label)}</span>`
    : '';
  return `<figure class="frame frame--device" data-frame="device" style="--ratio:${esc(ratio)}">
  <div class="${cx('body', 'device')}" style="position:relative;aspect-ratio:var(--ratio);background:${RAISED};border:1px solid ${HAIR};border-radius:2.2rem;padding:.55rem;box-sizing:border-box">
    <span class="${cx('island', 'device')}" aria-hidden="true" style="position:absolute;inset-block-start:.75rem;inset-inline-start:50%;transform:translateX(-50%);inline-size:28%;block-size:.5rem;border-radius:999px;background:${HAIR}"></span>
    <span class="${cx('button', 'device')}" aria-hidden="true" style="position:absolute;inset-inline-end:-3px;inset-block-start:24%;inline-size:3px;block-size:13%;border-radius:999px;background:${HAIR}"></span>
    <div class="${cx('screen', 'device')}" style="position:relative;block-size:100%;border-radius:1.75rem;overflow:hidden;background:${RAISED};display:grid">
      <span class="${cx('status', 'device')}" style="position:absolute;inset-block-start:0;inset-inline:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.7rem .85rem;font:500 .6rem/1 ui-monospace,monospace;color:${FG};pointer-events:none">${carrier}<span class="${cx('battery', 'device')}">${battery}%</span></span>
      ${inner}
    </div>
  </div>
</figure>`;
}

function packagingFrame(inner: string, label: string, _seed: number, ratio: string): string {
  return `<figure class="frame frame--packaging" data-frame="packaging" style="--ratio:${esc(ratio)}">
  <div class="${cx('box', 'packaging')}" style="position:relative;display:grid;grid-template-columns:1fr 15%;grid-template-rows:12% 1fr;aspect-ratio:var(--ratio);background:${RAISED};border:1px solid ${HAIR};border-radius:4px;overflow:hidden;box-sizing:border-box">
    <div class="${cx('flap', 'packaging')}" style="grid-column:1/-1;grid-row:1;display:flex;align-items:center;padding-inline:.5rem;background:linear-gradient(${HAIR},transparent);border-block-end:1px dashed ${HAIR};font:500 .62rem/1.2 ui-monospace,monospace;color:${FG};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(label || 'PRODUCT')}</div>
    <div class="${cx('face', 'packaging')}" style="grid-column:1;grid-row:2;position:relative;display:grid;overflow:hidden">${inner}</div>
    <div class="${cx('side', 'packaging')}" style="grid-column:2;grid-row:2;background:linear-gradient(90deg,color-mix(in oklab, ${FG} 6%, transparent),color-mix(in oklab, ${FG} 22%, transparent));border-inline-start:1px solid ${HAIR}"></div>
  </div>
</figure>`;
}

function ticketFrame(inner: string, label: string, seed: number, ratio: string): string {
  const serial = `NO ${String(seed).padStart(6, '0')}`;
  const title = label
    ? `<span class="${cx('title', 'ticket')}" style="position:absolute;inset-block-start:.6rem;inset-inline-start:.7rem;z-index:1;font:700 .78rem/1.2 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:${FG}">${esc(label)}</span>`
    : '';
  return `<figure class="frame frame--ticket" data-frame="ticket" style="--ratio:${esc(ratio)}">
  <div class="${cx('wrap', 'ticket')}" style="position:relative;display:grid;grid-template-columns:1fr 26%;aspect-ratio:var(--ratio);background:${RAISED};border:1px solid ${HAIR};border-radius:8px;overflow:hidden;box-sizing:border-box">
    <div class="${cx('main', 'ticket')}" style="grid-column:1;position:relative;display:grid;overflow:hidden">${title}${inner}</div>
    <span class="${cx('perf', 'ticket')}" aria-hidden="true" style="position:absolute;inset-block:0;inset-inline-start:74%;border-inline-start:2px dashed ${HAIR};inline-size:0;z-index:2"></span>
    <div class="${cx('stub', 'ticket')}" style="grid-column:2;display:flex;flex-direction:column;justify-content:center;gap:.35rem;padding:.5rem;background:color-mix(in oklab, ${ACCENT} 9%, transparent);font:500 .58rem/1.3 ui-monospace,monospace;color:${FG};overflow:hidden">
      <span class="${cx('serial', 'ticket')}">${serial}</span>
      <span class="${cx('admit', 'ticket')}" style="letter-spacing:.1em">ADMIT ONE</span>
    </div>
  </div>
</figure>`;
}

function coverFrame(inner: string, label: string, seed: number, ratio: string): string {
  const issue = `No. ${String((seed % 90) + 10)}`;
  return `<figure class="frame frame--cover" data-frame="cover" style="--ratio:${esc(ratio)}">
  <div class="${cx('sheet', 'cover')}" style="display:flex;flex-direction:column;aspect-ratio:var(--ratio);background:${RAISED};border:1px solid ${HAIR};overflow:hidden;box-sizing:border-box">
    <div class="${cx('masthead', 'cover')}" style="padding:.55rem .7rem;border-block-end:2px solid ${ACCENT};font:700 .72rem/1.2 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:${FG};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label || 'ISSUE')}</div>
    <div class="${cx('art', 'cover')}" style="flex:1;display:grid;overflow:hidden">${inner}</div>
    <div class="${cx('issue', 'cover')}" style="padding:.45rem .7rem;border-block-start:1px solid ${HAIR};font:500 .58rem/1.2 ui-monospace,monospace;color:${FG};letter-spacing:.08em">${issue}</div>
  </div>
</figure>`;
}

function figureFrame(inner: string, label: string, _seed: number, ratio: string): string {
  return `<figure class="frame frame--figure" data-frame="figure" style="--ratio:${esc(ratio)}">
  <span class="${cx('rule', 'figure')}" aria-hidden="true" style="display:block;border-block-start:1px solid ${HAIR}"></span>
  <div class="${cx('art', 'figure')}" style="aspect-ratio:var(--ratio);display:grid;overflow:hidden">${inner}</div>
  <figcaption class="${cx('caption', 'figure')}" style="padding-block-start:.45rem;font:400 .64rem/1.4 ui-monospace,monospace;color:${FG};opacity:.8">${esc(label || 'Plate')}</figcaption>
</figure>`;
}

function plainFrame(inner: string, _label: string, _seed: number, ratio: string): string {
  return `<figure class="frame frame--plain" data-frame="plain" style="--ratio:${esc(ratio)}">
  <div class="${cx('bare', 'plain')}" style="aspect-ratio:var(--ratio);display:grid;overflow:hidden">${inner}</div>
</figure>`;
}

const BUILDERS: Record<
  FrameKind,
  (inner: string, label: string, seed: number, ratio: string) => string
> = {
  browser: browserFrame,
  device: deviceFrame,
  packaging: packagingFrame,
  ticket: ticketFrame,
  cover: coverFrame,
  figure: figureFrame,
  plain: plainFrame,
};

export function renderFrame(spec: FrameSpec): Frame {
  const kind = spec.kind;
  if (!(FRAME_KINDS as readonly string[]).includes(kind as string)) {
    throw new Error(
      `Unknown frame kind: ${String(kind)}. Expected one of ${FRAME_KINDS.join(', ')}.`,
    );
  }
  if (typeof spec.inner !== 'string') {
    throw new Error('renderFrame: `inner` must be an HTML string');
  }
  const ratio =
    typeof spec.ratio === 'string' && spec.ratio.trim() ? spec.ratio.trim() : DEFAULT_RATIO[kind];
  const label = typeof spec.label === 'string' ? spec.label : '';
  const seed = normSeed(spec.seed);
  const html = BUILDERS[kind](spec.inner, label, seed, ratio);
  return { kind, html, role: ROLE[kind], ratio };
}

/* ------------------------------------------------------------------ *
 * Choosing a frame from the brief's lead + emotion.
 *
 * The lead says what the first screen is FOR and therefore what object the
 * page is really about; the emotion can then re-frame a page that has no
 * strong object (a statement or a story) with its own register. The function
 * is total: an unknown lead or emotion still returns a valid kind.
 * ------------------------------------------------------------------ */
const LEAD_FRAME: Record<string, FrameKind> = {
  statement: 'plain',
  product: 'browser',
  catalogue: 'packaging',
  story: 'figure',
  date: 'ticket',
  data: 'browser',
  image: 'cover',
  offer: 'packaging',
};

const EMOTION_FRAME: Record<string, FrameKind> = {
  awe: 'cover',
  serenity: 'figure',
  delight: 'device',
  tension: 'browser',
  nostalgia: 'cover',
  mystery: 'cover',
  trust: 'browser',
  energy: 'ticket',
  intimacy: 'figure',
  optimism: 'device',
  other: 'plain',
};

export function frameForLead(lead: string, emotion: string): FrameKind {
  const base = LEAD_FRAME[lead] ?? 'plain';
  const registered = EMOTION_FRAME[emotion] ?? 'plain';
  // A concrete object lead wins. A statement/story/unknown lead is only a
  // wrapper for tone, so let the emotion pick a more specific frame.
  if (base === 'plain' || base === 'figure') {
    return registered !== 'plain' ? registered : base;
  }
  return base;
}

export function frameInset(kind: FrameKind): number {
  const inset = INSET[kind];
  if (typeof inset !== 'number') {
    throw new Error(
      `Unknown frame kind: ${String(kind)}. Expected one of ${FRAME_KINDS.join(', ')}.`,
    );
  }
  return inset;
}
