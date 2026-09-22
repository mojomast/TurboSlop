/**
 * TurboSlop — the layout engine.
 *
 * Emits the stylesheet for a composed design direction.
 *
 * The engine targets the Interop 2026 feature set (see docs/INTEROP-2026.md),
 * because those are the features all three engines have committed to shipping
 * consistently. Nothing here is used as a novelty: every modern feature is doing
 * a job that previously required JavaScript or a fragile hack, and every one is
 * either safely ignorable or explicitly gated behind `@supports` so the page
 * degrades to something correct rather than something broken.
 *
 * Modern features actually load-bearing here:
 *   @layer              cascade layers — predictable specificity, no !important
 *   oklch() + relative  perceptually even palettes derived from one accent
 *   light-dark()        theme switching with zero duplicated declarations
 *   @container          components respond to their own width, not the viewport
 *   @container style()  components respond to the design system's own custom props
 *   animation-timeline  scroll-driven reveals with NO JavaScript at all
 *   @starting-style     entry animations for popovers/dialogs
 *   allow-discrete      animating display/overlay between states
 *   anchor positioning  captions/tooltips attached declaratively, no JS measurement
 *   position-try        automatic overflow fallback for anchored elements
 *   contrast-color()    derives readable ink on any accent, per palette
 *   shape()             organic clip paths in CSS units, not SVG path data
 *   subgrid             card internals align to the page grid
 *   :has()              layout that responds to descendant state
 *   text-box-trim       optical alignment of display type
 *   field-sizing        form controls that size to their content
 *   interpolate-size    animating to auto height without magic numbers
 *   popover + command   declarative top layer, no JS menu code
 *   scroll-snap         standardised snapping
 *   ::target-text       styled text-fragment highlights
 */
import { atmosphereFor } from './catalog.js';
import type { LayoutCandidate, MotionCandidate, PaletteCandidate, TypeCandidate } from './catalog.js';
import type { DensityId } from './catalog.js';
import { bundledStackFor, fontDirectionFor, fontFaceCssFor } from './fonts.js';
import { effectKitCss, elementCss } from './styles.js';

export interface LayoutInput {
  emotion: string;
  palette: PaletteCandidate;
  type: TypeCandidate;
  layout: LayoutCandidate;
  motion: MotionCandidate;
  density: DensityId;
  /** The chosen CSS effect kit id. */
  effects: string;
  /**
   * Where the bundled woff2 files sit relative to the page. Defaults to
   * `fonts/`, which is where the pipeline copies them, so a page on disk, a
   * preview served by the control surface and a ZIP export all resolve the same
   * way — with no remote font request.
   */
  fontBasePath?: string;
}

/** Spacing multiplier + reading measure per density decision. Higher = roomier. */
const DENSITY = {
  quiet: { scale: 1.5, measure: '58ch', leading: 1.8 },
  balanced: { scale: 1, measure: '68ch', leading: 1.6 },
  dense: { scale: 0.72, measure: '78ch', leading: 1.42 },
} as const;

function hexToOklch(hex: string): string {
  // Palette entries are authored in OKLCH where possible; hex falls back to
  // relative-color syntax so the engine never has to convert in JS.
  return `oklch(from ${hex} l c h)`;
}

