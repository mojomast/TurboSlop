/**
 * TurboSlop — the visual library.
 *
 * Two things live here, both emitted by the layout engine:
 *
 *  1. **Element styles** — the CSS for every structural element a composition can
 *     use (split hero, zig-zag, editorial index, bento board, gallery, spec
 *     table, pull quote, process list, ticker…).
 *
 *  2. **Effect kits** — curated bundles of CSS effects. A kit is chosen as an
 *     axis, so two designs can share a palette and a layout yet feel completely
 *     different because one is hairline-editorial and the other is
 *     luminous-glass.
 *
 * Kits are bundles rather than individual toggles on purpose: effects that look
 * good together are grouped, so the model can never assemble an incoherent
 * combination (grain + glass + letterpress on one surface).
 */

/* ================================================================== *
 * Element styles
 * ================================================================== */
export function elementCss(): string {
  return `/* ---------- split hero ---------- */
  .split {
    display: grid;
    gap: clamp(var(--s-4), 4vw, var(--s-8));
    align-items: start;
  }
  @supports (grid-template-columns: subgrid) {
    .split { container-type: inline-size; }
  }
  @container (min-width: 52rem) {
    .split { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
  }
  .split__panel {
    display: grid;
    gap: var(--s-4);
    padding: var(--s-5);
    border: 1px solid var(--hair-strong);
    border-radius: var(--radius);
    background: var(--bg-raised);
  }
  .split__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-4); }

  /* ---------- zig-zag work rows ---------- */
  .zigzag { display: grid; gap: clamp(var(--s-6), 7vw, var(--s-10)); }
  .zig {
    display: grid;
    gap: clamp(var(--s-4), 4vw, var(--s-8));
    align-items: center;
  }
  @container (min-width: 46rem) {
    .zig { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .zig:nth-child(even) .zig__text { order: 2; }
  }
  .zig__text { display: grid; gap: var(--s-2); align-content: start; }
  .zig__art .plate { aspect-ratio: 4 / 3; }

  /* ---------- editorial index ---------- */
  .editorial-list { display: grid; border-block-start: 1px solid var(--hair-strong); }
  .erow {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: var(--s-2) var(--s-4);
    align-items: baseline;
    padding-block: var(--s-5);
    border-block-end: 1px solid var(--hair);
    transition: background-color var(--dur) var(--ease), padding-inline-start var(--dur) var(--ease);
  }
  .erow:hover { background: var(--bg-raised); padding-inline-start: var(--s-3); }
  .erow__idx { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--fg-faint); }
  .erow__name {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    font-weight: var(--display-weight);
    letter-spacing: var(--track);
    line-height: 1.05;
  }
  .erow__meta { grid-column: 2; font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg-muted); }
  .erow__tags { grid-column: 2; display: flex; flex-wrap: wrap; gap: var(--s-2); margin-block-start: var(--s-2); }
  @container (min-width: 52rem) {
    .erow { grid-template-columns: 3.5rem minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); align-items: center; }
    .erow__meta, .erow__tags { grid-column: auto; margin-block-start: 0; }
  }
  .editorial-list--bare .erow { grid-template-columns: 2.5rem minmax(0, 1fr); }
  .editorial-list--bare .erow__tags { display: none; }

  /* ---------- numbered feature rows ---------- */
  .frows { display: grid; border-block-start: 1px solid var(--hair-strong); }
  .frow {
    display: grid;
    gap: var(--s-2) var(--s-5);
    padding-block: var(--s-5);
    border-block-end: 1px solid var(--hair);
    align-items: start;
  }
  @container (min-width: 46rem) {
    .frow { grid-template-columns: 3.5rem minmax(0, 1fr); }
  }
  .frow__idx { color: var(--fg-faint); padding-block-start: 0.35em; }
  .frow h3 { font-size: var(--fs-h4); }
  .frow p { color: var(--fg-muted); margin-block-start: var(--s-1); }

  /* ---------- bento board ---------- */
  .bento {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(var(--s-2), 1.4vw, var(--s-4));
    container-type: inline-size;
  }
  .bento > * { grid-column: span var(--span, 12); min-inline-size: 0; }
  @container (max-width: 48rem) {
    .bento > * { grid-column: span 12; }
  }
  .tile { margin: 0; }
  .tile a { display: block; }
  .tile__plate {
    aspect-ratio: 4 / 3;
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    overflow: clip;
    background:
      radial-gradient(60% 60% at 30% 25%, color-mix(in oklab, var(--accent) 26%, transparent), transparent 72%),
      var(--bg-raised);
  }
  .tile__plate img { inline-size: 100%; block-size: 100%; object-fit: cover; }
  .tile__meta { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); margin-block-start: var(--s-2); }
  .tile--stat, .tile--quote {
    display: grid;
    align-content: center;
    padding: var(--s-5);
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    background: var(--bg-raised);
  }
  .stat--tile { border: 0; padding: 0; }

  /* ---------- full-bleed gallery ---------- */
  .gallery {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(var(--s-2), 1.2vw, var(--s-4));
    padding-inline: var(--gutter);
    margin-block-start: var(--s-6);
    container-type: inline-size;
  }
  .gallery .tile { grid-column: span var(--span, 4); }
  @container (max-width: 48rem) { .gallery .tile { grid-column: span 12; } }

  /* ---------- pull quote ---------- */
  .quote { display: grid; gap: var(--s-4); max-inline-size: 34ch; margin: 0; }
  .quote blockquote {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: clamp(1.5rem, 3.4vw, 2.75rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  .quote blockquote::before { content: "“"; color: var(--accent); }
  .quote blockquote::after { content: "”"; color: var(--accent); }
  .quote figcaption { color: var(--fg-muted); letter-spacing: 0.14em; text-transform: uppercase; }
  .tile--quote .quote { max-inline-size: none; }
  .tile--quote blockquote { font-size: clamp(1.05rem, 2vw, 1.5rem); }

  /* ---------- numbered process ---------- */
  .steps { display: grid; gap: 0; border-block-start: 1px solid var(--hair-strong); counter-reset: step; }
  .steps li {
    display: grid;
    gap: var(--s-1) var(--s-5);
    padding-block: var(--s-5);
    border-block-end: 1px solid var(--hair);
    align-items: start;
  }
  @container (min-width: 46rem) { .steps li { grid-template-columns: 3.5rem minmax(0, 1fr); } }
  .steps .mono { color: var(--accent); padding-block-start: 0.35em; }
  .steps h3 { font-size: var(--fs-h4); }
  .steps p { color: var(--fg-muted); margin-block-start: var(--s-1); }

  /* ---------- running columns ---------- */
  .columns { columns: 1; column-gap: clamp(var(--s-4), 4vw, var(--s-8)); }
  @container (min-width: 44rem) { .columns { columns: 2; } }
  .columns--wide { max-inline-size: none; }
  .columns p { break-inside: avoid; margin-block-end: var(--s-4); }
  .columns p:first-child::first-letter {
    float: inline-start;
    font-family: var(--font-display);
    font-size: 3.2em;
    line-height: 0.82;
    padding-inline-end: 0.08em;
    color: var(--accent);
  }

  /* ---------- ticker band ---------- */
  .ticker {
    overflow: hidden;
    border-block: 1px solid var(--hair-strong);
    background: var(--bg-raised);
    padding-block: var(--s-3);
  }
  .ticker__track {
    display: flex;
    align-items: center;
    gap: var(--s-5);
    inline-size: max-content;
    animation: ticker-run 40s linear infinite;
  }
  .ticker:hover .ticker__track,
  .ticker:focus-within .ticker__track { animation-play-state: paused; }
  .ticker__item {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .ticker__sep { color: var(--accent); }
  @keyframes ticker-run { to { transform: translate3d(-50%, 0, 0); } }
  @media (prefers-reduced-motion: reduce) {
    .ticker__track { animation: none; flex-wrap: wrap; inline-size: auto; }
  }

  /* ---------- compact masthead (gallery-first) ---------- */
  .masthead__row { display: grid; gap: var(--s-5); align-items: end; }
  @container (min-width: 52rem) { .masthead__row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); } }
  .masthead__title {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    font-size: var(--fs-h1);
    line-height: 0.98;
    letter-spacing: var(--track);
    text-wrap: balance;
    overflow-wrap: break-word;
  }
  .masthead__side { display: grid; gap: var(--s-4); justify-items: start; }

  /* ---------- opening statements ---------- */
  .editorial-open__h, .manifesto-open__h, .bento-open__h, .data-open__h {
    font-size: var(--fs-display);
    line-height: 1;
    letter-spacing: var(--track);
    margin-block: var(--s-5) var(--s-6);
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  .editorial-open__foot {
    display: grid;
    gap: var(--s-5);
    align-items: end;
    margin-block-end: var(--s-6);
  }
  @container (min-width: 52rem) { .editorial-open__foot { grid-template-columns: minmax(0, 1fr) auto; } }
  .manifesto-open__lede { font-family: var(--font-serif); font-size: var(--fs-lede); max-inline-size: 52ch; }
  .data-open .stats { margin-block-start: var(--s-6); }

  /* ---------- spec table (data-first) ---------- */
  .table-wrap { overflow-x: auto; border: 1px solid var(--hair-strong); border-radius: var(--radius); }
  .spectable { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-small); }
  .spectable th, .spectable td { text-align: start; padding: var(--s-3) var(--s-4); border-block-end: 1px solid var(--hair); }
  .spectable thead th {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-faint);
    background: var(--bg-raised);
    white-space: nowrap;
  }
  .spectable tbody tr:hover { background: var(--bg-raised); }
  .spectable tbody th { font-weight: 500; white-space: nowrap; }
  .spectable td.mono { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--fg-muted); }

  /* ---------- definition list ---------- */
  .deflist { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-3) var(--s-6); }
  .deflist dt { font-weight: 500; white-space: nowrap; }
  .deflist dd { margin: 0; color: var(--fg-muted); }

  /* ---------- about ---------- */
  .about-rail { grid-column: 1 / -1; }
  .about-text { grid-column: 1 / -1; }
  @container (min-width: 52rem) {
    .about-rail { grid-column: 1 / span 4; }
    .about-text { grid-column: 6 / -1; }
  }
  .about-text p + p { margin-block-start: var(--s-4); }
  .spec--inline { margin-block-start: var(--s-6); }

  /* ---------- contact form column spans ---------- */
  .span-6 { grid-column: span 12; }
  .span-full { grid-column: 1 / -1; }
  @container (min-width: 40rem) { .span-6 { grid-column: span 6; } }

  /* ---------- structural containers need a container context ---------- */
  .sec { container-type: inline-size; }
  .work-grid, .gallery, .bento { container-type: inline-size; }

  /* ================================================================
   * HERO VARIANTS — the first screen is the strongest signal that two
   * pages are different, so each variant is a genuinely different shape.
   * ================================================================ */
  .hero-compact { display: grid; gap: var(--s-5); align-items: end; }
  @container (min-width: 52rem) {
    .hero-compact { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); }
  }
  .hero-compact__title {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    font-size: var(--fs-h1);
    line-height: 1;
    letter-spacing: var(--track);
    text-wrap: balance;
    overflow-wrap: break-word;
  }
  .hero-compact__side { display: grid; gap: var(--s-4); justify-items: start; }

  .hero-panel {
    display: grid;
    gap: var(--s-6);
    padding: clamp(var(--s-5), 4vw, var(--s-8));
    border: 1px solid var(--hair-strong);
    border-radius: var(--radius);
    background: var(--bg-raised);
  }
  @container (min-width: 52rem) {
    .hero-panel { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
  }
  .hero-panel__body { display: grid; gap: var(--s-4); align-content: start; }

  .hero-media { display: grid; gap: var(--s-5); }
  .hero-media__plate { aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: clip; }
  .hero-media__plate img { inline-size: 100%; block-size: 100%; object-fit: cover; }
  .hero-media__caption { display: grid; gap: var(--s-3); }
  .hero-media__title {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    font-size: var(--fs-h2);
    line-height: 1.02;
    letter-spacing: var(--track-tight);
    text-wrap: balance;
  }

  .hero-index__title {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    font-size: var(--fs-h2);
    line-height: 1.05;
    letter-spacing: var(--track);
    margin-block: var(--s-4) var(--s-6);
    max-inline-size: 24ch;
  }
  .hero-index { display: grid; border-block-start: 1px solid var(--hair-strong); }
  .hero-index li {
    display: flex;
    gap: var(--s-4);
    align-items: baseline;
    padding-block: var(--s-3);
    border-block-end: 1px solid var(--hair);
    font-size: var(--fs-h4);
  }
  .hero-index .mono { color: var(--fg-faint); }

  .dateline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-6);
    padding-block: var(--s-3);
    border-block: 1px solid var(--hair-strong);
    margin-block-end: var(--s-5);
  }
  .dateline li { display: flex; gap: var(--s-3); align-items: baseline; }
  .dateline .mono { color: var(--fg-faint); text-transform: uppercase; }
  .hero-dateline__title { margin-block-end: var(--s-4); }

  /* ================================================================
   * NAV VARIANTS
   * ================================================================ */
  .site-head--minimal nav { justify-content: flex-start; }
  .site-head--inline .nav-list { margin-inline-start: auto; }
  .site-head--stacked nav {
    display: grid;
    gap: var(--s-2);
    justify-items: start;
    padding-block: var(--s-4);
  }

  /* ================================================================
   * FOOTER VARIANTS
   * ================================================================ */
  .footer--minimal { padding-block: var(--s-6); }
  .footer--cta { padding-block: var(--sec-pad); text-align: start; }
  .footer__cta {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    line-height: 1.05;
    letter-spacing: var(--track-tight);
    margin-block-end: var(--s-5);
    text-wrap: balance;
  }
  .colophon {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: var(--fs-lede);
    max-inline-size: 58ch;
    margin-block: var(--s-5) var(--s-3);
  }
  .footer--ledger .spec, .footer--columns .spec { margin-block-start: 0; }

  /* ================================================================
   * ADDITIONAL BLOCK VARIANTS
   * ================================================================ */
  .plainlist { display: grid; border-block-start: 1px solid var(--hair-strong); }
  .plainlist li {
    display: flex;
    gap: var(--s-4);
    justify-content: space-between;
    align-items: baseline;
    padding-block: var(--s-3);
    border-block-end: 1px solid var(--hair);
  }

  .stat-inline { display: inline-flex; gap: var(--s-2); align-items: baseline; }
  .stat-inline b {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    letter-spacing: var(--track);
    font-variant-numeric: tabular-nums;
  }
  .stats--tiles { grid-auto-rows: 1fr; }
  .stats--tiles .stat {
    display: grid;
    align-content: end;
    padding: var(--s-5);
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    background: var(--bg-raised);
  }

  .steps--timeline { border-inline-start: 1px solid var(--hair-strong); margin-inline-start: var(--s-3); }
  .steps--timeline li { border-block-end: 0; padding-inline-start: var(--s-5); position: relative; }
  .steps--timeline li::before {
    content: "";
    position: absolute;
    inset-inline-start: -5px;
    inset-block-start: calc(var(--s-5) + 0.35em);
    inline-size: 9px;
    block-size: 9px;
    border-radius: 50%;
    background: var(--accent);
  }

  .quote--band {
    max-inline-size: none;
    padding-block: var(--s-8);
    border-block: 1px solid var(--hair-strong);
  }
  .quote--band blockquote { font-size: clamp(1.75rem, 5vw, 3.5rem); max-inline-size: 28ch; }
  .quote--inline blockquote { font-size: clamp(1.15rem, 2vw, 1.6rem); }

  .gallery--strip { grid-auto-flow: column; grid-auto-columns: 24%; overflow-x: auto; padding-block-end: var(--s-3); }
  .gallery--strip .tile { grid-column: auto; }
  @media (max-width: 48rem) { .gallery--strip { grid-auto-columns: 70%; } }

  .agenda { display: grid; gap: var(--s-4); }
  .agenda li {
    display: grid;
    gap: var(--s-1);
    padding-block: var(--s-4);
    border-block-start: 1px solid var(--hair-strong);
  }
  .agenda .mono { color: var(--accent); text-transform: uppercase; }

  .tiers { align-items: stretch; }
  .tier { display: grid; gap: var(--s-3); align-content: start; grid-column: span 12; }
  @container (min-width: 46rem) { .tier { grid-column: span 4; } }
  .tier--featured { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 8%, var(--bg-raised)); }
  .tier__price { font-size: var(--fs-h3); color: var(--accent); }

  .faq { display: grid; border-block-start: 1px solid var(--hair-strong); }
  .faq li { border-block-end: 1px solid var(--hair); }
  .faq summary {
    cursor: pointer;
    padding-block: var(--s-4);
    font-family: var(--font-display);
    font-size: var(--fs-h4);
    list-style: none;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: " +"; color: var(--accent); }
  .faq details[open] summary::after { content: " −"; }
  .faq p { padding-block-end: var(--s-4); color: var(--fg-muted); max-inline-size: 62ch; }

  .spec--stack { grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }`;
}

