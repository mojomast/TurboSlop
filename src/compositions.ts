/**
 * TurboSlop — compositions.
 *
 * The other axes decide how a page *looks*. This module decides how it is
 * **built**: which sections exist, in what order, and what shape each one takes.
 *
 * Without this, every output was the same skeleton — hero, rail, grid, stats,
 * about, contact — wearing different colours, which is the most visible kind of
 * sameness a design tool can produce.
 *
 * Each composition returns its `<main>` content plus the anchor ids it actually
 * emitted, so the navigation is built from what exists rather than from an
 * assumption.
 */
import { emphasize, stripEmphasis, type Content, type Item } from './content.js';
import type { Asset } from './types.js';

export interface CompositionCtx {
  content: Content;
  emotion: string;
  paletteId: string;
  typeId: string;
  plateAssets: Asset[];
  backdrops: Asset[];
}

export interface CompositionResult {
  html: string;
  anchors: string[];
}

/* ================================================================== *
 * Shared builders
 * ================================================================== */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function head(
  s: { eyebrow: string; title: string; note: string },
  id: string,
  opts: { level?: 'h2'; inlineNote?: boolean } = {},
): string {
  const note = s.note ? `\n          <p class="note">${esc(s.note)}</p>` : '';
  if (opts.inlineNote === false) {
    return `        <div class="hgroup">\n          <p class="eyebrow">${esc(s.eyebrow)}</p>\n          <h2 id="${id}-title">${emphasize(s.title)}</h2>\n        </div>`;
  }
  return `        <div class="hgroup">\n          <p class="eyebrow">${esc(s.eyebrow)}</p>\n          <h2 id="${id}-title">${emphasize(s.title)}</h2>${note}\n        </div>`;
}

function plate(assets: Asset[], i: number, cls = 'plate'): string {
  const a = assets.length ? assets[i % assets.length] : undefined;
  if (!a) return `<div class="${cls}" aria-hidden="true"></div>`;
  return `<div class="${cls}"><img class="plate-img" src="${esc(a.file)}" alt="${esc(
    a.alt,
  )}" width="256" height="256" loading="lazy" decoding="async"></div>`;
}

/* ---- item renderings: the same data, four different shapes ---- */
function itemCard(item: Item, i: number, assets: Asset[]): string {
  return `          <article class="work-card reveal reveal--rise">
            <a href="#contact" aria-label="${esc(item.name)} — enquire about similar work">
              ${plate(assets, i)}
              <p class="eyebrow">${esc(item.meta)}</p>
              <h3>${esc(item.name)}</h3>
              ${item.tags.length ? `<p class="lede">${esc(item.tags.join(' · '))}</p>` : ''}
              <span class="tag">View case</span>
            </a>
          </article>`;
}

function editorialRow(item: Item, i: number): string {
  return `          <li class="erow reveal" data-reveal="fade">
            <span class="erow__idx">${String(i + 1).padStart(2, '0')}</span>
            <span class="erow__name">${esc(item.name)}</span>
            <span class="erow__meta">${esc(item.meta)}</span>
            <span class="erow__tags">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</span>
          </li>`;
}

function specRow(item: Item, i: number): string {
  return `            <tr>
              <td class="mono">${String(i + 1).padStart(2, '0')}</td>
              <th scope="row">${esc(item.name)}</th>
              <td>${esc(item.meta)}</td>
              <td class="mono">${esc(item.tags.join(', ') || '—')}</td>
            </tr>`;
}

function galleryTile(item: Item, i: number, assets: Asset[], span: number): string {
  return `          <article class="tile reveal reveal--scale" style="--span:${span}">
            <a href="#contact" aria-label="${esc(item.name)} — enquire">
              ${plate(assets, i, 'tile__plate')}
              <span class="tile__meta"><b>${esc(item.name)}</b> <span class="mono">${esc(item.meta)}</span></span>
            </a>
          </article>`;
}

/* ---- feature renderings ---- */
function featureCard(f: { name: string; detail: string }): string {
  return `            <div class="card">
              <h3>${esc(f.name)}</h3>
              <p>${esc(f.detail)}</p>
            </div>`;
}

function featureRow(f: { name: string; detail: string }, i: number): string {
  return `          <li class="frow reveal" data-reveal="fade">
            <span class="mono frow__idx">${String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>${esc(f.name)}</h3>
              <p>${esc(f.detail)}</p>
            </div>
          </li>`;
}

function featureDef(f: { name: string; detail: string }): string {
  return `            <dt>${esc(f.name)}</dt>\n            <dd>${esc(f.detail)}</dd>`;
}