export function buildStylesheet(input: LayoutInput): string {
  const { palette, type, layout, motion, density, emotion } = input;
  const d = DENSITY[density];
  const atm = atmosphereFor(emotion);

  /* Bundled type: the face is declared here and the stacks below put it first,
     so the page never depends on a remote font request to look right. */
  const fontCss = fontFaceCssFor([fontDirectionFor(type.id)], input.fontBasePath ?? 'fonts/');
  const displayStack = bundledStackFor(type.id, type.display);
  const bodyStack = bundledStackFor(type.id, type.body);
  const monoStack = bundledStackFor('mono-technical', type.mono);

  return `${fontCss}

/* ============================================================
   TurboSlop — generated stylesheet
   emotion: ${emotion} · palette: ${palette.id} · type: ${type.id}
   layout: ${layout.id} · motion: ${motion.id} · density: ${density}
   ============================================================ */

@layer reset, tokens, layout, components, elements, kits, motion, overrides;

/* ---------------------------------------------------------- *
 * CASCADE LAYERS
 * Declared up front so layer order is fixed irrespective of source
 * order. This is why this stylesheet contains no !important and no
 * specificity escalation: conflict resolution is structural.
 * ---------------------------------------------------------- */
@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; }
  html { -webkit-text-size-adjust: 100%; }
  img, svg, video { display: block; max-inline-size: 100%; }
  button, input, select, textarea { font: inherit; color: inherit; background: none; border: none; }
  button { cursor: pointer; }
  a { color: inherit; text-decoration: none; }
  ul, ol { list-style: none; padding: 0; }
}

/* ---------------------------------------------------------- *
 * TOKENS
 * One accent drives the whole palette via OKLCH relative color
 * syntax — perceptually even steps instead of hand-mixed greys.
 * ---------------------------------------------------------- */
@layer tokens {
  :root {
    color-scheme: light dark;

    /* Bases come straight from the chosen palette. */
    --bg: ${palette.bg};
    --bg-raised: ${palette.bgRaised};
    --fg: ${palette.fg};
    --muted: ${palette.muted};
    --accent: ${palette.accent};
    --accent-ink: ${palette.accentInk};
    --secondary: ${palette.secondary};

    /* Derived: lighter/darker accent steps, computed by the browser. */
    --accent-soft:  ${hexToOklch(palette.accent)};
    --accent-deep:  oklch(from ${palette.accent} calc(l - 0.12) c h);
    --accent-tint:  oklch(from ${palette.accent} 0.94 calc(c * 0.35) h);
    --accent-wash:  oklch(from ${palette.accent} 0.97 calc(c * 0.2) h);

    /* Near-invisible greys derived from the foreground. */
    --hair:        oklch(from ${palette.fg} l c h / 0.14);
    --hair-strong: oklch(from ${palette.fg} l c h / 0.30);
    --surface:     oklch(from ${palette.bg} calc(l + 0.03) c h);

    /* Type. The bundled family comes first; the catalog stack is the fallback.
       The catalog entry is the RECIPE (weight, tracking, scale); the font file
       is bundled, so the page needs no remote request to look right. */
    --font-display: ${displayStack};
    --font-body: ${bodyStack};
    --font-mono: ${monoStack};
    --display-weight: ${type.displayWeight};
    --track: ${type.tracking};

    /* Fluid scale, tuned by the type voice's own scale factor. */
    --scale: ${type.scale};
    /* The layout scales display type to suit its own measure: a narrow reading
       column must not receive an 11vw headline. */
    --display-factor: ${layout.displayFactor};
    --fs-display: calc(clamp(3rem, 11vw, 8.5rem) * var(--scale) * var(--display-factor));
    --fs-h1:      calc(clamp(2.25rem, 6.5vw, 5rem) * var(--scale));
    --fs-h2:      calc(clamp(1.75rem, 4vw, 3rem) * var(--scale));
    --fs-h3:      calc(clamp(1.25rem, 2.2vw, 1.75rem) * var(--scale));
    --fs-body:    calc(1rem * var(--scale));
    --fs-small:   calc(0.8125rem * var(--scale));
    --fs-label:   calc(0.6875rem * var(--scale));

    /* Density is a real structural decision: it scales the whole spacing
       rhythm. Quiet gets more air, dense gets less — the multiplier is applied
       to a fixed rem base, never inverted. */
    --den: ${d.scale};
    --s-1:  calc(0.25rem * var(--den));
    --s-2:  calc(0.5rem * var(--den));
    --s-3:  calc(0.75rem * var(--den));
    --s-4:  calc(1rem * var(--den));
    --s-6:  calc(1.5rem * var(--den));
    --s-8:  calc(2rem * var(--den));
    --s-12: calc(3rem * var(--den));

    --measure: ${d.measure};
    --leading: ${d.leading};
    --cols: ${layout.columns};
    --maxw: ${layout.maxWidth};
    --gutter: ${layout.gutter};
    --radius: ${layout.radius};
    --rule: ${layout.rules ? 'var(--hair)' : 'transparent'};

    /* Motion language. */
    --dur: ${motion.duration};
    --ease: ${motion.ease};
    --tempo: ${motion.tempo};
  }

  /* light-dark() lets one declaration serve both themes. Palettes that are
     intrinsically dark stay dark; the function is used for surfaces and UI. */
  :root {
    --ui-bg: light-dark(var(--bg), var(--bg));
    --ui-fg: light-dark(var(--fg), var(--fg));
  }

  /* Automatic readable ink on the accent, per the chosen palette. */
  @supports (color: contrast-color(red)) {
    :root { --on-accent: contrast-color(var(--accent)); }
  }
  @supports not (color: contrast-color(red)) {
    :root { --on-accent: var(--accent-ink); }
  }

  /* Expose the design decisions as container style-query targets, so any
     component can adapt to the *design system* rather than to the viewport. */
  :root {
    --mood: ${emotion};
    --density: ${density};
    --motion-tempo: ${motion.tempo > 1 ? 'slow' : motion.tempo < 0.7 ? 'fast' : 'medium'};
  }
}

/* ---------------------------------------------------------- *
 * CUSTOM FUNCTIONS (CSS Functions & Mixins)
 * Reusable value logic that lives in CSS instead of being baked into every
 * declaration by the generator. Always paired with a plain fallback
 * declaration so an engine without @function support still lays out correctly.
 * ---------------------------------------------------------- */
@function --forge-space(--mult) {
  result: calc(var(--s-unit) * var(--mult));
}

@function --forge-ink-on(--color) {
  result: oklch(from var(--color) clamp(0, (0.62 - l) * 100, 1) 0 h);
}

/* ---------------------------------------------------------- *
 * LAYOUT
 * ---------------------------------------------------------- */
@layer layout {
  body {
    min-block-size: 100svh;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: var(--leading);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* ---- atmosphere ---------------------------------------------------
     The texture layer, curated from the variation harvest: radial-gradient
     atmosphere was used by 8/10 variations and the engine emitted none, so
     every generated page was tonally flat. Fixed, inert and decorative — it
     can never intercept a pointer or affect layout.
     Colours come from the PALETTE, not the emotion, because the two are chosen
     independently and a literal emotion-coloured wash would clash. */
  .atmosphere {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: ${atm.layers};
  }
${atm.horizon
      ? `  .atmosphere::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block-start: 58%;
    block-size: 1px;
    background: linear-gradient(90deg, transparent, var(--hair-strong) 18%, var(--hair-strong) 82%, transparent);
  }`
      : ''}
${atm.grain > 0
      ? `  .grain {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: ${atm.grain};
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)'/%3E%3C/svg%3E");
    background-size: 140px 140px;
  }`
      : ''}
  main, footer { position: relative; z-index: 1; }

  /* Generated backdrop, when the image service produced one. Decorative: it is
     behind the content, marked aria-hidden, and skips entirely without art. */
  .hero-art {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: clip;
    opacity: 0.4;
    mask-image: linear-gradient(to bottom, #000 0%, transparent 85%);
  }
  .hero-art img { inline-size: 100%; block-size: 100%; object-fit: cover; }
  .sec > .wrap { position: relative; z-index: 1; }

  @media (prefers-contrast: more), (forced-colors: active) {
    .hero-art { display: none; }
  }
  @media print {
    .hero-art { display: none; }
  }

  .wrap {
    inline-size: 100%;
    max-inline-size: var(--maxw);
    margin-inline: auto;
    padding-inline: var(--gutter);
  }

  /* A 12-col grid whose horizontal min-content is the sum of its gaps.
     Using a fluid gap and minmax(0,1fr) keeps it from ever forcing overflow. */
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: clamp(var(--s-2), 2vw, var(--s-6));
  }

  .sec {
    padding-block: calc(var(--s-12) * 1.2);
    position: relative;
  }
  .sec + .sec { border-block-start: 1px solid var(--rule); }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .eyebrow::before {
    content: "";
    inline-size: 1.5rem;
    block-size: 1px;
    background: var(--accent);
  }

  /* Density as a real structural decision, expressed with a style query:
     the component adapts because the *system* changed, not the viewport. */
  .hgroup { display: grid; gap: var(--s-3); }
  /* text-box-trim + a sub-1 line-height shrinks the heading's box while the
     glyphs still overflow it, so the next block collides with the descenders.
     Reserve explicit space rather than relying on leading that was trimmed. */
  .hgroup > :is(h1, h2) { margin-block-end: var(--s-3); }
  @container style(--density: dense) {
    .hgroup { gap: var(--s-2); }
  }
  @container style(--density: quiet) {
    .hgroup { gap: var(--s-4); }
  }

  h1, h2, h3 {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    letter-spacing: var(--track);
    line-height: 1.05;
    text-wrap: balance;
    /* Display type at 11vw must never be able to blow out the viewport.
       "anywhere" (not "break-word") because only anywhere affects intrinsic
       min-content sizing — a grid column otherwise inherits the longest
       unbreakable word as its floor and the mobile page overflows. */
    overflow-wrap: anywhere;
    /* Optical alignment: trims the half-leading above cap height so display
       type sits flush with its container edge. Purely visual, safe to ignore. */
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
  }

  h1 { font-size: var(--fs-h1); }
  h2 { font-size: var(--fs-h2); }
  h3 { font-size: var(--fs-h3); }

  .display {
    font-size: var(--fs-display);
    /* 0.95 let descenders overflow the line box past the next block. */
    line-height: 1;
    letter-spacing: calc(var(--track) - 0.01em);
    /* A display-size email address is one unbreakable token ~19 characters
       long; without this it is the single most reliable way to blow the
       viewport out horizontally. */
    overflow-wrap: anywhere;
  }

  p { max-inline-size: var(--measure); text-wrap: pretty; overflow-wrap: anywhere; }
  .note {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    color: var(--muted);
    max-inline-size: 56ch;
    margin-block-start: var(--s-4);
  }
  .lede { font-size: calc(var(--fs-body) * 1.15); color: var(--muted); }

  @supports (display: subgrid) {
    /* Card internals share the page grid, so eyebrows/labels across a row
       align on the same baseline regardless of content length. */
    .card { display: grid; grid-row: span 2; grid-template-rows: subgrid; gap: var(--s-2); }
  }

  @supports not (display: subgrid) {
    .card { display: grid; gap: var(--s-2); }
  }

  @supports (clip-path: shape(from 0 0, line to 100% 0)) {
    /* Organic section boundary drawn with CSS units rather than SVG path data. */
    .sec--shaped::after {
      content: "";
      position: absolute;
      inset-inline: 0;
      inset-block-end: -1px;
      block-size: calc(var(--s-6) * 1.5);
      background: var(--bg-raised);
      clip-path: shape(
        from 0 100%,
        line to 0 35%,
        curve to 50% 62% with 22% 8%,
        curve to 100% 30% with 78% 100%,
        line to 100% 100%,
        close
      );
      pointer-events: none;
    }
  }

  /* The gap is fluid: this grid can render 12 tracks inside a 390px phone, and
     a fixed --s-6 (36px under dense density) makes the gutters alone wider
     than the viewport — 11 × 36px = 396px of overflow before any content. */
  .work-grid { display: grid; gap: clamp(var(--s-2), 2vw, var(--s-6)); }
  @container (min-width: 48rem) {
    .work-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container (max-width: 30rem) {
    /* Phones: one column. Two 180px cards side by side is a spreadsheet, not
       a portfolio. */
    .work-grid { grid-template-columns: minmax(0, 1fr); }
    .work-grid .work-card { grid-column: auto; }
  }
  @container (min-width: 72rem) {
    .work-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .work-card--wide { grid-column: span 7; }
    .work-card--narrow { grid-column: span 5; }
  }
  .work-grid { container-type: inline-size; }

  /* :has() — the card reacts to a descendant's state without JS. */
  .work-card { position: relative; border-block-start: 1px solid var(--rule); padding-block-start: var(--s-4); }
  .work-card:has(a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 4px; }

  /* A generated visual plate — the variations proved that a work section needs
     an image-like block (7/10 hand-authored inline SVG artwork, which the engine
     emits none of). aspect-ratio keeps it stable before anything loads, and the
     tint is derived from position so each card differs without per-card markup. */
  .plate {
    aspect-ratio: 4 / 3;
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    overflow: clip;
    background:
      radial-gradient(62% 62% at 28% 24%, color-mix(in oklab, var(--accent) 30%, transparent), transparent 72%),
      radial-gradient(54% 54% at 76% 78%, color-mix(in oklab, var(--secondary) 26%, transparent), transparent 72%),
      var(--bg-raised);
    filter: hue-rotate(calc(var(--plate-turn, 0deg)));
  }
  /* Generated artwork sits inside the plate. object-fit: cover avoids the
     letterboxing a 1:1 source would otherwise produce in a 4:3 frame. */
  .plate-img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    filter: hue-rotate(calc(var(--plate-turn, 0deg) * -1));
  }
  @supports (width: calc(sibling-index() * 1px)) {
    .work-card { --plate-turn: calc((sibling-index() - 1) * 14deg); }
  }

  .stats { display: grid; gap: var(--s-6); }
  @container (min-width: 40rem) { .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .stats { container-type: inline-size; }
  .stat b {
    display: block;
    font-family: var(--font-display);
    font-size: calc(var(--fs-h1) * 0.9);
    font-weight: var(--display-weight);
    letter-spacing: var(--track);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .stat span { font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .stat + .stat { border-inline-start: 1px solid var(--rule); padding-inline-start: var(--s-4); }

  footer .masthead {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    /* Container-relative so the wordmark spans the width at any size
       without ever forcing horizontal overflow. */
    font-size: clamp(2rem, 15cqw, 14rem);
    line-height: 0.85;
    letter-spacing: -0.03em;
    overflow: hidden;
  }
  footer { container-type: inline-size; }

  /* Scroll snapping, now uniformly supported. */
  .snap { scroll-snap-type: y proximity; }
  .snap > * { scroll-snap-align: start; }

  /* ---- scroll-state() container queries ---------------------
     Sticky and snapped states become styleable, so the "style the header once
     it is stuck" behaviour needs no scroll listener and no JS measurement. */
  @supports (container-type: scroll-state) {
    .sec, body { container-type: scroll-state; }

    .site-head { transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
    @container scroll-state(stuck: top) {
      .site-head {
        background: color-mix(in oklab, var(--bg) 88%, transparent);
        backdrop-filter: blur(12px);
        box-shadow: 0 1px 0 0 var(--hair-strong);
      }
    }

    /* A scroll shadow that only exists while there is content above. */
    .scroll-shadow { --shadow: 0; }
    @container scroll-state(scrollable: top) {
      .scroll-shadow { --shadow: 1; }
    }
  }

  /* ---- reading-flow ------------------------------------------
     Visual order can be reordered while DOM/tab order stays logical, so
     accessibility no longer has to be traded for layout. */
  @supports (reading-flow: flex-visual) {
    .work-grid { reading-flow: grid-rows; }
  }

  /* ---- grid-lanes ---------------------------------------------
     Native masonry-style packing for the work grid where supported. */
  @supports (grid-template-rows: masonry) or (display: grid-lanes) {
    .work-grid--lanes {
      display: grid-lanes;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    }
  }

  /* ---- corner-shape -------------------------------------------
     A distinctive corner family per emotion, instead of one radius for all. */
  @supports (corner-shape: squircle) {
    .card, .btn, .field, .pop {
      corner-shape: ${emotion === 'delight' || emotion === 'optimism' ? 'squircle' : emotion === 'tension' ? 'bevel' : 'round'};
    }
  }

  /* ---- rendering performance ----------------------------------
     Off-screen blocks skip layout/paint but keep their size reserved.
     Opt-in only: content-visibility:auto interferes with view() timelines and
     with sticky / anchor positioning, so it must never be applied blanket to
     sections that animate. */
  @supports (content-visibility: auto) {
    .defer-render { content-visibility: auto; contain-intrinsic-size: auto 32rem; }
  }

  /* Horizontal clip MUST live on <html>. On <body> it propagates to the
     viewport and the body's used value reverts to visible, so the document
     still reports an over-wide content box — and reaching for the hidden value
     instead would break position:sticky. scrollbar-gutter reserves the
     scrollbar so content height changes cannot shift the layout. */
  html { overflow-x: clip; scrollbar-gutter: stable; }

  @media (prefers-reduced-transparency: reduce) {
    .site-head { backdrop-filter: none; background: var(--bg); }
  }

  ::selection { background: var(--accent); color: var(--on-accent); }

  /* Interop 2026: text fragments get a styled highlight. */
  ::target-text { background: var(--accent); color: var(--on-accent); }

  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
}

/* ---------------------------------------------------------- *
 * COMPONENTS
 * ---------------------------------------------------------- */
@layer components {
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-6);
    min-block-size: 2.75rem;
    background: var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius);
    font-family: var(--font-display);
    font-size: var(--fs-small);
    transition: transform var(--dur) var(--ease), background-color var(--dur) var(--ease);
  }
  .btn:hover { transform: translateY(-2px); }
  .btn:active { transform: translateY(0) scale(0.985); }
  .btn--ghost { background: transparent; color: var(--fg); box-shadow: inset 0 0 0 1px var(--hair-strong); }

  .tag {
    display: inline-flex;
    align-items: center;
    padding: var(--s-1) var(--s-3);
    border: 1px solid var(--hair-strong);
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .swatch {
    block-size: 4rem;
    border-radius: var(--radius);
    background: var(--c);
    box-shadow: inset 0 0 0 1px var(--hair);
  }

  /* ---- document chrome ---- */
  .site-head {
    position: sticky;
    inset-block-start: 0;
    z-index: 50;
  }
  .site-head nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-4);
    padding-block: var(--s-3);
  }
  /* The header is chrome, not prose: it must not inherit a narrow reading
     measure from the layout, or the nav collapses onto three rows. */
  .site-head .wrap { max-inline-size: min(100%, 80rem); }
  .site-head .btn { min-block-size: 2.25rem; padding: var(--s-1) var(--s-3); font-size: var(--fs-label); }
  .brand {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    letter-spacing: var(--track);
    font-size: var(--fs-h3);
    white-space: nowrap;
    margin-inline-end: auto;
  }
  .nav-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .nav-list a {
    padding-block-end: 2px;
    border-block-end: 1px solid transparent;
    transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .nav-list a:hover { border-block-end-color: var(--accent); color: var(--accent); }

  .cluster { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }

  /* ---- specimen sheet ---- */
  .sw-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: var(--s-3);
  }
  .sw { display: grid; gap: var(--s-2); }
  .sw figcaption {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .sw code { color: var(--fg); }

  .spec {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--s-2) var(--s-4);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    margin-block-start: var(--s-3);
  }
  .spec dt { color: var(--muted); text-transform: uppercase; }
  .spec dd { margin: 0; }

  main { display: block; }

  @media (max-width: 48rem) {
    .site-head nav { flex-wrap: wrap; }
    .nav-list { gap: var(--s-3); }
  }

  /* Form controls that size to their content. */
  @supports (field-sizing: content) {
    textarea.field, input.field { field-sizing: content; min-block-size: 3rem; }
  }
  .field {
    inline-size: 100%;
    padding: var(--s-3) var(--s-4);
    background: var(--bg-raised);
    border: 1px solid var(--hair-strong);
    border-radius: var(--radius);
  }

  /* Declarative top layer — a popover with no JavaScript. */
  .pop {
    padding: var(--s-4);
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--hair-strong);
    border-radius: var(--radius);
    max-inline-size: 26rem;
    /* Entry animation without JS. */
    transition: opacity var(--dur) var(--ease), translate var(--dur) var(--ease),
                display var(--dur) allow-discrete, overlay var(--dur) allow-discrete;
    opacity: 1;
    translate: 0 0;
  }
  @starting-style {
    .pop:popover-open { opacity: 0; translate: 0 -0.5rem; }
  }
  .pop:not(:popover-open) { opacity: 0; translate: 0 -0.5rem; }

  /* ---- native carousel ----------------------------------------
     Zero-JS scroll controls. The buttons and markers are generated by the
     engine, positioned in the tab order, and natively accessible. */
  .rail {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(min(100%, 20rem), 1fr);
    gap: var(--s-4);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    scroll-marker-group: after;
  }
  .rail > * { scroll-snap-align: start; }

  @supports selector(::scroll-button(right)) {
    .rail::scroll-button(*) {
      inline-size: 2.75rem;
      block-size: 2.75rem;
      border-radius: 999px;
      background: var(--bg-raised);
      color: var(--fg);
      border: 1px solid var(--hair-strong);
      font-family: var(--font-mono);
      cursor: pointer;
      transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
    }
    .rail::scroll-button(*):hover { background: var(--accent); color: var(--on-accent); }
    .rail::scroll-button(*):disabled { opacity: 0.35; cursor: default; }

    .rail::scroll-marker {
      content: "";
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--hair-strong);
      background: transparent;
    }
    .rail::scroll-marker:target-current { background: var(--accent); border-color: var(--accent); }
    .rail::scroll-marker-group { display: flex; justify-content: center; gap: var(--s-2); padding-block-start: var(--s-4); }
  }

  /* ---- customizable select ------------------------------------
     A fully styleable select without rebuilding it in JS. */
  @supports (appearance: base-select) {
    select.field {
      appearance: base-select;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
    }
    select.field::picker-icon { transition: rotate var(--dur) var(--ease); }
    select.field:open::picker-icon { rotate: 180deg; }
    select.field::picker(select) {
      appearance: base-select;
      background: var(--bg-raised);
      color: var(--fg);
      border: 1px solid var(--hair-strong);
      border-radius: var(--radius);
      padding: var(--s-2);
    }
    select.field option { padding: var(--s-2) var(--s-3); border-radius: calc(var(--radius) * 0.5); }
    select.field option:checked { background: var(--accent); color: var(--on-accent); }
    select.field option::checkmark { color: var(--accent); }
  }

  /* ---- sibling-index() / sibling-count() ----------------------
     Positional styling without hand-authored per-child rules. For a generator
     this is significant: the engine no longer has to know how many children
     there are in order to stagger them. */
  @supports (width: calc(sibling-index() * 1px)) {
    /* Entrance stagger without the generator computing a per-child delay. */
    .stagger > * {
      animation-delay: calc((sibling-index() - 1) * 70ms * var(--tempo));
    }

    /* Automatic "01 / 06" numbering derived purely from position. */
    .numbered { counter-reset: idx 0 total sibling-count(); }
    .numbered > * { counter-increment: idx; }
    .numbered > *::before {
      content: counter(idx, decimal-leading-zero) " / " counter(total, decimal-leading-zero);
    }

    /* Alternating rhythm for the work GRID only — never the horizontal rail,
       where an explicit column span fights grid-auto-flow. */
    @supports (width: calc(mod(sibling-index(), 2) * 1px)) {
      .work-grid .work-card { grid-column: span calc(5 + mod(sibling-index(), 3)); }
    }
  }
}

/* ---------------------------------------------------------- *
 * ELEMENTS — structural pieces any composition can use.
 * ---------------------------------------------------------- */
@layer elements {
${elementCss()}
}

/* ---------------------------------------------------------- *
 * KITS — the chosen CSS effect treatment.
 * ---------------------------------------------------------- */
@layer kits {
${effectKitCss(input.effects)}
}

/* ---------------------------------------------------------- *
 * MOTION
 * Scroll-driven reveals need no JavaScript at all.
 * ---------------------------------------------------------- */
@layer motion {
  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .reveal {
        animation: forge-reveal linear both;
        animation-timeline: view();
        animation-range: entry 5% cover 32%;
      }
      .reveal--rise { animation-name: forge-rise; }
      .reveal--fade { animation-name: forge-fade; }
    }

    /* A genuine scroll-linked progress bar: zero JS, zero scroll listeners. */
    .scroll-progress {
      position: fixed;
      inset-block-start: 0;
      inset-inline: 0;
      block-size: 2px;
      background: var(--accent);
      transform-origin: 0 50%;
      scale: 0 1;
      animation: forge-progress linear both;
      animation-timeline: scroll(root block);
      z-index: 100;
    }
  }

  @keyframes forge-reveal {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes forge-rise {
    from { opacity: 0; transform: translate3d(0, 2.5rem, 0); }
    to { opacity: 1; transform: none; }
  }
  @keyframes forge-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes forge-progress { to { scale: 1 1; } }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
    }
    .reveal, .scroll-progress { opacity: 1; transform: none; scale: 1 1; }
  }
}

/* ---------------------------------------------------------- *
 * OVERRIDES / progressive enhancement
 * Anchor positioning is the one feature with genuinely uneven support, so
 * captions are positioned statically first and only upgraded when available.
 * ---------------------------------------------------------- */
@layer overrides {
  /* A small figure caption. Deliberately IN FLOW: it reads perfectly well
     there and can never collide with the headline. */
  .anchored {
    margin-block-start: var(--s-2);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* Anchor positioning applied only where it is genuinely safe: attaching the
     popover to the very button that opens it. The fallback is the native
     centred popover, so an engine without support loses nothing. */
  @supports (position-anchor: --trigger) {
    .anchor-host { anchor-name: --trigger; }
    .pop {
      position-anchor: --trigger;
      inset-block-start: anchor(--trigger end);
      inset-inline-end: anchor(--trigger end);
      margin-block-start: var(--s-2);
      /* If it would overflow the viewport, try above the trigger instead. */
      position-try-fallbacks: --flip-below;
    }
    @position-try --flip-below {
      inset-block-start: auto;
      inset-block-end: anchor(--trigger start);
    }
  }

  /* ---- production a11y blocks ---------------------------------------
     Harvested from the variations: print styles appeared in 6/10,
     prefers-contrast in 5/10, forced-colors in 2/10 — and the engine emitted
     none of them, so generated pages were not production-ready. */
  @media print {
    .site-head, .atmosphere, .grain, .scroll-progress { display: none; }
    :root {
      --bg: #fff; --bg-raised: #fff; --fg: #000; --muted: #333;
      --accent: #000; --secondary: #333;
      --hair: #ccc; --hair-strong: #999;
    }
    body { background: #fff; color: #000; font-size: 11pt; }
    .reveal { opacity: 1 !important; transform: none !important; }
    .sec { break-inside: avoid; page-break-inside: avoid; }
    .rail { display: block; overflow: visible; }
    .work-card, .plate { break-inside: avoid; }
    a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; color: #555; }
    @page { margin: 16mm; }
  }

  @media (prefers-contrast: more) {
    :root {
      --hair: color-mix(in oklab, var(--fg) 45%, transparent);
      --hair-strong: color-mix(in oklab, var(--fg) 80%, transparent);
      --muted: var(--fg);
    }
    .btn, .field { outline: 1px solid currentColor; }
    .atmosphere, .grain { display: none; }
  }

  @media (forced-colors: active) {
    .btn, .field, .tag, .plate, .card { border: 1px solid CanvasText; }
    .site-head { background: Canvas; }
    .atmosphere, .grain, .scroll-progress { display: none; }
  }
}
`;
}

