/**
 * TurboSlop — renderer.
 *
 * Pure function of the spec:
 *   - structure comes from the chosen COMPOSITION
 *   - surface comes from the chosen EFFECT KIT
 *   - every visual value comes from the catalog entry Jev selected
 *   - every word comes from `spec.content`
 *
 * Nothing about any particular brand is baked in, and no two axes collapse into
 * each other: two designs can share a palette and a typeface and still differ in
 * structure AND surface.
 */
import { atmosphereFor, EFFECTS_BY_ID, LAYOUT_BY_ID, MOTION_BY_ID, PALETTE_BY_ID, TYPE_BY_ID } from './catalog.js';
import type { DensityId } from './catalog.js';
import { renderComposition, escapeHtml as esc } from './compositions.js';
import { stripEmphasis } from './content.js';
import { buildStylesheet } from './layout.js';
import type { DesignSpec } from './types.js';

/** Fallback nav labels when the writer supplies fewer than the anchors need. */
const ANCHOR_LABEL: Record<string, string> = {
  items: 'Work',
  features: 'Capabilities',
  stats: 'Numbers',
  about: 'About',
  contact: 'Contact',
};

export function renderHtml(spec: DesignSpec): string {
  const palette = PALETTE_BY_ID[spec.tokens.palette ?? ''];
  const type = TYPE_BY_ID[spec.tokens.typography ?? ''];
  const layout = LAYOUT_BY_ID[spec.tokens.layout ?? ''];
  const motion = MOTION_BY_ID[spec.tokens.motion ?? ''];
  const emotion = spec.tokens.emotion ?? 'other';
  const density = (spec.tokens.density ?? 'balanced') as DensityId;
  const effects = spec.tokens.effects ?? 'flat-plain';
  const composition = spec.tokens.composition ?? 'classic-stack';

  if (!palette || !type || !layout || !motion) {
    throw new Error(
      `Render failed: spec references catalog ids that do not exist (${JSON.stringify(spec.tokens)})`,
    );
  }
  if (!spec.content) {
    throw new Error('Render failed: spec has no content (the writer or fallback must supply it)');
  }

  const c = spec.content;
  const css = buildStylesheet({ emotion, palette, type, layout, motion, density, effects });
  const atm = atmosphereFor(emotion);

  const assets = spec.assets ?? [];
  const backdrops = assets.filter((a) => a.kind === 'backdrop');
  const plateAssets = assets.filter((a) => a.kind !== 'backdrop');

  const { html: mainHtml, anchors } = renderComposition(composition, {
    content: c,
    emotion,
    paletteId: palette.id,
    typeId: type.id,
    plateAssets,
    backdrops,
  });

  const nav = anchors.map((anchor, i) => ({
    anchor,
    label: c.nav[i] ?? ANCHOR_LABEL[anchor] ?? anchor,
  }));

  const fontHref =
    'https://fonts.googleapis.com/css2?' +
    type.googleFonts.map((f) => `family=${f}`).join('&') +
    '&display=swap';

  const decisionList = spec.decisions
    .map(
      (d) =>
        `<dt>${esc(d.axis)}</dt><dd>${esc(d.picked)} <small>(conf ${d.confidence.toFixed(2)}${
          d.review ? ', review' : ''
        })</small></dd>`,
    )
    .join('\n        ');

  const effectsLabel = EFFECTS_BY_ID[effects]?.label ?? effects;

  return `<!DOCTYPE html>
<html lang="en" data-emotion="${esc(emotion)}" data-composition="${esc(
    composition,
  )}" data-effects="${esc(effects)}" data-palette="${esc(palette.id)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(stripEmphasis(c.title))}</title>
<meta name="description" content="${esc(c.description)}">
<meta name="generator" content="TurboSlop (decider: ${esc(spec.meta.decider)}, ${esc(
    spec.meta.model,
  )}; writer: ${esc(spec.meta.writer)}/${esc(spec.meta.writerModel)})">
<meta name="theme-color" content="${esc(palette.bg)}">
<meta name="forge-emotion" content="${esc(emotion)}">
<meta name="forge-composition" content="${esc(composition)}">
<meta name="forge-effects" content="${esc(effects)}">
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
      <a href="#top" class="brand">${esc(c.brand)}</a>
      <ul class="nav-list">
${nav.map((n) => `        <li><a href="#${n.anchor}">${esc(n.label)}</a></li>`).join('\n')}
      </ul>
      <button class="btn btn--ghost anchor-host" popovertarget="brief-pop">How this was built</button>
    </nav>
  </div>
</header>

<div id="brief-pop" class="pop" popover>
  <h2>How this page was built</h2>
  <p>A brief was answered by <strong>${esc(
    spec.meta.decider === 'live' ? 'Jev' : 'the local stand-in decider',
  )}</strong>
  (${esc(spec.meta.model)}) in ${spec.meta.latencyMs} ms, producing typed decisions with calibrated
  probabilities. ${
    spec.meta.writer === 'llm'
      ? `The content was written by <strong>${esc(spec.meta.writerModel)}</strong>.`
      : 'No writer was configured, so this is specimen content.'
  }
  Code composed this page from those decisions — the model never wrote markup.</p>
  <dl class="spec">
        ${decisionList}
      <dt>composition</dt><dd>${esc(composition)}</dd>
      <dt>effects</dt><dd>${esc(effectsLabel)}</dd>
  </dl>
</div>

<main id="top">
${mainHtml}
</main>

<footer class="sec">
  <div class="wrap">
    <p class="eyebrow">${esc(c.brand)} — ${esc(c.contact.address)}</p>
    <p><a class="link-u" href="tel:${esc(c.contact.phone.replace(/[^\d+]/g, ''))}">${esc(
      c.contact.phone,
    )}</a></p>
    <p class="masthead" aria-hidden="true">${esc(c.brand)}</p>
    <p class="eyebrow">${esc(c.footerNote)} · generated by TurboSlop · decisions by ${esc(
      spec.meta.decider === 'live' ? 'Jev' : 'local',
    )} · composite ${spec.composite.normalized.toFixed(2)}</p>
  </div>
</footer>

</body>
</html>`;
}