/* ---- stats ---- */
function statCell(s: { value: string; label: string; note: string }, opts: { tile?: boolean } = {}): string {
  return `            <div class="${opts.tile ? 'stat stat--tile' : 'stat'}">
              <b>${esc(s.value)}</b>
              <span>${esc(s.label)}</span>
              ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
            </div>`;
}

function statsRow(stats: Content['stats']): string {
  return `          <div class="stats">\n${stats.map((s) => statCell(s)).join('\n')}\n          </div>`;
}

/* ---- shared blocks ---- */
function aboutBlock(c: Content): string {
  return `          <div class="grid">
            <div class="about-rail">
              <dl class="spec">
${c.aboutFacts.map((f) => `                <dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('\n')}
              </dl>
            </div>
            <div class="about-text">
              ${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n              ')}
            </div>
          </div>`;
}

function contactBlock(c: Content): string {
  return `          <p class="display"><a class="link-u" href="mailto:${esc(c.contact.email)}">${esc(
    c.contact.email,
  )}</a></p>
          <p class="cluster" style="margin-block-start: var(--s-4)">
            <span class="tag">${esc(c.contact.address)}</span>
            <a class="tag" href="tel:${esc(c.contact.phone.replace(/[^\d+]/g, ''))}">${esc(c.contact.phone)}</a>
          </p>
          <form class="grid contact-form" style="margin-block-start: var(--s-8)" onsubmit="return false">
            <label class="span-6"><span class="eyebrow">Name</span><input class="field" name="name" autocomplete="name" required></label>
            <label class="span-6"><span class="eyebrow">Email</span><input class="field" name="email" type="email" autocomplete="email" required></label>
            <label class="span-full">
              <span class="eyebrow">What do you need?</span>
              <select class="field" name="type">
${c.features.map((f) => `                <option>${esc(f.name)}</option>`).join('\n')}
                <option>Something else</option>
              </select>
            </label>
            <label class="span-full"><span class="eyebrow">Message</span><textarea class="field" name="message" rows="3"></textarea></label>
            <p class="span-full"><button class="btn" type="submit">${esc(c.cta)}</button></p>
          </form>`;
}

function ticker(words: string[]): string {
  if (!words.length) return '';
  const body = words
    .map((w) => `<span class="ticker__item">${esc(w)}</span><span class="ticker__sep" aria-hidden="true">✳</span>`)
    .join('');
  return `      <section class="ticker" aria-hidden="true"><div class="ticker__track">${body}${body}</div></section>`;
}

function quote(q: Content['pullQuote']): string {
  if (!q) return '';
  return `        <figure class="quote reveal" data-reveal="fade">
          <blockquote>${esc(q.text)}</blockquote>
          ${q.attribution ? `<figcaption class="mono">${esc(q.attribution)}</figcaption>` : ''}
        </figure>`;
}

function processList(steps: Content['process']): string {
  if (!steps.length) return '';
  return `          <ol class="steps">
${steps
  .map(
    (s, i) => `            <li class="reveal" data-reveal="fade">
              <span class="mono">${String(i + 1).padStart(2, '0')}</span>
              <h3>${esc(s.name)}</h3>
              <p>${esc(s.detail)}</p>
            </li>`,
  )
  .join('\n')}
          </ol>`;
}

/* ================================================================== *
 * Compositions
 * ================================================================== */
type Builder = (ctx: CompositionCtx) => CompositionResult;

/** Every composition in one object so the renderer can dispatch by id. */
export const COMPOSITION_BUILDERS: Record<string, Builder> = {
  /* ---------------------------------------------------------------- */
  'classic-stack': (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'features', 'stats', 'about', 'contact'],
      html: `  <section class="sec sec--shaped" id="top-hero">
    ${heroArt(ctx)}
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">${esc(c.eyebrow)}</p>
        <h1 class="display">${emphasize(c.tagline)}</h1>
        <p class="lede">${esc(c.lede)}</p>
        <p class="cluster">
          <a class="btn" href="#items">See selected work</a>
          <a class="btn btn--ghost" href="#contact">${esc(c.cta)}</a>
        </p>
        <p class="anchored">Fig. 01 — ${esc(ctx.emotion)} · ${esc(ctx.paletteId)} · ${esc(ctx.typeId)}</p>
      </div>
    </div>
  </section>
${ticker(c.ticker)}
  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <div class="rail stagger" role="region" aria-label="${esc(stripEmphasis(c.sections.items.title))}, scrollable">
${c.items.map((it, i) => itemCard(it, i, ctx.plateAssets)).join('\n')}
      </div>
    </div>
  </section>

  <section class="sec" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <div class="grid numbered">
${c.features.map((f) => featureCard(f)).join('\n')}
      </div>
    </div>
  </section>

  <section class="sec" id="stats" aria-labelledby="stats-title">
    <div class="wrap">
${statsRow(c.stats)}
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
${head(c.sections.about, 'about')}
${aboutBlock(c)}
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  'split-hero': (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'features', 'stats', 'contact'],
      html: `  <section class="sec sec--shaped split-hero" id="top-hero">
    ${heroArt(ctx)}
    <div class="wrap">
      <div class="split">
        <div class="split__lead">
          <p class="eyebrow">${esc(c.eyebrow)}</p>
          <h1 class="display">${emphasize(c.tagline)}</h1>
          <p class="lede">${esc(c.lede)}</p>
          <p class="cluster">
            <a class="btn" href="#items">See selected work</a>
            <a class="btn btn--ghost" href="#contact">${esc(c.cta)}</a>
          </p>
        </div>
        <aside class="split__panel" aria-label="At a glance">
          <p class="mono">At a glance</p>
          <dl class="spec">
${c.aboutFacts.map((f) => `            <dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('\n')}
          </dl>
          <div class="split__stats">