/* ================================================================== *
 * Effect kits
 *
 * Each kit is a coherent bundle. Emitted scoped to its own attribute so only
 * the chosen one ships.
 * ================================================================== */
export function effectKitCss(kit: string): string {
  const body = KITS[kit] ?? KITS['flat-plain']!;
  return `/* ---------- effect kit: ${kit} ---------- */
  ${body}`;
}

const KITS: Record<string, string> = {
  'flat-plain': `
  [data-effects='flat-plain'] { --lift: none; --accent-glow: none; }
  [data-effects='flat-plain'] .card,
  [data-effects='flat-plain'] .split__panel,
  [data-effects='flat-plain'] .tile--stat,
  [data-effects='flat-plain'] .tile--quote { background: transparent; }`,

  /* 1px rules, drop cap, hanging punctuation, tabular figures */
  'hairline-editorial': `
  [data-effects='hairline-editorial'] .rule { background: var(--hair-accent); }
  [data-effects='hairline-editorial'] .sec { border-block-start: 1px solid var(--hair); }
  [data-effects='hairline-editorial'] .sec:first-of-type { border-block-start: 0; }
  [data-effects='hairline-editorial'] .eyebrow::after {
    content: "";
    flex: 1;
    block-size: 1px;
    background: var(--hair);
    margin-inline-start: var(--s-4);
  }
  [data-effects='hairline-editorial'] .erow__name,
  [data-effects='hairline-editorial'] .frow h3 { font-variant-numeric: tabular-nums; }
  [data-effects='hairline-editorial'] h2 { hanging-punctuation: first last; }
  [data-effects='hairline-editorial'] .lede { position: relative; padding-inline-start: var(--s-5); }
  [data-effects='hairline-editorial'] .lede::before {
    content: "";
    position: absolute;
    inset-block: 0.35em;
    inset-inline-start: 0;
    inline-size: 2px;
    background: var(--accent);
  }`,

  /* crosshairs, ticks, dashed guides, faint grid */
  'technical-drawing': `
  [data-effects='technical-drawing'] .sec::before {
    content: "";
    position: absolute;
    inset: var(--s-4);
    pointer-events: none;
    background-image:
      linear-gradient(to right, var(--hair) 1px, transparent 1px),
      linear-gradient(to bottom, var(--hair) 1px, transparent 1px);
    background-size: 4rem 4rem;
    -webkit-mask-image: radial-gradient(120% 100% at 50% 0%, transparent 55%, #000 100%);
    mask-image: radial-gradient(120% 100% at 50% 0%, transparent 55%, #000 100%);
    opacity: 0.5;
  }
  [data-effects='technical-drawing'] .hgroup { position: relative; padding-block-start: var(--s-4); }
  [data-effects='technical-drawing'] .hgroup::before {
    content: "+";
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    font-family: var(--font-mono);
    color: var(--accent);
    font-size: var(--fs-label);
  }
  [data-effects='technical-drawing'] .hgroup::after {
    content: "";
    position: absolute;
    inset-block-start: -1px;
    inset-inline-start: var(--s-5);
    inset-inline-end: 0;
    block-size: 1px;
    background: repeating-linear-gradient(90deg, var(--hair-strong) 0 6px, transparent 6px 12px);
  }
  [data-effects='technical-drawing'] .work-card,
  [data-effects='technical-drawing'] .tile { outline: 1px dashed var(--hair); outline-offset: 6px; }`,

  /* layered soft shadows, top light, generous radii */
  'soft-material': `
  [data-effects='soft-material'] {
    --radius: 14px;
    --lift: 0 1px 0 0 color-mix(in oklab, var(--fg) 8%, transparent) inset,
            0 18px 40px -24px rgb(0 0 0 / 0.55);
  }
  [data-effects='soft-material'] .card,
  [data-effects='soft-material'] .split__panel,
  [data-effects='soft-material'] .tile--stat,
  [data-effects='soft-material'] .tile--quote,
  [data-effects='soft-material'] .plate,
  [data-effects='soft-material'] .tile__plate {
    background-image: linear-gradient(180deg, color-mix(in oklab, var(--fg) 6%, transparent), transparent 40%);
    box-shadow: var(--lift);
    border-color: transparent;
  }
  [data-effects='soft-material'] .btn { box-shadow: var(--lift); }`,

  /* blurred mesh washes, blobs, soft edges */
  'organic-mesh': `
  [data-effects='organic-mesh'] .sec--raised,
  [data-effects='organic-mesh'] .sec--sunk { background: var(--bg); }
  /* The wash is positioned INSIDE the section's inline box. An earlier version
     used inset-inline-end:-10%, which pushed the page 1568px wide at a 1440px
     viewport and 413px wide at 390 — the baseline caught it. */
  [data-effects='organic-mesh'] .sec::before {
    content: "";
    position: absolute;
    inset-block-start: -15%;
    inset-inline-start: 0;
    inline-size: 52%;
    block-size: 60%;
    pointer-events: none;
    background: radial-gradient(closest-side, color-mix(in oklab, var(--accent) 22%, transparent), transparent 78%);
    filter: blur(40px);
    border-radius: 50%;
    z-index: -1;
  }
  [data-effects='organic-mesh'] .sec:nth-of-type(even)::before {
    inset-inline-start: auto;
    inset-inline-end: 0;
    background: radial-gradient(closest-side, color-mix(in oklab, var(--secondary) 20%, transparent), transparent 78%);
  }
  [data-effects='organic-mesh'] .sec { overflow-x: clip; }
  [data-effects='organic-mesh'] .plate,
  [data-effects='organic-mesh'] .tile__plate { border-radius: 30% 12% 26% 10% / 16% 24% 12% 28%; }
  [data-effects='organic-mesh'] .split__panel,
  [data-effects='organic-mesh'] .card { border-radius: var(--s-6); }`,

  /* 2px borders, hard offset shadow, no radii, slight rotation */
  'brutalist-block': `
  [data-effects='brutalist-block'] { --radius: 0px; }
  [data-effects='brutalist-block'] .btn,
  [data-effects='brutalist-block'] .field,
  [data-effects='brutalist-block'] .tag,
  [data-effects='brutalist-block'] .card,
  [data-effects='brutalist-block'] .split__panel,
  [data-effects='brutalist-block'] .plate,
  [data-effects='brutalist-block'] .tile__plate { border-radius: 0; }
  [data-effects='brutalist-block'] .card,
  [data-effects='brutalist-block'] .split__panel,
  [data-effects='brutalist-block'] .tile--stat,
  [data-effects='brutalist-block'] .tile--quote {
    border: 2px solid var(--fg);
    box-shadow: 6px 6px 0 0 var(--accent);
  }
  [data-effects='brutalist-block'] .plate,
  [data-effects='brutalist-block'] .tile__plate { border: 2px solid var(--fg); }
  [data-effects='brutalist-block'] .btn { border: 2px solid var(--fg); box-shadow: 4px 4px 0 0 var(--fg); }
  [data-effects='brutalist-block'] .btn:hover { transform: translate(-1px, -1px); box-shadow: 6px 6px 0 0 var(--fg); }
  [data-effects='brutalist-block'] .tile:nth-child(3n) { rotate: -0.6deg; }
  [data-effects='brutalist-block'] .tile:nth-child(3n + 1) { rotate: 0.4deg; }`,

  /* vignette, letterbox bands, bloom, grain */
  'cinematic-depth': `
  [data-effects='cinematic-depth'] .sec--shaped::after { display: none; }
  [data-effects='cinematic-depth'] .sec::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--bg) 90%, transparent), transparent 18%, transparent 82%, color-mix(in oklab, var(--bg) 90%, transparent)),
      radial-gradient(120% 90% at 50% 45%, transparent 52%, color-mix(in oklab, var(--bg) 70%, transparent));
  }
  [data-effects='cinematic-depth'] .display,
  [data-effects='cinematic-depth'] .masthead__title { text-shadow: 0 0 60px color-mix(in oklab, var(--accent) 30%, transparent); }
  [data-effects='cinematic-depth'] .hero-art { opacity: 0.55; }
  [data-effects='cinematic-depth'] .plate,
  [data-effects='cinematic-depth'] .tile__plate { box-shadow: 0 40px 80px -50px #000; }`,

  /* glass, gradient hairline, inner glow, iridescence */
  'luminous-glass': `
  [data-effects='luminous-glass'] .card,
  [data-effects='luminous-glass'] .split__panel,
  [data-effects='luminous-glass'] .tile--stat,
  [data-effects='luminous-glass'] .tile--quote,
  [data-effects='luminous-glass'] .pop {
    background: color-mix(in oklab, var(--bg-raised) 72%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    backdrop-filter: blur(14px) saturate(1.3);
    border: 1px solid transparent;
    background-image:
      linear-gradient(color-mix(in oklab, var(--bg-raised) 72%, transparent), color-mix(in oklab, var(--bg-raised) 72%, transparent)),
      linear-gradient(135deg, color-mix(in oklab, var(--accent) 60%, transparent), transparent 45%, color-mix(in oklab, var(--secondary) 55%, transparent));
    background-origin: border-box;
    background-clip: padding-box, border-box;
    box-shadow: 0 1px 0 0 color-mix(in oklab, var(--fg) 14%, transparent) inset;
  }
  [data-effects='luminous-glass'] .split__panel { border-block-start: 0; }
  [data-effects='luminous-glass'] .btn { box-shadow: 0 0 26px -6px color-mix(in oklab, var(--accent) 60%, transparent); }
  [data-effects='luminous-glass'] .plate::after,
  [data-effects='luminous-glass'] .tile__plate::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(120deg, color-mix(in oklab, var(--accent) 22%, transparent), transparent 40%, color-mix(in oklab, var(--secondary) 20%, transparent));
    mix-blend-mode: screen;
    pointer-events: none;
  }
  [data-effects='luminous-glass'] .plate,
  [data-effects='luminous-glass'] .tile__plate { position: relative; }`,

  /* paper grain, letterpress inset, deckled bands */
  'tactile-paper': `
  [data-effects='tactile-paper'] body,
  [data-effects='tactile-paper'] .sec--raised,
  [data-effects='tactile-paper'] .sec--sunk {
    --paper: 1;
  }
  [data-effects='tactile-paper'] .sec--raised,
  [data-effects='tactile-paper'] .sec--sunk {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23p)' opacity='0.5'/%3E%3C/svg%3E");
  }
  [data-effects='tactile-paper'] .card,
  [data-effects='tactile-paper'] .split__panel,
  [data-effects='tactile-paper'] .tile--stat,
  [data-effects='tactile-paper'] .tile--quote {
    box-shadow: 0 1px 0 0 color-mix(in oklab, var(--fg) 10%, transparent) inset,
                0 -1px 0 0 color-mix(in oklab, var(--bg) 60%, transparent) inset;
  }
  [data-effects='tactile-paper'] h1,
  [data-effects='tactile-paper'] .masthead__title {
    text-shadow: 0 1px 0 color-mix(in oklab, var(--bg) 70%, transparent);
  }
  [data-effects='tactile-paper'] .plate,
  [data-effects='tactile-paper'] .tile__plate {
    box-shadow: 0 2px 0 0 color-mix(in oklab, var(--fg) 14%, transparent);
  }
  [data-effects='tactile-paper'] .sec { border-block-end: 1px solid var(--hair); }`,
};

export const EFFECT_KIT_IDS = Object.keys(KITS);
