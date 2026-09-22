/**
 * TurboSlop — renderer.
 *
 * Assembles a page from its BLUEPRINT: the nav, hero, footer treatments and the
 * ordered subset of section modules the blueprint declares. There is no fixed
 * spine here — the page's structure is data.
 *
 * Every visual value comes from the catalog entries the direction selected, and
 * every word comes from `spec.content`.
 */
import { BLUEPRINT_BY_ID, type Blueprint } from './blueprint.js';
import { renderFooter, renderHero, renderModule, renderNav, sectionHead, type BlockCtx } from './blocks.js';
import { atmosphereFor, EFFECTS_BY_ID, LAYOUT_BY_ID, MOTION_BY_ID, PALETTE_BY_ID, TYPE_BY_ID } from './catalog.js';
import type { DensityId } from './catalog.js';
import { stripEmphasis } from './content.js';
import { buildStylesheet } from './layout.js';
import type { DesignSpec } from './types.js';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const FALLBACK_BLUEPRINT: Blueprint = BLUEPRINT_BY_ID['statement-display']!;

export function renderHtml(spec: DesignSpec): string {
  const palette = PALETTE_BY_ID[spec.tokens.palette ?? ''];
  const type = TYPE_BY_ID[spec.tokens.typography ?? ''];
  const layout = LAYOUT_BY_ID[spec.tokens.layout ?? ''];
  const motion = MOTION_BY_ID[spec.tokens.motion ?? ''];
  const emotion = spec.tokens.emotion ?? 'other';
  const density = (spec.tokens.density ?? 'balanced') as DensityId;
  const effects = spec.tokens.effects ?? 'flat-plain';
  const blueprint = BLUEPRINT_BY_ID[spec.blueprint] ?? FALLBACK_BLUEPRINT;

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
  const ctx: BlockCtx = {
    content: c,
    emotion,
    paletteId: palette.id,
    typeId: type.id,
    plateAssets: assets.filter((a) => a.kind !== 'backdrop'),
    backdrops: assets.filter((a) => a.kind === 'backdrop'),
    blueprint,
  };

  /* Sections, in the blueprint's order. Only modules it declares are rendered,
     which is what stops every page being work/features/stats/about/contact. */
  const sections = blueprint.sections
    .map((sec) => {
      const head = sectionHead(
        (c.sections as Record<string, { title: string; eyebrow: string; note: string }>)[sec.module]?.title ??
          sec.module,
        (c.sections as Record<string, { eyebrow: string }>)[sec.module]?.eyebrow ?? sec.module,
        (c.sections as Record<string, { note: string }>)[sec.module]?.note ?? '',
        sec.module,
      );
      return `  <section class="sec" id="${sec.module}" data-block="${sec.module}:${sec.variant}" aria-labelledby="${sec.module}-title">
    <div class="wrap">
${head}
${renderModule(sec.module, sec.variant, ctx)}
    </div>
  </section>`;
    })
    .join('\n\n');

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
<html lang="en" data-emotion="${esc(emotion)}" data-blueprint="${esc(blueprint.id)}" data-lead="${esc(
    blueprint.lead,
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
<meta name="forge-blueprint" content="${esc(blueprint.id)}">
<meta name="forge-lead" content="${esc(blueprint.lead)}">
<meta name="forge-effects" content="${esc(effects)}">
<meta name="forge-seed" content="${spec.seed}">
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

${renderNav(blueprint.nav, blueprint, ctx)}

<!-- Provenance lives here, not in the page's own chrome: the header and footer
     belong to the brief's brand, not to the tool that generated it. -->
<div id="provenance" class="pop" popover>
  <h2>How this page was built</h2>
  <p>A brief was answered by <strong>${esc(
    spec.meta.decider === 'live' ? 'Jev' : 'the local stand-in decider',
  )}</strong>
  (${esc(spec.meta.model)}) in ${spec.meta.latencyMs} ms. ${
    spec.meta.writer === 'llm'
      ? `The content was written by <strong>${esc(spec.meta.writerModel)}</strong> in ${spec.meta.writerLatencyMs} ms.`
      : 'No writer was configured, so this is specimen content.'
  }
  Code assembled the page from the decisions below — the model never wrote markup.</p>
  <dl class="spec">
        ${decisionList}
      <dt>blueprint</dt><dd>${esc(blueprint.id)} <small>(${esc(blueprint.lead)}-led)</small></dd>
      <dt>effects</dt><dd>${esc(effectsLabel)}</dd>
      <dt>seed</dt><dd>${spec.seed}</dd>
  </dl>
</div>

<main id="top">
${renderHero(blueprint.hero, ctx)}

${sections}

</main>

${renderFooter(blueprint.footer, ctx)}

</body>
</html>`;
}