${c.stats.slice(0, 2).map((s) => statCell(s)).join('\n')}
          </div>
        </aside>
      </div>
    </div>
  </section>
${ticker(c.ticker)}
  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <div class="zigzag">
${c.items
  .map(
    (it, i) => `        <article class="zig reveal" data-reveal="${i % 2 === 0 ? 'left' : 'right'}">
          <div class="zig__text">
            <p class="eyebrow">${esc(it.meta)}</p>
            <h3>${esc(it.name)}</h3>
            ${it.tags.length ? `<p class="lede">${esc(it.tags.join(' · '))}</p>` : ''}
            <a class="link-u" href="#contact">Enquire</a>
          </div>
          <div class="zig__art">${plate(ctx.plateAssets, i, 'plate')}</div>
        </article>`,
  )
  .join('\n')}
      </div>
    </div>
  </section>

  <section class="sec" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <ul class="frows">
${c.features.map((f, i) => featureRow(f, i)).join('\n')}
      </ul>
    </div>
  </section>

  <section class="sec" id="stats" aria-labelledby="stats-title">
    <div class="wrap">
${statsRow(c.stats)}
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
      <div class="split">
        <div>${contactBlock(c)}</div>
        <aside class="split__panel">
          <p class="mono">${esc(c.sections.about.eyebrow)}</p>
          ${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n          ')}
        </aside>
      </div>
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  'editorial-lede': (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'features', 'about', 'contact'],
      html: `  <section class="sec sec--shaped editorial-open" id="top-hero">
    <div class="wrap">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="display editorial-open__h">${emphasize(c.tagline)}</h1>
      <div class="editorial-open__foot">
        <p class="lede">${esc(c.lede)}</p>
        <p class="cluster">
          <a class="btn btn--ghost" href="#contact">${esc(c.cta)}</a>
        </p>
      </div>
      <span class="rule rule--accent" data-reveal="line"></span>
    </div>
  </section>

  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <ol class="editorial-list">
${c.items.map((it, i) => editorialRow(it, i)).join('\n')}
      </ol>
    </div>
  </section>

  <section class="sec sec--raised" aria-label="Pull quote">
    <div class="wrap">
${quote(c.pullQuote)}
    </div>
  </section>

  <section class="sec" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <ul class="frows frows--numbered">
${c.features.map((f, i) => featureRow(f, i)).join('\n')}
      </ul>
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
${head(c.sections.about, 'about')}
      <div class="columns">
${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n')}
      </div>
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  'bento-grid': (ctx) => {
    const c = ctx.content;
    const spans = [6, 3, 3, 4, 4, 4, 6, 6];
    return {
      anchors: ['items', 'features', 'contact'],
      html: `  <section class="sec sec--shaped bento-open" id="top-hero">
    ${heroArt(ctx)}
    <div class="wrap">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="display bento-open__h">${emphasize(c.tagline)}</h1>
      <p class="lede">${esc(c.lede)}</p>
    </div>
  </section>

  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <div class="bento">
${c.items
  .map((it, i) => {
    const span = spans[i % spans.length]!;
    return `        <article class="tile reveal reveal--scale" style="--span:${span}">
          <a href="#contact" aria-label="${esc(it.name)} — enquire">
            ${plate(ctx.plateAssets, i, 'tile__plate')}
            <span class="tile__meta"><b>${esc(it.name)}</b> <span class="mono">${esc(it.meta)}</span></span>
          </a>
        </article>`;
  })
  .join('\n')}
${c.stats.map((s) => `        <div class="tile tile--stat" style="--span:3">${statCell(s, { tile: true })}</div>`).join('\n')}
${c.pullQuote ? `        <figure class="tile tile--quote" style="--span:6">${quote(c.pullQuote)}</figure>` : ''}
      </div>
    </div>
  </section>

  <section class="sec" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <div class="grid numbered">
${c.features.map((f) => featureCard(f)).join('\n')}
      </div>
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  'gallery-first': (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'features', 'about', 'contact'],
      html: `  <section class="sec sec--tight masthead" id="top-hero">
    <div class="wrap">
      <div class="masthead__row">
        <h1 class="masthead__title">${emphasize(c.tagline)}</h1>
        <div class="masthead__side">
          <p class="lede">${esc(c.lede)}</p>
          <a class="btn" href="#contact">${esc(c.cta)}</a>
        </div>
      </div>
    </div>
  </section>
${ticker(c.ticker)}
  <section class="sec sec--flush-top" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
    </div>
    <div class="gallery">
${c.items.map((it, i) => galleryTile(it, i, ctx.plateAssets, i % 5 === 0 ? 8 : 4)).join('\n')}
    </div>
  </section>

  <section class="sec sec--raised" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <ul class="frows">
${c.features.map((f, i) => featureRow(f, i)).join('\n')}
      </ul>
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
${head(c.sections.about, 'about')}
      <div class="columns">
${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n')}
      </div>
      <dl class="spec spec--inline">
${c.aboutFacts.map((f) => `        <dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('\n')}
      </dl>
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  'data-first': (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'features', 'about', 'contact'],
      html: `  <section class="sec sec--shaped data-open" id="top-hero">
    <div class="wrap">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="display data-open__h">${emphasize(c.tagline)}</h1>
      <p class="lede">${esc(c.lede)}</p>
    </div>
    <div class="wrap">
${statsRow(c.stats)}
    </div>
  </section>

  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <div class="table-wrap">
        <table class="spectable">
          <caption class="visually-hidden">${esc(stripEmphasis(c.sections.items.title))}</caption>
          <thead>
            <tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Detail</th><th scope="col">Tags</th></tr>
          </thead>
          <tbody>
${c.items.map((it, i) => specRow(it, i)).join('\n')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="sec" id="features" aria-labelledby="features-title">
    <div class="wrap">
${head(c.sections.features, 'features')}
      <dl class="deflist">
${c.features.map((f) => featureDef(f)).join('\n')}
      </dl>
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
${head(c.sections.about, 'about')}
${aboutBlock(c)}
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },

  /* ---------------------------------------------------------------- */
  manifesto: (ctx) => {
    const c = ctx.content;
    return {
      anchors: ['items', 'about', 'contact'],
      html: `  <section class="sec sec--shaped manifesto-open" id="top-hero">
    <div class="wrap">
      <p class="eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="display manifesto-open__h">${emphasize(c.tagline)}</h1>
      <p class="lede manifesto-open__lede">${esc(c.lede)}</p>
      <span class="rule rule--accent" data-reveal="line"></span>
    </div>
  </section>

  <section class="sec" aria-labelledby="points-title">
    <div class="wrap">
