/**
 * TurboSlop — the block library.
 *
 * Every module a blueprint can select, rendered per variant. This is the
 * vocabulary the layout grammar composes from.
 *
 * A blueprint picks a subset of these in an order, so two pages can share a
 * palette, a typeface and an effect kit and still be laid out completely
 * differently. Nothing here assumes a fixed spine — there is no page-level
 * function that renders "the sections", only per-module renderers.
 */
import { emphasize, stripEmphasis, type Content, type Item } from './content.js';
import type { Asset } from './types.js';
import type { HeroVariant, ModuleId, NavVariant, FooterVariant, Blueprint } from './blueprint.js';

export interface BlockCtx {
  content: Content;
  emotion: string;
  paletteId: string;
  typeId: string;
  plateAssets: Asset[];
  backdrops: Asset[];
  blueprint: Blueprint;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const empty = (what: string) =>
  `        <p class="note">No ${what} supplied for this brief.</p>`;

/** An image slot. Falls back to a gradient plate, so a page never breaks without art. */
function plate(assets: Asset[], i: number, cls = 'plate'): string {
  const a = assets.length ? assets[i % assets.length] : undefined;
  if (!a) return `<div class="${cls}" aria-hidden="true"></div>`;
  return `<div class="${cls}"><img class="plate-img" src="${esc(a.file)}" alt="${esc(
    a.alt,
  )}" width="256" height="256" loading="lazy" decoding="async"></div>`;
}

/* ================================================================== *
 * items — catalogue / portfolio / menu / products
 * ================================================================== */
function itemsRail(items: Item[], ctx: BlockCtx): string {
  return `        <div class="rail stagger" role="region" aria-label="${esc(
    stripEmphasis(ctx.content.sections.items.title),
  )}, scrollable">
${items
  .map(
    (it, i) => `          <article class="work-card reveal reveal--rise">
            <a href="#contact" aria-label="${esc(it.name)} — enquire">
              ${plate(ctx.plateAssets, i)}
              <p class="eyebrow">${esc(it.meta)}</p>
              <h3>${esc(it.name)}</h3>
              ${it.tags.length ? `<p class="lede">${esc(it.tags.join(' · '))}</p>` : ''}
            </a>
          </article>`,
  )
  .join('\n')}
        </div>`;
}

function itemsGrid(items: Item[], ctx: BlockCtx): string {
  return `        <div class="grid work-grid">
${items
  .map(
    (it, i) => `          <article class="work-card col-6 reveal reveal--rise">
            <a href="#contact">
              ${plate(ctx.plateAssets, i)}
              <p class="eyebrow">${esc(it.meta)}</p>
              <h3>${esc(it.name)}</h3>
              ${it.tags.length ? `<p class="lede">${esc(it.tags.join(' · '))}</p>` : ''}
            </a>
          </article>`,
  )
  .join('\n')}
        </div>`;
}

function itemsEditorialIndex(items: Item[]): string {
  return `        <ol class="editorial-list">
${items
  .map(
    (it, i) => `          <li class="erow reveal" data-reveal="fade">
            <span class="erow__idx">${String(i + 1).padStart(2, '0')}</span>
            <span class="erow__name">${esc(it.name)}</span>
            <span class="erow__meta">${esc(it.meta)}</span>
            <span class="erow__tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</span>
          </li>`,
  )
  .join('\n')}
        </ol>`;
}

function itemsList(items: Item[]): string {
  return `        <ul class="plainlist">
${items
  .map(
    (it) => `          <li><b>${esc(it.name)}</b> <span class="mono">${esc(it.meta)}</span></li>`,
  )
  .join('\n')}
        </ul>`;
}

function itemsTable(items: Item[], ctx: BlockCtx): string {
  return `        <div class="table-wrap">
          <table class="spectable">
            <caption class="visually-hidden">${esc(stripEmphasis(ctx.content.sections.items.title))}</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Detail</th><th scope="col">Tags</th></tr></thead>
            <tbody>
${items
  .map(
    (it, i) => `              <tr><td class="mono">${String(i + 1).padStart(2, '0')}</td><th scope="row">${esc(it.name)}</th><td>${esc(it.meta)}</td><td class="mono">${esc(it.tags.join(', ') || '—')}</td></tr>`,
  )
  .join('\n')}
            </tbody>
          </table>
        </div>`;
}

const BENTO_SPANS = [6, 3, 3, 4, 4, 4, 6, 6];
function itemsBento(items: Item[], ctx: BlockCtx): string {
  return `        <div class="bento">
${items
  .map(
    (it, i) => `          <article class="tile reveal reveal--scale" style="--span:${BENTO_SPANS[i % BENTO_SPANS.length]}">
            <a href="#contact" aria-label="${esc(it.name)} — enquire">
              ${plate(ctx.plateAssets, i, 'tile__plate')}
              <span class="tile__meta"><b>${esc(it.name)}</b> <span class="mono">${esc(it.meta)}</span></span>
            </a>
          </article>`,
  )
  .join('\n')}
        </div>`;
}

function itemsGallery(items: Item[], ctx: BlockCtx): string {
  return `        <div class="gallery">
${items
  .map(
    (it, i) => `          <article class="tile reveal reveal--scale" style="--span:${i % 5 === 0 ? 8 : 4}">
            <a href="#contact" aria-label="${esc(it.name)} — enquire">
              ${plate(ctx.plateAssets, i, 'tile__plate')}
              <span class="tile__meta"><b>${esc(it.name)}</b> <span class="mono">${esc(it.meta)}</span></span>
            </a>
          </article>`,
  )
  .join('\n')}
        </div>`;
}

const ITEMS: Record<string, (items: Item[], ctx: BlockCtx) => string> = {
  rail: itemsRail,
  grid: itemsGrid,
  'editorial-index': (items) => itemsEditorialIndex(items),
  list: (items) => itemsList(items),
  table: itemsTable,
  bento: itemsBento,
  gallery: itemsGallery,
};

/* ================================================================== *
 * features
 * ================================================================== */
function featuresCards(features: Content['features']): string {
  return `        <div class="grid numbered">
${features
  .map(
    (f) => `          <div class="card"><h3>${esc(f.name)}</h3><p>${esc(f.detail)}</p></div>`,
  )
  .join('\n')}
        </div>`;
}

function featuresRows(features: Content['features']): string {
  return `        <ul class="frows">
${features
  .map(
    (f, i) => `          <li class="frow reveal" data-reveal="fade">
            <span class="mono frow__idx">${String(i + 1).padStart(2, '0')}</span>
            <div><h3>${esc(f.name)}</h3><p>${esc(f.detail)}</p></div>
          </li>`,
  )
  .join('\n')}
        </ul>`;
}

const FEATURES: Record<string, (f: Content['features']) => string> = {
  cards: featuresCards,
  rows: featuresRows,
  deflist: (f) =>
    `        <dl class="deflist">\n${f.map((x) => `          <dt>${esc(x.name)}</dt><dd>${esc(x.detail)}</dd>`).join('\n')}\n        </dl>`,
  pills: (f) =>
    `        <p class="cluster">${f.map((x) => `<span class="tag" title="${esc(x.detail)}">${esc(x.name)}</span>`).join('\n          ')}</p>`,
};

/* ================================================================== *
 * the rest
 * ================================================================== */
function statsRow(stats: Content['stats'], variant: string): string {
  if (variant === 'inline') {
    return `        <p class="cluster">${stats
      .map((x) => `<span class="stat-inline"><b>${esc(x.value)}</b> <span class="mono">${esc(x.label)}</span></span>`)
      .join('\n          ')}</p>`;
  }
  const cls = variant === 'tiles' ? 'stats stats--tiles' : 'stats';
  return `        <div class="${cls}">
${stats
  .map(
    (x) =>
      `          <div class="stat"><b>${esc(x.value)}</b><span>${esc(x.label)}</span>${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}</div>`,
  )
  .join('\n')}
        </div>`;
}

function aboutBlock(c: Content, variant: string): string {
  if (variant === 'letter') {
    return `        <div class="columns">
${c.aboutBody.map((p) => `          <p>${esc(p)}</p>`).join('\n')}
        </div>`;
  }
  if (variant === 'rail-text') {
    return `        <div class="grid">
          <aside class="about-rail col-4">
            <dl class="spec">${c.aboutFacts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>
          </aside>
          <div class="about-text col-8">${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n            ')}</div>
        </div>`;
  }
  return `        <div class="grid">
          <div class="about-rail col-4"><dl class="spec">${c.aboutFacts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl></div>
          <div class="about-text col-8">${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n            ')}</div>
        </div>`;
}

const quoteBlock = (q: Content['pullQuote'], variant: string) =>
  !q
    ? ''
    : `        <figure class="quote quote--${variant}${variant === 'band' ? ' quote--band' : ''} reveal" data-reveal="fade">
          <blockquote>${esc(q.text)}</blockquote>
          ${q.attribution ? `<figcaption class="mono">${esc(q.attribution)}</figcaption>` : ''}
        </figure>`;

const processBlock = (steps: Content['process'], variant: string) =>
  `        <ol class="steps steps--${variant}">
${steps
  .map(
    (s, i) => `          <li class="reveal" data-reveal="fade">
            <span class="mono">${String(i + 1).padStart(2, '0')}</span>
            <h3>${esc(s.name)}</h3>
            <p>${esc(s.detail)}</p>
          </li>`,
  )
  .join('\n')}
        </ol>`;

const galleryBlock = (c: Content, ctx: BlockCtx, variant: string) =>
  `        <div class="gallery gallery--${variant}">
${c.items
  .slice(0, ctx.blueprint.imageSlots || 4)
  .map(
    (it, i) => `          <figure class="tile" style="--span:${variant === 'strip' ? 3 : i % 4 === 0 ? 6 : 3}">
            ${plate(ctx.plateAssets, i, 'tile__plate')}
            <figcaption class="mono">${esc(it.name)}</figcaption>
          </figure>`,
  )
  .join('\n')}
        </div>`;

const scheduleBlock = (c: Content, variant: string) =>
  variant === 'agenda'
    ? `        <ol class="agenda">
${c.items
  .slice(0, 5)
  .map(
    (it, i) => `          <li class="reveal" data-reveal="fade">
            <span class="mono">Day ${i + 1}</span>
            <h3>${esc(it.name)}</h3>
            <p>${esc(it.meta)}</p>
          </li>`,
  )
  .join('\n')}
        </ol>`
    : `        <div class="table-wrap"><table class="spectable">
          <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Detail</th></tr></thead>
          <tbody>${c.items
            .slice(0, 5)
            .map((it, i) => `<tr><td class="mono">Day ${i + 1}</td><th scope="row">${esc(it.name)}</th><td>${esc(it.meta)}</td></tr>`)
            .join('')}</tbody>
        </table></div>`;

const pricingBlock = (c: Content, variant: string) => {
  if (variant === 'tiers') {
    return `        <div class="grid tiers">
${c.features
  .slice(0, 3)
  .map(
    (f, i) => `          <div class="tier card${i === 1 ? ' tier--featured' : ''}">
            <h3>${esc(f.name)}</h3>
            <p class="tier__price mono">${esc(c.stats[i]?.value ?? '—')}</p>
            <p>${esc(f.detail)}</p>
          </div>`,
  )
  .join('\n')}
        </div>`;
  }
  return `        <div class="table-wrap"><table class="spectable">
          <thead><tr><th scope="col">Tier</th><th scope="col">Price</th><th scope="col">Includes</th></tr></thead>
          <tbody>${c.features
            .slice(0, 4)
            .map((f, i) => `<tr><th scope="row">${esc(f.name)}</th><td class="mono">${esc(c.stats[i]?.value ?? '—')}</td><td>${esc(f.detail)}</td></tr>`)
            .join('')}</tbody>
        </table></div>`;
};

const faqBlock = (c: Content) => `        <ul class="faq">
${c.features
  .slice(0, 4)
  .map(
    (f, i) => `          <li><details${i === 0 ? ' open' : ''}><summary>${esc(f.name)}</summary><p>${esc(f.detail)}</p></details></li>`,
  )
  .join('\n')}
        </ul>`;

function contactBlock(c: Content, variant: string): string {
  const details = `        <p class="display"><a class="link-u" href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a></p>
        <p class="cluster" style="margin-block-start: var(--s-4)">
          <span class="tag">${esc(c.contact.address)}</span>
          <a class="tag" href="tel:${esc(c.contact.phone.replace(/[^\d+]/g, ''))}">${esc(c.contact.phone)}</a>
        </p>`;

  if (variant === 'email') return details;

  const form = `        <form class="grid contact-form" style="margin-block-start: var(--s-8)" onsubmit="return false">
          <label class="span-6"><span class="eyebrow">Name</span><input class="field" name="name" autocomplete="name" required></label>
          <label class="span-6"><span class="eyebrow">Email</span><input class="field" name="email" type="email" autocomplete="email" required></label>
          <label class="span-full"><span class="eyebrow">Message</span><textarea class="field" name="message" rows="3"></textarea></label>
          <p class="span-full"><button class="btn" type="submit">${esc(c.cta)}</button></p>
        </form>`;

  if (variant === 'split') {
    return `        <div class="split"><div>${details}</div><div>${form}</div></div>`;
  }
  return details + '\n' + form;
}

/* ================================================================== *
 * Dispatch
 * ================================================================== */
export function renderModule(module: ModuleId, variant: string, ctx: BlockCtx): string {
  const c = ctx.content;
  switch (module) {
    case 'items': {
      if (!c.items.length) return empty('work');
      return (ITEMS[variant] ?? itemsGrid)(c.items, ctx);
    }
    case 'features': {
      if (!c.features.length) return empty('capabilities');
      return (FEATURES[variant] ?? featuresCards)(c.features);
    }
    case 'stats':
      return c.stats.length ? statsRow(c.stats, variant) : empty('figures');
    case 'about':
      return c.aboutBody.length ? aboutBlock(c, variant) : empty('description');
    case 'process':
      return c.process.length ? processBlock(c.process, variant) : empty('process detail');
    case 'quote':
      return c.pullQuote ? quoteBlock(c.pullQuote, variant) : empty('quote');
    case 'gallery':
      return galleryBlock(c, ctx, variant);
    case 'schedule':
      return scheduleBlock(c, variant);
    case 'pricing':
      return pricingBlock(c, variant);
    case 'faq':
      return faqBlock(c);
    case 'contact':
      return contactBlock(c, variant);
    default:
      return '';
  }
}

/* ================================================================== *
 * Hero
 * ================================================================== */
export function renderHero(variant: HeroVariant, ctx: BlockCtx): string {
  const c = ctx.content;
  const backdrop = ctx.backdrops[0];
  const art = backdrop
    ? `<figure class="hero-art" aria-hidden="true"><img src="${esc(backdrop.file)}" alt="" width="256" height="256" loading="eager" decoding="async"></figure>`
    : '';
  const ctas = `          <p class="cluster">
            <a class="btn" href="#${ctx.blueprint.sections[0]?.module ?? 'contact'}">See the work</a>
            <a class="btn btn--ghost" href="#contact">${esc(c.cta)}</a>
          </p>`;

  const head = (extraClass = '') =>
    `          <p class="eyebrow">${esc(c.eyebrow)}</p>
          <h1 class="display ${extraClass}">${emphasize(c.tagline)}</h1>
          <p class="lede">${esc(c.lede)}</p>`;

  switch (variant) {
    case 'split':
      return `  <section class="sec sec--shaped hero hero--split" id="top">
    ${art}
    <div class="wrap"><div class="split">
      <div class="split__lead">${head()}${ctas}</div>
      <aside class="split__panel" aria-label="At a glance">
        <p class="mono">At a glance</p>
        <dl class="spec">${c.aboutFacts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>
      </aside>
    </div></div>
  </section>`;

    case 'compact':
      return `  <section class="sec sec--tight hero hero--compact" id="top">
    ${art}
    <div class="wrap"><div class="hero-compact">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="hero-compact__title">${emphasize(c.tagline)}</h1>
      <div class="hero-compact__side"><p class="lede">${esc(c.lede)}</p><a class="btn" href="#contact">${esc(c.cta)}</a></div>
    </div></div>
  </section>`;

    case 'panel':
      return `  <section class="sec hero hero--panel" id="top">
    ${art}
    <div class="wrap"><div class="hero-panel">
      <div class="hero-panel__body">${head()}${ctas}</div>
      <dl class="spec spec--stack">${c.aboutFacts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>
    </div></div>
  </section>`;

    case 'media':
      return `  <section class="sec hero hero--media" id="top">
    <div class="wrap hero-media">
      ${plate(ctx.plateAssets, 0, 'hero-media__plate')}
      <div class="hero-media__caption">
        <p class="eyebrow">${esc(c.eyebrow)}</p>
        <h1 class="hero-media__title">${emphasize(c.tagline)}</h1>
      </div>
    </div>
  </section>`;

    case 'index':
      // The backdrop must be used here too: generating art the layout discards
      // was a real defect in the previous model.
      return `  <section class="sec sec--tight hero hero--index" id="top">
    ${art}
    <div class="wrap">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="hero-index__title">${emphasize(c.tagline)}</h1>
      <ol class="hero-index">${c.items
        .slice(0, 6)
        .map((it, i) => `<li><span class="mono">${String(i + 1).padStart(2, '0')}</span> ${esc(it.name)}</li>`)
        .join('')}</ol>
    </div>
  </section>`;

    case 'dateline':
      return `  <section class="sec hero hero--dateline" id="top">
    ${art}
    <div class="wrap">
      <ul class="dateline">${c.aboutFacts
        .slice(0, 3)
        .map((f) => `<li><span class="mono">${esc(f.label)}</span> <b>${esc(f.value)}</b></li>`)
        .join('')}</ul>
      <h1 class="display hero-dateline__title">${emphasize(c.tagline)}</h1>
      <p class="lede">${esc(c.lede)}</p>${ctas}
    </div>
  </section>`;

    default:
      return `  <section class="sec sec--shaped hero hero--display" id="top">
    ${art}
    <div class="wrap">${head()}${ctas}
          <p class="anchored">Fig. 01 — ${esc(ctx.emotion)} · ${esc(ctx.paletteId)} · ${esc(ctx.typeId)}</p>
    </div>
  </section>`;
  }
}

/* ================================================================== *
 * Navigation
 * ================================================================== */
export function renderNav(variant: NavVariant, blueprint: Blueprint, ctx: BlockCtx): string {
  if (variant === 'none') return '';
  const c = ctx.content;
  const anchors = ['top', ...blueprint.sections.map((x) => x.module)];
  const labels: Record<string, string> = {
    top: 'Home', items: 'Work', features: 'Capabilities', stats: 'Numbers', about: 'About',
    process: 'Process', quote: 'Words', gallery: 'Gallery', schedule: 'Programme',
    pricing: 'Prices', faq: 'Questions', contact: 'Contact',
  };
  const links = anchors
    .slice(1, 6)
    .map((a, i) => `<li><a href="#${a}">${esc(c.nav[i + 1] ?? labels[a] ?? a)}</a></li>`)
    .join('');

  if (variant === 'minimal') {
    return `  <header class="site-head site-head--minimal"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
    </nav></div></header>`;
  }
  if (variant === 'inline-links') {
    return `  <header class="site-head site-head--inline"><div class="wrap"><nav aria-label="Primary">
      <ul class="nav-list">${links}<li><a href="#contact" class="btn btn--sm">${esc(c.cta)}</a></li></ul>
    </nav></div></header>`;
  }
  if (variant === 'stacked') {
    return `  <header class="site-head site-head--stacked"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
      <ul class="nav-list">${links}</ul>
    </nav></div></header>`;
  }

  const cta =
    variant === 'bar-cta'
      ? `<a class="btn btn--sm" href="#contact">${esc(c.cta)}</a>`
      : `<button class="btn btn--ghost anchor-host" popovertarget="provenance">Provenance</button>`;

  return `  <header class="site-head"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
      <ul class="nav-list">${links}</ul>
      ${cta}
  </nav></div></header>`;
}

/* ================================================================== *
 * Footer
 * ================================================================== */
export function renderFooter(variant: FooterVariant, ctx: BlockCtx): string {
  const c = ctx.content;
  const year = '<span data-year></span>';
  const social = '';

  switch (variant) {
    case 'minimal':
      return `  <footer class="footer footer--minimal"><div class="wrap">
      <p class="eyebrow">${esc(c.brand)} · <a class="link-u" href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a> · © ${year}</p>
  </div></footer>`;

    case 'columns':
      return `  <footer class="footer footer--columns"><div class="wrap">
      <div class="grid footer__cols">
        <div class="col-4"><p class="eyebrow">${esc(c.brand)}</p><p>${esc(c.footerNote)}</p></div>
        <div class="col-4"><p class="eyebrow">Contact</p><p>${esc(c.contact.email)}<br>${esc(c.contact.phone)}<br>${esc(c.contact.address)}</p></div>
        <div class="col-4"><p class="eyebrow">©</p><p>${year}</p></div>
      </div>
  </div></footer>`;

    case 'cta-band':
      return `  <footer class="footer footer--cta"><div class="wrap">
      <h2 class="footer__cta">${emphasize(c.sections.contact.title)}</h2>
      <p class="cluster"><a class="btn" href="mailto:${esc(c.contact.email)}">${esc(c.cta)}</a><span class="tag">${esc(c.contact.email)}</span></p>
  </div></footer>`;

    case 'ledger':
      return `  <footer class="footer footer--ledger"><div class="wrap">
      <dl class="spec spec--inline">
        <dt>Email</dt><dd><a class="link-u" href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a></dd>
        <dt>Phone</dt><dd>${esc(c.contact.phone)}</dd>
        <dt>Address</dt><dd>${esc(c.contact.address)}</dd>
        <dt>©</dt><dd>${year}</dd>
      </dl>
  </div></footer>`;

    case 'colophon':
      return `  <footer class="footer footer--colophon"><div class="wrap">
      <span class="rule" data-reveal="line"></span>
      <p class="colophon">${esc(c.brand)} — ${esc(c.footerNote)}</p>
      <p class="mono">${esc(c.contact.address)} · ${esc(c.contact.email)}</p>
  </div></footer>`;

    default:
      return `  <footer class="footer footer--masthead"><div class="wrap">
      <p class="eyebrow">${esc(c.brand)} — ${esc(c.contact.address)}</p>
      <p class="masthead" aria-hidden="true">${esc(c.brand)}</p>
      <p class="eyebrow">${esc(c.footerNote)} · © ${year}</p>
  </div></footer>`;
  }
}

/** Section heading, used by the assembled page. */
export function sectionHead(
  title: string,
  eyebrow: string,
  note: string,
  anchor: string,
): string {
  return `        <div class="hgroup">
          <p class="eyebrow">${esc(eyebrow)}</p>
          <h2 id="${anchor}-title">${emphasize(title)}</h2>
${note ? `          <p class="note">${esc(note)}</p>\n` : ''}        </div>`;
}
