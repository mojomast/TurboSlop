/**
 * turboslop — renderer.
 *
 * Turns a validated `DesignSpec` into a single self-contained HTML document.
 *
 * The renderer never invents a value: every colour, font, duration and radius
 * comes from the catalog entry the spec selected. That is the payoff of
 * bounding the model to "pick a card from the deck" — by the time we get here
 * the design decisions are already made, validated and typed, so rendering is
 * purely mechanical.
 */
import { atmosphereFor, EMOTION_BY_ID, LAYOUT_BY_ID, MOTION_BY_ID, PALETTE_BY_ID, TYPE_BY_ID } from './catalog.js';
import { CANONICAL_COPY } from './copy.js';
import type { DensityId } from './catalog.js';
import { buildStylesheet } from './layout.js';
import type { DesignSpec } from './types.js';

/** Canonical studio content — shared by every generated variation. */
const STUDIO = {
  name: 'ATELIER NULL',
  line: 'We design interfaces that behave like objects.',
  lede: 'From blank canvas to shipped interface — design systems, storefronts and brand work for teams who care how things feel.',
  email: 'studio@ateliern.ull',
  phone: '+351 21 000 0000',
  address: 'Rua da Boavista 84, Lisbon',
};

const PROJECTS = [
  { name: 'HALCYON', sector: 'Fintech dashboard', year: '2025', services: ['Design system', 'Product UI'] },
  { name: 'VESPER', sector: 'Perfume e-commerce', year: '2025', services: ['Art direction', 'Storefront'] },
  { name: 'ORBITAL', sector: 'Satellite imaging SaaS', year: '2024', services: ['Data viz', 'Marketing site'] },
  { name: 'KILN', sector: 'Ceramics marketplace', year: '2024', services: ['Brand', 'Commerce'] },
  { name: 'MERIDIAN', sector: 'Travel journal iOS', year: '2023', services: ['Product design'] },
  { name: 'FERNSIDE', sector: 'Architecture studio', year: '2023', services: ['Editorial site'] },
];

const CAPABILITIES = [
  { name: 'Product Design', detail: 'Interface work from first principles, not from a template.' },
  { name: 'Design Systems', detail: 'Tokens, components and the documentation that keeps them honest.' },
  { name: 'Brand Identity', detail: 'Marks, type systems and the rules that hold them together.' },
  { name: 'Motion & Interaction', detail: 'Movement that explains rather than decorates.' },
  { name: 'Front-end Engineering', detail: 'The last mile, built properly, handed over cleanly.' },
  { name: 'Art Direction', detail: 'Deciding what the work should look like, and defending it.' },
];