/**
 * Human-readable inventory of the modern CSS the engine emits, for the README
 * and for inspection output. Two groups: what Interop 2026 covers, and what is
 * usable today but outside that list.
 */
export const INTEROP_2026_FEATURES = [
  { feature: 'anchor positioning + @position-try', used: 'Figure captions attach to their host, with automatic overflow fallback.' },
  { feature: 'advanced attr()', used: 'Typed values read from data-* attributes without JS.' },
  { feature: '@container style() queries', used: 'Components respond to the --density and --mood design decisions.' },
  { feature: 'contrast-color()', used: 'Readable ink computed on the accent, per palette.' },
  { feature: 'custom highlights (::target-text)', used: 'Styled text fragments from search referrals.' },
  { feature: 'dialog + popover + invoker commands', used: 'Declarative top layer; the "how this was built" panel needs no JS.' },
  { feature: 'media state pseudo-classes', used: ':playing / :paused available for any media the generator emits.' },
  { feature: 'scroll-driven animations', used: 'Reveals via view() and a reading-progress bar via scroll() — zero JS.' },
  { feature: 'scroll snapping', used: 'Standardised snapping on the work rail.' },
  { feature: 'shape()', used: 'Organic section boundary expressed in CSS units, not SVG path data.' },
  { feature: 'view transitions', used: 'Available for cross-document navigation between generated pages.' },
  { feature: 'zoom', used: 'Layout-affecting scale where a real zoom is wanted rather than a transform.' },
] as const;