${head(c.sections.features, 'features', { inlineNote: false })}
${processList(c.process)}
    </div>
  </section>

  <section class="sec sec--raised" aria-label="Pull quote">
    <div class="wrap">
${quote(c.pullQuote)}
    </div>
  </section>

  <section class="sec" id="items" aria-labelledby="items-title">
    <div class="wrap">
${head(c.sections.items, 'items')}
      <ol class="editorial-list editorial-list--bare">
${c.items.map((it, i) => editorialRow(it, i)).join('\n')}
      </ol>
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
${head(c.sections.about, 'about')}
      <div class="columns columns--wide">
${c.aboutBody.map((p) => `<p>${esc(p)}</p>`).join('\n')}
      </div>
      <ul class="frows frows--numbered">
${c.features.map((f, i) => featureRow(f, i)).join('\n')}
      </ul>
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
${head(c.sections.contact, 'contact')}
${contactBlock(c)}
    </div>
  </section>`,
    };
  },
};

/** Hero artwork, when the image service produced a backdrop. */
function heroArt(ctx: CompositionCtx): string {
  const b = ctx.backdrops[0];
  if (!b) return '';
  return `<figure class="hero-art" aria-hidden="true"><img src="${esc(b.file)}" alt="" width="256" height="256" loading="eager" decoding="async"></figure>`;
}

export const COMPOSITION_IDS = Object.keys(COMPOSITION_BUILDERS);

export function renderComposition(id: string, ctx: CompositionCtx): CompositionResult {
  const build = COMPOSITION_BUILDERS[id] ?? COMPOSITION_BUILDERS['classic-stack']!;
  return build(ctx);
}

export { esc as escapeHtml };