const STATS = [
  { value: '48', label: 'Shipped products' },
  { value: '11', label: 'Industry awards' },
  { value: '6.2', label: 'Yr avg. relationship' },
  { value: '94%', label: 'Referral rate' },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * A work-card visual. With generated art we embed the real 256x256 PNG
 * (declared with explicit dimensions so the grid cannot shift while loading);
 * without it we fall back to the CSS gradient plate.
 */
function plateFor(assets: DesignSpec['assets'], index: number): string {
  const asset = assets.length ? assets[index % assets.length] : undefined;
  if (!asset) return `<div class="plate" aria-hidden="true"></div>`;
  return `<div class="plate"><img class="plate-img" src="${esc(asset.file)}" alt="${esc(asset.alt)}" width="256" height="256" loading="lazy" decoding="async"></div>`;
}

export function renderHtml(spec: DesignSpec): string {
  const palette = PALETTE_BY_ID[spec.tokens.palette ?? ''];
  const type = TYPE_BY_ID[spec.tokens.typography ?? ''];
  const layout = LAYOUT_BY_ID[spec.tokens.layout ?? ''];
  const motion = MOTION_BY_ID[spec.tokens.motion ?? ''];
  const emotion = spec.tokens.emotion ?? 'other';
  const density = (spec.tokens.density ?? 'balanced') as DensityId;
  /** Written by the LLM when one is configured; canonical otherwise. */
  const copy = spec.copy ?? CANONICAL_COPY;

  if (!palette || !type || !layout || !motion) {
    throw new Error(
      `Render failed: spec references catalog ids that do not exist (${JSON.stringify(spec.tokens)})`,
    );
  }

  const css = buildStylesheet({ emotion, palette, type, layout, motion, density });
  const atm = atmosphereFor(emotion);

  /* Generated artwork, when the image service was enabled. Illustrative only:
     everything below degrades to the gradient plates when there is none. */
  const assets = spec.assets ?? [];
  const backdrops = assets.filter((a) => a.kind === 'backdrop');
  const plateAssets = assets.filter((a) => a.kind !== 'backdrop');
  const fontHref =
    'https://fonts.googleapis.com/css2?' +
    type.googleFonts.map((f) => `family=${f}`).join('&') +
    '&display=swap';

  const lightGround = palette.bg;

  const projectCards = PROJECTS.map(
    (p, i) => `
        <article class="work-card reveal reveal--rise">
          <a href="#contact" aria-label="${esc(p.name)} — enquire about similar work">
            ${plateFor(plateAssets, i)}
            <p class="eyebrow">${esc(p.sector)} · ${esc(p.year)}</p>
            <h3>${esc(p.name)}</h3>
            <p class="lede">${esc(p.services.join(' · '))}</p>
            <span class="tag">View case</span>
          </a>
        </article>`,
  ).join('');

  const capabilityRows = CAPABILITIES.map(
    (c) => `
          <div class="card">
            <h3>${esc(c.name)}</h3>
            <p>${esc(c.detail)}</p>
          </div>`,
  ).join('');

  const statCells = STATS.map(
    (s) => `
          <div class="stat">
            <b>${esc(s.value)}</b>
            <span>${esc(s.label)}</span>
          </div>`,
  ).join('');

  const swatches = Object.entries({
    '--bg': palette.bg,
    '--bg-raised': palette.bgRaised,
    '--fg': palette.fg,
    '--muted': palette.muted,
    '--accent': palette.accent,
    '--secondary': palette.secondary,
  })
    .map(
      ([token, value]) =>
        `<figure class="sw"><div class="swatch" style="--c:${value}"></div><figcaption><code>${esc(token)}</code><br><small>${esc(value)}</small></figcaption></figure>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en" data-emotion="${esc(emotion)}" data-palette="${esc(palette.id)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(copy.title)}</title>
<meta name="description" content="${esc(copy.description)}">
<meta name="generator" content="turboslop (Jev decider: ${esc(spec.meta.decider)}, model ${esc(spec.meta.model)}; copy: ${esc(spec.meta.copyWriter)}/${esc(spec.meta.copyModel)})">
<meta name="theme-color" content="${esc(lightGround)}">
<meta name="forge-emotion" content="${esc(emotion)}">
<meta name="forge-composite" content="${spec.composite.normalized.toFixed(3)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(fontHref)}">
<style>
${css}
</style>
</head>
<body>

<div class="scroll-progress" aria-hidden="true"></div>
<div class="atmosphere" aria-hidden="true"></div>
${atm.grain > 0 ? '<div class="grain" aria-hidden="true"></div>' : ''}

<header class="site-head">
  <div class="wrap">
    <nav aria-label="Primary">
      <a href="#top" class="brand">${esc(STUDIO.name)}</a>
      <ul class="nav-list">
        <li><a href="#work">Work</a></li>
        <li><a href="#system">System</a></li>
        <li><a href="#capabilities">Capabilities</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
      <button class="btn btn--ghost anchor-host" popovertarget="brief-pop">How this was built</button>
    </nav>
  </div>
</header>

<div id="brief-pop" class="pop" popover>
  <h2>How this page was built</h2>
  <p>A brief was answered by <strong>${esc(spec.meta.decider === 'live' ? 'Jev' : 'the local stand-in decider')}</strong>
  (${esc(spec.meta.model)}) in ${spec.meta.latencyMs} ms, producing typed decisions with calibrated
  probabilities. Code composed this page from those decisions — the model never wrote markup.</p>
  <dl class="spec">
    ${spec.decisions
      .map(
        (d) =>
          `<dt>${esc(d.axis)}</dt><dd>${esc(d.picked)} <small>(conf ${d.confidence.toFixed(2)}${d.review ? ', review' : ''})</small></dd>`,
      )
      .join('\n    ')}
  </dl>
</div>

<main id="top">

  <section class="sec sec--shaped">
    ${backdrops.length ? `<figure class="hero-art" aria-hidden="true"><img src="${esc(backdrops[0]!.file)}" alt="" width="256" height="256" loading="eager" decoding="async"></figure>` : ''}
    <div class="wrap">
      <div class="grid">
        <div class="hgroup" style="grid-column: 1 / -1">
          <p class="eyebrow">Independent design studio — Lisbon, est. 2019</p>
          <h1 class="display">${esc(STUDIO.line.replace('like objects.', 'like'))} <em>objects.</em></h1>
          <p class="lede">${esc(copy.lede)}</p>
          <p class="cluster">
            <a class="btn" href="#work">See selected work</a>
            <a class="btn btn--ghost" href="#contact">${esc(copy.cta)}</a>
          </p>
          <p class="anchored">Fig. 01 — ${esc(emotion)} · ${esc(palette.id)} · ${esc(type.id)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="sec" id="work" aria-labelledby="work-title">
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">Selected work / 2023–2025</p>
        <h2 id="work-title">Six projects, six <em>problems</em> worth solving.</h2>
      </div>
      <p class="note">${esc(copy.note)}</p>
      <div class="rail stagger" role="region" aria-label="Selected work, scrollable">
        ${projectCards}
      </div>
    </div>
  </section>

  <section class="sec" id="system" aria-labelledby="system-title">
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">Design system / generated</p>
        <h2 id="system-title">The tokens this page is <em>made of</em>.</h2>
      </div>
      <div class="grid">
        <div style="grid-column: 1 / -1">
          <div class="sw-grid">${swatches}</div>
        </div>
      </div>
    </div>
  </section>

  <section class="sec" id="capabilities" aria-labelledby="cap-title">
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">Capabilities / six disciplines</p>
        <h2 id="cap-title">Six ways we make ourselves <em>useful</em>.</h2>
      </div>
      <div class="grid numbered">${capabilityRows}
      </div>
    </div>
  </section>

  <section class="sec" id="stats" aria-labelledby="stats-title">
    <div class="wrap">
      <div class="stats">${statCells}
      </div>
    </div>
  </section>

  <section class="sec" id="about" aria-labelledby="about-title">
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">The studio / est. 2019</p>
        <h2 id="about-title">A studio of six, one <em>rule</em>.</h2>
      </div>
      <div class="grid">
        <div style="grid-column: 1 / span 5">
          <dl class="spec">
            <dt>Base</dt><dd>Lisbon &amp; remote</dd>
            <dt>Team</dt><dd>Six people</dd>
            <dt>Founded</dt><dd>2019</dd>
          </dl>
        </div>
        <div style="grid-column: 7 / -1">
          ${copy.about.map((para) => `<p>${esc(para)}</p>`).join('\n          ')}
        </div>
      </div>
    </div>
  </section>

  <section class="sec" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
      <div class="hgroup">
        <p class="eyebrow">Contact / new work</p>
        <h2 id="contact-title">Let's make something that <em>lasts</em>.</h2>
      </div>
      <p class="display"><a href="mailto:${esc(STUDIO.email)}">${esc(STUDIO.email)}</a></p>
      <form class="grid" style="margin-block-start: var(--s-8)" onsubmit="return false">
        <label style="grid-column: 1 / span 6">
          <span class="eyebrow">Name</span>
          <input class="field" name="name" autocomplete="name" required>
        </label>
        <label style="grid-column: 7 / -1">
          <span class="eyebrow">Email</span>
          <input class="field" name="email" type="email" autocomplete="email" required>
        </label>
        <label style="grid-column: 1 / -1">
          <span class="eyebrow">Project type</span>
          <select class="field" name="type">
            <option>Product design</option>
            <option>Design system</option>
            <option>Brand identity</option>
            <option>Motion &amp; interaction</option>
            <option>Front-end engineering</option>
          </select>
        </label>
        <label style="grid-column: 1 / -1">
          <span class="eyebrow">Message</span>
          <textarea class="field" name="message" rows="3"></textarea>
        </label>
        <p style="grid-column: 1 / -1"><button class="btn" type="submit">Send enquiry</button>
        <span class="tag">${esc(STUDIO.address)}</span></p>
      </form>
    </div>
  </section>

</main>

<footer class="sec">
  <div class="wrap">
    <p class="eyebrow">${esc(STUDIO.name)} — Lisbon &amp; remote</p>
    <p><a href="tel:${esc(STUDIO.phone.replace(/\s/g, ''))}">${esc(STUDIO.phone)}</a></p>
    <p class="masthead" aria-hidden="true">${esc(STUDIO.name)}</p>
    <p class="eyebrow">Generated by turboslop · decisions by ${esc(spec.meta.decider === 'live' ? 'Jev' : 'local')} · composite ${spec.composite.normalized.toFixed(2)}</p>
  </div>
</footer>

</body>
</html>`;
}