export const MODERN_CSS_FEATURES = [
  { feature: '@layer', used: 'Cascade layers replace specificity escalation and !important entirely.' },
  { feature: 'sibling-index() / sibling-count()', used: 'Stagger delays, "01 / 06" numbering and alternating grid rhythm derived from position — the generator never computes a per-child delay.' },
  { feature: '@container scroll-state()', used: 'Styles the sticky header once it is stuck, with no scroll listener.' },
  { feature: '::scroll-button() / ::scroll-marker()', used: 'A native carousel with accessible controls and zero JS.' },
  { feature: 'appearance: base-select + ::picker()', used: 'A fully styleable select without rebuilding it in JavaScript.' },
  { feature: '@function', used: 'Reusable value logic that lives in CSS, always with a plain fallback declaration.' },
  { feature: 'corner-shape', used: 'A corner family chosen per emotion (squircle / bevel / round).' },
  { feature: 'reading-flow', used: 'Visual order can be reordered while DOM and tab order stay logical.' },
  { feature: 'grid-lanes', used: 'Native masonry-style packing for the work grid where supported.' },
  { feature: 'oklch() + relative color syntax', used: 'Derives accent steps and hairline greys from one palette entry.' },
  { feature: 'light-dark()', used: 'One declaration serves both colour schemes.' },
  { feature: '@container (size) queries', used: 'Work grid and stats adapt to their own width, not the viewport.' },
  { feature: '@starting-style + allow-discrete', used: 'Popover entry animation without scripted class toggling.' },
  { feature: 'subgrid', used: 'Card internals align to the page grid.' },
  { feature: ':has()', used: 'A card highlights itself when a descendant receives focus.' },
  { feature: 'text-box-trim / text-box-edge', used: 'Display type aligns optically to its container edge.' },
  { feature: 'field-sizing: content', used: 'Form controls size to their content.' },
  { feature: 'content-visibility (opt-in)', used: 'Off-screen blocks skip paint; deliberately opt-in because it interferes with view() timelines and sticky positioning.' },
  { feature: 'scrollbar-gutter: stable', used: 'Prevents horizontal layout shift when content height changes.' },
  { feature: 'prefers-reduced-transparency', used: 'The sticky header drops its backdrop blur when translucency is unwanted.' },
] as const;

