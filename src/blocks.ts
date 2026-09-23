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
import { renderFrame } from './frames.js';
import { resolveIconRole, renderIcon, type IconRole } from './icons.js';
import type { Asset } from './types.js';
import type { HeroVariant, ModuleId, NavVariant, FooterVariant, Blueprint } from './blueprint.js';
import type { VisualBlueprint } from './visual.js';

export interface BlockCtx {
  content: Content;
  emotion: string;
  paletteId: string;
  typeId: string;
  plateAssets: Asset[];
  backdrops: Asset[];
  blueprint: Blueprint;
  /** How this direction is drawn. Optional so blocks stay usable in isolation. */
  visual?: VisualBlueprint;
  /** Slots that hold an ENLARGED asset, to be drawn as atmosphere not as a photo. */
  textureSlots?: Set<string>;
}

/**
 * An icon for one meaning, drawn in the page's own family.
 *
 * The block asks for a ROLE ("the email route"), never a glyph: the visual
 * blueprint already chose one family and one glyph per role, so the same block
 * renders either vocabulary without knowing which is on the page. Icons are
 * meaning, not decoration: when the role has no glyph in the allowlist we draw
 * nothing rather than reaching for another family.
 */
function icon(ctx: BlockCtx, role: IconRole): string {
  const vb = ctx.visual;
  if (!vb) return '';
  const name = resolveIconRole(vb.iconFamily, role, vb.icons);
  if (!name) return '';
  return renderIcon(name, vb.iconFamily);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const empty = (what: string) =>
  `        <p class="note">No ${what} supplied for this brief.</p>`;

/**
 * The contact details a brief actually supplied.
 *
 * `any` is the only thing callers should branch on: a page either has a real
 * way to make contact or it says so. Nothing here invents a value.
 */
function contactOf(c: Content) {
  const k = c.contact ?? {};
  return {
    email: k.email,
    phone: k.phone,
    address: k.address,
    url: k.url,
    handle: k.handle,
    note: k.note,
    any: Boolean(k.email || k.phone || k.address || k.url || k.handle),
  };
}

/** A `tel:` href from a loosely-formatted phone number. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * An image plate for a named slot.
 *
 * Resolution is by SLOT ID, not by cycling an array: the picture generated for
 * "the third catalogue tile" goes in the third catalogue tile. When the slot has
 * no asset the CSS gradient plate stands in, so a page never breaks and never
 * shows a picture that belongs somewhere else.
 *
 * `data-slot` marks the place: `verifyAssetPlacement` uses it to prove each
 * asset landed in ITS slot — finding a URL somewhere in the HTML is not
 * evidence that it is in the right position.
 *
 * `width`/`height` are the asset's real pixel size, so an enlargement is visible
 * in the markup rather than hidden, and `data-texture` marks the slots where a
 * 256px asset is deliberately scaled and must be drawn as atmosphere.
 */
function plate(ctx: BlockCtx, i: number, cls = 'plate', slotId?: string): string {
  /* Strict resolution once ANY asset carries a slot: a named place gets its own
     picture or a gradient, never a neighbour's. Cycling is kept only for legacy
     specs whose assets have no slot recorded at all. */
  const hasSlots = ctx.plateAssets.some((a) => a.slot);
  const bySlot = slotId ? ctx.plateAssets.find((a) => a.slot === slotId) : undefined;
  const a =
    bySlot ??
    (hasSlots ? undefined : ctx.plateAssets.length ? ctx.plateAssets[i % ctx.plateAssets.length] : undefined);
  const slotAttr = slotId ? ` data-slot="${esc(slotId)}"` : '';
  if (!a) return `<div class="${cls}"${slotAttr} aria-hidden="true"></div>`;
  const texture = a.slot && ctx.textureSlots?.has(a.slot) ? ' data-texture="1"' : '';
  return `<div class="${cls}"${slotAttr}${texture}><img class="plate-img" src="${esc(a.file)}" alt="${esc(
    a.alt,
  )}" width="${a.nativeWidth}" height="${a.nativeHeight}" loading="lazy" decoding="async"></div>`;
}

/**
 * A framed plate for a gallery figure.
 *
 * The frame is chosen by the direction's own visual blueprint (lead → object:
 * packaging for a catalogue, a ticket for an event, a cover for a publication),
 * capped to the first few tiles so a grid does not become a shop of boxes.
 * Nothing is framed when the recipe says `plain`.
 */
function framedPlate(ctx: BlockCtx, slotId: string, ratio: string, nth: number): string {
  const inner = plate(ctx, nth, 'tile__plate', slotId);
  const kind = ctx.visual?.frames?.[0];
  if (!kind || kind === 'plain' || nth > 2 || ctx.textureSlots?.has(slotId)) return inner;
  const framed = renderFrame({
    kind,
    inner,
    label: stripEmphasis(ctx.content.brand).slice(0, 24),
    seed: (ctx.visual?.seed ?? 0) + nth,
    ratio,
  });
  return `<span class="tile__frame" data-frame-for="${esc(slotId)}">${framed.html}</span>`;
}

/* ================================================================== *
 * items — catalogue / portfolio / menu / products
 * ================================================================== */
function itemsRail(items: Item[], ctx: BlockCtx): string {
  return `        <div class="rail stagger" role="region" aria-label="${esc(
    stripEmphasis(ctx.content.sections.items?.title ?? MODULE_LABELS.items),
  )}, scrollable">
${items
  .map(
    (it, i) => `          <article class="work-card reveal reveal--rise">
            <a href="#contact" aria-label="${esc(it.name)} — enquire">
              ${plate(ctx, i, 'plate', `items-${i + 1}`)}
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
              ${plate(ctx, i, 'plate', `items-${i + 1}`)}
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
            <caption class="visually-hidden">${esc(stripEmphasis(ctx.content.sections.items?.title ?? MODULE_LABELS.items))}</caption>
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
              ${plate(ctx, i, 'tile__plate', `items-${i + 1}`)}
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
              ${plate(ctx, i, 'tile__plate', `items-${i + 1}`)}
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

const galleryBlock = (c: Content, ctx: BlockCtx, variant: string) => {
  /* An empty gallery is not a gallery: say so rather than rendering a row of
     empty gradient boxes to fill a slot. */
  if (!c.items.length) return empty('gallery entries');
  return `        <div class="gallery gallery--${variant}">
${c.items
  .slice(0, ctx.blueprint.imageSlots || 4)
  .map(
    (it, i) => `          <figure class="tile" style="--span:${variant === 'strip' ? 3 : i % 4 === 0 ? 6 : 3}">
            ${framedPlate(ctx, `gallery-${i + 1}`, variant === 'strip' ? '4 / 3' : i % 5 === 0 ? '4 / 3' : '1 / 1', i)}
            <figcaption class="mono">${esc(it.name)}</figcaption>
          </figure>`,
  )
  .join('\n')}
        </div>`;
};

const scheduleBlock = (c: Content, variant: string, ctx: BlockCtx): string => {
  /* No programme in the content: say so instead of drawing empty rows. */
  if (!c.items.length) return empty('programme entries');
  const day = (i: number): string => `${icon(ctx, 'schedule-date')}Day ${i + 1}`;
  return (
    variant === 'agenda'
    ? `        <ol class="agenda">
${c.items
  .slice(0, 5)
  .map(
    (it, i) => `          <li class="reveal" data-reveal="fade">
            <span class="mono">${day(i)}</span>
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
            .map((it, i) => `<tr><td class="mono">${day(i)}</td><th scope="row">${esc(it.name)}</th><td>${esc(it.meta)}</td></tr>`)
            .join('')}</tbody>
        </table></div>`
  );
};

const pricingBlock = (c: Content, variant: string, ctx: BlockCtx) => {
  /* A price the brief did not supply is a price this page does not print. */
  if (!c.features.length || !c.stats.length) return empty('pricing');
  const included = `${icon(ctx, 'pricing-included')}`;
  if (variant === 'tiers') {
    return `        <div class="grid tiers">
${c.features
  .slice(0, 3)
  .map(
    (f, i) => `          <div class="tier card${i === 1 ? ' tier--featured' : ''}">
            <h3>${esc(f.name)}</h3>
            <p class="tier__price mono">${esc(c.stats[i]?.value ?? '—')}</p>
            <p>${included}${esc(f.detail)}</p>
          </div>`,
  )
  .join('\n')}
        </div>`;
  }
  return `        <div class="table-wrap"><table class="spectable">
          <thead><tr><th scope="col">Tier</th><th scope="col">Price</th><th scope="col">Includes</th></tr></thead>
          <tbody>${c.features
            .slice(0, 4)
            .map((f, i) => `<tr><th scope="row">${esc(f.name)}</th><td class="mono">${esc(c.stats[i]?.value ?? '—')}</td><td>${included}${esc(f.detail)}</td></tr>`)
            .join('')}</tbody>
        </table></div>`;
};

const faqBlock = (c: Content, ctx: BlockCtx): string => {
  if (!c.features.length) return empty('questions');
  return `        <ul class="faq">
${c.features
  .slice(0, 4)
  .map(
    (f, i) => `          <li><details${i === 0 ? ' open' : ''}><summary>${icon(ctx, 'faq-answer')}${esc(f.name)}</summary><p>${esc(f.detail)}</p></details></li>`,
  )
  .join('\n')}
        </ul>`;
};

function contactBlock(c: Content, variant: string, ctx: BlockCtx): string {
  const k = contactOf(c);

  // No details in the brief: say so, rather than manufacturing an address and a
  // phone number so the template looks complete.
  if (!k.any) {
    return `        <p class="note">The brief specified no way to get in touch. Rather than invent an
        address or a phone number to fill this section, the page leaves it out — the
        footer names the brand and nothing more.</p>`;
  }

  const bits: string[] = [];
  if (k.email) {
    bits.push(
      `        <p class="display"><a class="link-u with-icon" href="mailto:${esc(k.email)}">${icon(ctx, 'contact-email')}${esc(k.email)}</a></p>`,
    );
  }
  const tags: string[] = [];
  if (k.phone) tags.push(`          <a class="tag with-icon" href="${esc(telHref(k.phone))}">${icon(ctx, 'contact-phone')}${esc(k.phone)}</a>`);
  if (k.address) tags.push(`          <span class="tag with-icon">${icon(ctx, 'contact-address')}${esc(k.address)}</span>`);
  if (k.handle) tags.push(`          <span class="tag">${esc(k.handle)}</span>`);
  if (k.url) {
    tags.push(
      `          <a class="tag" href="${esc(k.url)}" rel="noopener">${esc(k.url.replace(/^https?:\/\//, ''))}</a>`,
    );
  }
  if (tags.length) {
    bits.push(`        <p class="cluster" style="margin-block-start: var(--s-4)">\n${tags.join('\n')}\n        </p>`);
  }
  if (k.note) bits.push(`        <p class="note">${esc(k.note)}</p>`);
  const details = bits.join('\n');

  /* A form is only rendered when there is somewhere for it to go. `mailto:` is a
     real submission path that needs no server, so the form works offline; the
     page says so plainly instead of showing a dead input that silently fails. */
  const canSubmit = Boolean(k.email);
  const form = canSubmit
    ? `        <form class="grid contact-form" action="mailto:${esc(k.email!)}" method="post" enctype="text/plain" style="margin-block-start: var(--s-8)">
          <label class="span-6"><span class="eyebrow">Name</span><input class="field" name="name" autocomplete="name" required></label>
          <label class="span-6"><span class="eyebrow">Email</span><input class="field" name="email" type="email" autocomplete="email" required></label>
          <label class="span-full"><span class="eyebrow">Message</span><textarea class="field" name="message" rows="3"></textarea></label>
          <p class="span-full"><button class="btn" type="submit">${esc(c.cta)}</button></p>
          <p class="span-full note">Opens your own email client — this page has no server behind it.</p>
        </form>`
    : '';

  if (variant === 'email' || !form) {
    return form ? `${details}\n${form}` : details;
  }
  if (variant === 'split') {
    return `        <div class="split"><div>${details}</div><div>${form}</div></div>`;
  }
  return `${details}\n${form}`;
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
      return scheduleBlock(c, variant, ctx);
    case 'pricing':
      return pricingBlock(c, variant, ctx);
    case 'faq':
      return faqBlock(c, ctx);
    case 'contact':
      return contactBlock(c, variant, ctx);
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
    ? `<figure class="hero-art"${backdrop.slot ? ` data-slot="${esc(backdrop.slot)}"` : ''} aria-hidden="true"><img src="${esc(
        backdrop.file,
      )}" alt="" width="${backdrop.nativeWidth || 256}" height="${backdrop.nativeHeight || 256}" loading="eager" decoding="async"></figure>`
    : '';
  const hasContact = ctx.blueprint.sections.some((s) => s.module === 'contact');
  const first = ctx.blueprint.sections[0]?.module;
  /* CTAs point at anchors that EXIST. A page with no contact section gets no
     dead `#contact` button, and "See the work" only appears when there is
     somewhere to see. */
  const ctaLines = [
    first && first !== 'contact'
      ? `            <a class="btn" href="#${esc(first)}">See the work</a>`
      : '',
    hasContact ? `            <a class="btn btn--ghost" href="#contact">${esc(c.cta)}</a>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const ctas = ctaLines ? `          <p class="cluster">\n${ctaLines}\n          </p>` : '';

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
      <div class="hero-compact__side"><p class="lede">${esc(c.lede)}</p>${
        hasContact ? `<a class="btn" href="#contact">${esc(c.cta)}</a>` : ''
      }</div>
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
      ${plate(ctx, 0, 'hero-media__plate', 'hero')}
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

    /* ---- edge-to-edge typographic poster --------------------------------
       The headline IS the first screen. No image, no panel: the type carries
       the whole opening, which is what makes it read differently from every
       statement-beside-something hero. */
    case 'poster':
      return `  <section class="sec hero hero--poster" id="top">
    <div class="wrap hero-poster">
      <p class="eyebrow hero-poster__label">${esc(c.eyebrow)}</p>
      <h1 class="display hero-poster__title">${emphasize(c.tagline)}</h1>
      <div class="hero-poster__foot">
        <p class="lede">${esc(c.lede)}</p>
        ${ctas}
      </div>
    </div>
  </section>`;

    /* ---- editorial opening: a large figure and a narrow text column ---- */
    case 'editorial-figure': {
      const framed = ctx.visual?.frames?.[0];
      const inner = plate(ctx, 0, 'hero-figure__img', 'hero');
      return `  <section class="sec hero hero--editorial-figure" id="top">
    <div class="wrap hero-figure">
      <div class="hero-figure__plate">${
        framed && framed !== 'plain'
          ? renderFrame({
              kind: framed,
              inner,
              label: stripEmphasis(c.title).slice(0, 48),
              seed: (ctx.visual?.seed ?? 0) + 11,
              ratio: '4 / 5',
            }).html
          : inner
      }</div>
      <div class="hero-figure__col">
        <p class="eyebrow">${esc(c.eyebrow)}</p>
        <h1 class="display hero-figure__title">${emphasize(c.tagline)}</h1>
        <p class="lede">${esc(c.lede)}</p>
        ${ctas}
      </div>
    </div>
  </section>`;
    }

    /* ---- product-led: a framed demonstration beside the statement ---- */
    case 'product-demo': {
      const framed = ctx.visual?.frames?.[0] ?? 'browser';
      const demo = renderFrame({
        kind: framed,
        inner: plate(ctx, 0, 'hero-demo__img', 'hero'),
        label: stripEmphasis(c.brand).toLowerCase().replace(/\s+/g, '') + '.example',
        seed: (ctx.visual?.seed ?? 0) + 7,
        ratio: '16 / 10',
      });
      return `  <section class="sec hero hero--product-demo" id="top">
    <div class="wrap hero-demo">
      <div class="hero-demo__lead">
        <p class="eyebrow">${esc(c.eyebrow)}</p>
        <h1 class="display hero-demo__title">${emphasize(c.tagline)}</h1>
        <p class="lede">${esc(c.lede)}</p>
        ${ctas}
      </div>
      <div class="hero-demo__frame">${demo.html}</div>
    </div>
  </section>`;
    }

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
/** Default link text per module. Used when the writer supplies no exact match. */
export const MODULE_LABELS: Record<ModuleId, string> = {
  items: 'Work',
  features: 'Capabilities',
  stats: 'Numbers',
  about: 'About',
  process: 'Process',
  quote: 'Words',
  gallery: 'Gallery',
  schedule: 'Programme',
  pricing: 'Prices',
  faq: 'Questions',
  contact: 'Contact',
};

export interface NavTarget {
  module: ModuleId;
  /** The rendered instance id — always unique, always resolvable in-page. */
  id: string;
  label: string;
}

/**
 * Navigation.
 *
 * Labels are matched to their TARGET, not to a position in an array. The old
 * code advanced through the writer's label list by a different offset than the
 * anchors it was building, so once a blueprint repeated a module the link text
 * landed on the wrong section.
 */
export function renderNav(
  variant: NavVariant,
  blueprint: Blueprint,
  ctx: BlockCtx,
  targets: NavTarget[],
): string {
  if (variant === 'none') return '';
  const c = ctx.content;
  const links = targets
    .filter((t) => t.module !== 'contact')
    .slice(0, 4)
    .map((t) => `<li><a href="#${esc(t.id)}">${esc(t.label)}</a></li>`)
    .join('');
  const contactTarget = targets.find((t) => t.module === 'contact');

  if (variant === 'minimal') {
    return `  <header class="site-head site-head--minimal"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
    </nav></div></header>`;
  }
  if (variant === 'inline-links') {
    return `  <header class="site-head site-head--inline"><div class="wrap"><nav aria-label="Primary">
      <ul class="nav-list">${links}${
        contactTarget ? `<li><a href="#${esc(contactTarget.id)}" class="btn btn--sm">${esc(c.cta)}</a></li>` : ''
      }</ul>
    </nav></div></header>`;
  }
  if (variant === 'stacked') {
    return `  <header class="site-head site-head--stacked"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
      <ul class="nav-list">${links}${
        contactTarget ? `<li><a href="#${esc(contactTarget.id)}">${esc(contactTarget.label)}</a></li>` : ''
      }</ul>
    </nav></div></header>`;
  }

  /* The plain bar carries no tool chrome: the header belongs to the brief's own
     brand. Decision provenance lives in the spec, the export README and the
     control surface — never in the page a visitor reads. */
  const cta =
    variant === 'bar-cta' && contactTarget
      ? `<a class="btn btn--sm" href="#${esc(contactTarget.id)}">${esc(c.cta)}${icon(ctx, 'nav-cta')}</a>`
      : '';

  return `  <header class="site-head"><div class="wrap"><nav aria-label="Primary">
      <a href="#top" class="brand">${esc(c.brand)}</a>
      <ul class="nav-list">${links}${
        !cta && contactTarget ? `<li><a href="#${esc(contactTarget.id)}">${esc(contactTarget.label)}</a></li>` : ''
      }</ul>
      ${cta}
  </nav></div></header>`;
}

/* ================================================================== *
 * Footer
 * ================================================================== */
export function renderFooter(variant: FooterVariant, ctx: BlockCtx): string {
  const c = ctx.content;
  const k = contactOf(c);
  const year = '<span data-year></span>';
  const emailLink = k.email
    ? `<a class="link-u" href="mailto:${esc(k.email)}">${esc(k.email)}</a>`
    : '';
  const postal = [k.address, k.handle].filter(Boolean).join(' · ');

  switch (variant) {
    case 'minimal':
      return `  <footer class="footer footer--minimal"><div class="wrap">
      <p class="eyebrow">${esc(c.brand)}${emailLink ? ` · ${emailLink}` : ''} · © ${year}</p>
  </div></footer>`;

    case 'columns':
      return `  <footer class="footer footer--columns"><div class="wrap">
      <div class="grid footer__cols">
        <div class="col-4"><p class="eyebrow">${esc(c.brand)}</p><p>${esc(c.footerNote)}</p></div>
        <div class="col-4"><p class="eyebrow">Contact</p><p>${
          k.any
            ? [emailLink || esc(k.email ?? ''), k.phone ? esc(k.phone) : '', k.address ? esc(k.address) : '', k.url ? esc(k.url) : '']
                .filter(Boolean)
                .join('<br>')
            : 'Not specified in the brief'
        }</p></div>
        <div class="col-4"><p class="eyebrow">©</p><p>${year}</p></div>
      </div>
  </div></footer>`;

    case 'cta-band':
      return `  <footer class="footer footer--cta"><div class="wrap">
      <h2 class="footer__cta">${emphasize(c.sections.contact?.title ?? `Work with ${c.brand}`)}</h2>
      <p class="cluster">${
        k.email
          ? `<a class="btn" href="mailto:${esc(k.email)}">${esc(c.cta)}${icon(ctx, 'nav-cta')}</a><span class="tag">${esc(k.email)}</span>`
          : `<span class="tag">No contact details supplied for this brief</span>`
      }</p>
  </div></footer>`;

    case 'ledger': {
      const rows: string[] = [];
      if (k.email) rows.push(`<dt>Email</dt><dd>${emailLink}</dd>`);
      if (k.phone) rows.push(`<dt>Phone</dt><dd><a class="link-u" href="${esc(telHref(k.phone))}">${esc(k.phone)}</a></dd>`);
      if (k.address) rows.push(`<dt>Address</dt><dd>${esc(k.address)}</dd>`);
      if (k.url) rows.push(`<dt>Web</dt><dd><a class="link-u" href="${esc(k.url)}" rel="noopener">${esc(k.url)}</a></dd>`);
      if (k.handle) rows.push(`<dt>Handle</dt><dd>${esc(k.handle)}</dd>`);
      rows.push(`<dt>©</dt><dd>${year}</dd>`);
      return `  <footer class="footer footer--ledger"><div class="wrap">
      <dl class="spec spec--inline">
        ${rows.join('\n        ')}
      </dl>
  </div></footer>`;
    }

    case 'colophon':
      return `  <footer class="footer footer--colophon"><div class="wrap">
      <span class="rule" data-reveal="line"></span>
      <p class="colophon">${esc(c.brand)} — ${esc(c.footerNote)}</p>
      ${postal || k.email ? `<p class="mono">${[postal, k.email].filter((x): x is string => Boolean(x)).map(esc).join(' · ')}</p>` : ''}
  </div></footer>`;

    default:
      return `  <footer class="footer footer--masthead"><div class="wrap">
      <p class="eyebrow">${esc(c.brand)}${postal ? ` — ${esc(postal)}` : ''}</p>
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
