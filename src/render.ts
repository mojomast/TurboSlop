/**
 * TurboSlop — renderer.
 *
 * Assembles a page from its BLUEPRINT: the nav, hero, footer treatments and the
 * ordered subset of section modules the blueprint declares. There is no fixed
 * spine here — the page's structure is data.
 *
 * Every visual value comes from the catalog entries the direction selected, and
 * every word comes from `spec.content`.
 *
 * ## Identity
 *
 * Every rendered section gets a UNIQUE, STABLE id, even when a blueprint
 * repeats a module. The first instance of `items` is `items`; the second is
 * `items-2`. Navigation targets the first instance. Previously both the hero and
 * `<main>` carried `id="top"`, and a repeated module emitted the same id twice,
 * so duplicates were both invalid and ambiguous as link targets.
 */
import { BLUEPRINT_BY_ID, type Blueprint, type ModuleId } from './blueprint.js';
import {
  MODULE_LABELS,
  renderFooter,
  renderHero,
  renderModule,
  renderNav,
  sectionHead,
  type BlockCtx,
  type NavTarget,
} from './blocks.js';
import { atmosphereFor, EFFECTS_BY_ID, LAYOUT_BY_ID, MOTION_BY_ID, PALETTE_BY_ID, TYPE_BY_ID } from './catalog.js';
import type { DensityId } from './catalog.js';
import { stripEmphasis } from './content.js';
import { buildStylesheet } from './layout.js';
import {
  motifFor,
  validateVisualBlueprint,
  visualBlueprintFor,
  visualCss,
  type VisualBlueprint,
} from './visual.js';
import type { DesignSpec } from './types.js';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const FALLBACK_BLUEPRINT: Blueprint = BLUEPRINT_BY_ID['statement-display']!;

/** How coarse the motif field is, per density decision. */
const MOTIF_DENSITY: Record<string, number> = { quiet: 0.22, balanced: 0.5, dense: 0.85 };

/**
 * The visual blueprint for a spec.
 *
 * Exported so the pipeline can materialise the same motif the page will draw —
 * one derivation, not two that can drift.
 */
export function visualForSpec(spec: DesignSpec): VisualBlueprint {
  const palette = PALETTE_BY_ID[spec.tokens.palette ?? ''];
  const blueprint = BLUEPRINT_BY_ID[spec.blueprint] ?? FALLBACK_BLUEPRINT;
  if (!palette) throw new Error(`cannot derive a visual blueprint: unknown palette "${spec.tokens.palette}"`);
  return visualBlueprintFor({
    blueprint,
    typefaceId: spec.tokens.typography ?? 'grotesk-tight',
    emotion: spec.tokens.emotion ?? 'other',
    density: spec.tokens.density ?? 'balanced',
    // A spec built by the CLI or the tests may carry seed 0; use a stable
    // non-zero value so the derivation is still a real hash.
    seed: spec.seed || 1,
    accent: palette.accent,
    ground: palette.bg,
  });
}

export interface RenderOptions {
  /**
   * Preview renders are shown to a human inside the contact sheet before any
   * final copy exists. They are labelled as such on the page itself, so a
   * screenshot can never be mistaken for a finished design.
   */
  preview?: boolean;
  /** Which copy is in this render, for the preview label. */
  copySource?: 'shared-inventory' | 'specimen' | 'final';
  /** Extra CSS to inject (per-direction motif layers, frame styles). */
  extraCss?: string;
  /**
   * Where the bundled woff2 files sit relative to the page. Defaults to
   * `fonts/`; the control surface passes an absolute `/fonts/`.
   */
  fontBasePath?: string;
}

/**
 * Unique, stable instance ids for a blueprint's sections.
 * Exported so the asset/slot layers can address the same instances.
 */
export function sectionInstanceIds(blueprint: Blueprint): string[] {
  const counts = new Map<ModuleId, number>();
  return blueprint.sections.map((sec) => {
    const n = (counts.get(sec.module) ?? 0) + 1;
    counts.set(sec.module, n);
    return n === 1 ? sec.module : `${sec.module}-${n}`;
  });
}

/** The nav targets: the first instance of each module, in blueprint order. */
export function navTargetsFor(blueprint: Blueprint, spec: DesignSpec): NavTarget[] {
  const ids = sectionInstanceIds(blueprint);
  const content = spec.content;
  // Labels are matched to their target. The writer's labels are used only when
  // there is exactly one per section, so a short list cannot shift onto the
  // wrong link.
  const labels = content && content.nav.length === blueprint.sections.length ? content.nav : null;

  const seen = new Set<ModuleId>();
  const out: NavTarget[] = [];
  blueprint.sections.forEach((sec, i) => {
    if (seen.has(sec.module)) return;
    seen.add(sec.module);
    out.push({
      module: sec.module,
      id: ids[i]!,
      label: labels?.[i] ?? MODULE_LABELS[sec.module],
    });
  });
  return out;
}

/**
 * Which section carries the motif.
 *
 * One coordinated motif per direction, placed once — a motif on every section
 * is a texture, not a composition. The rules pick the section with the most
 * room for it, deterministically.
 */
export function motifRoleOn(module: ModuleId, index: number, vb: VisualBlueprint): boolean {
  if (vb.motif.role === 'none') return false;
  const preferred = vb.motif.role === 'band' || vb.motif.role === 'rule' ? 'quote' : 'gallery';
  if (module === preferred) return true;
  // Fall back to the section after the first, so there is usually something.
  return index === 1 && ['items', 'features', 'stats', 'about'].includes(module);
}

export function renderHtml(spec: DesignSpec, opts: RenderOptions = {}): string {
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
  const css = buildStylesheet({
    emotion,
    palette,
    type,
    layout,
    motion,
    density,
    effects,
    ...(opts.fontBasePath ? { fontBasePath: opts.fontBasePath } : {}),
  });
  const atm = atmosphereFor(emotion);

  /* The visual blueprint: hero recipe, typographic recipe, section recipes,
     motif, image treatment, frames and icons. Validated, then emitted as data
     attributes plus one CSS block. */
  const vb = visualForSpec(spec);
  const visualIssues = validateVisualBlueprint(vb);
  if (visualIssues.length) {
    throw new Error(
      `Render failed: the visual blueprint is invalid — ${visualIssues.map((i) => `${i.rule}: ${i.detail}`).join('; ')}`,
    );
  }
  const motif = vb.motif.role === 'none' ? null : motifFor(vb, palette.bg, MOTIF_DENSITY[density] ?? 0.5);
  const extraCss = [visualCss({ vb, motif, fg: palette.fg, bg: palette.bg }), opts.extraCss ?? '']
    .filter(Boolean)
    .join('\n');

  const assets = spec.assets ?? [];
  const ctx: BlockCtx = {
    content: c,
    emotion,
    paletteId: palette.id,
    typeId: type.id,
    plateAssets: assets.filter((a) => a.kind !== 'backdrop'),
    backdrops: assets.filter((a) => a.kind === 'backdrop'),
    blueprint,
    visual: vb,
  };

  const instanceIds = sectionInstanceIds(blueprint);
  const navTargets = navTargetsFor(blueprint, spec);

  /* Sections, in the blueprint's order, each with its own unique id. Only
     modules the blueprint declares are rendered, which is what stops every page
     being work/features/stats/about/contact. */
  const sections = blueprint.sections
    .map((sec, i) => {
      const id = instanceIds[i]!;
      const heading = c.sections?.[sec.module];
      const head = sectionHead(
        heading?.title ?? MODULE_LABELS[sec.module],
        heading?.eyebrow ?? MODULE_LABELS[sec.module],
        heading?.note ?? '',
        id,
      );
      /* Per-section drawing instructions. This is what makes the SAME module
         look different on different pages: bleed, alignment, whitespace and the
         share given to imagery all vary here rather than in the renderer. */
      const r = vb.sections[sec.module];
      const draw = r
        ? ` data-bleed="${esc(r.bleed)}" data-align="${esc(r.align)}" data-whitespace="${esc(
            r.whitespace,
          )}" data-image-ratio="${r.imageRatio}"`
        : '';
      const motifAttr = motif && motifRoleOn(sec.module, i, vb) ? ` data-motif="${esc(vb.motif.role)}"` : '';
      return `  <section class="sec" id="${esc(id)}" data-block="${esc(sec.module)}:${esc(
        sec.variant,
      )}"${draw}${motifAttr} aria-labelledby="${esc(id)}-title">
    <div class="wrap">
${head}
${renderModule(sec.module, sec.variant, ctx)}
    </div>
  </section>`;
    })
    .join('\n\n');

  const previewBanner = opts.preview
    ? `\n<div class="preview-flag" role="note"><b>Preview</b> — ${
        opts.copySource === 'final'
          ? 'final copy'
          : opts.copySource === 'specimen'
            ? 'local specimen copy, no writer configured'
            : 'shared content inventory, not final copy'
      }. Blueprint <code>${esc(blueprint.id)}</code>.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-emotion="${esc(emotion)}" data-blueprint="${esc(blueprint.id)}" data-lead="${esc(
    blueprint.lead,
  )}" data-effects="${esc(effects)}" data-palette="${esc(palette.id)}" data-hero="${esc(
    blueprint.hero,
  )}" data-construction="${esc(vb.typo.construction)}" data-label="${esc(
    vb.typo.labelStyle,
  )}" data-treatment="${esc(vb.imageTreatment)}" data-motif-family="${esc(vb.motif.family)}"${
    opts.preview ? ' data-preview="1"' : ''
  }>
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
<style>
${css}
${extraCss}
</style>
</head>
<body>
${previewBanner}
<div class="scroll-progress" aria-hidden="true"></div>
<div class="atmosphere" aria-hidden="true"></div>
${atm.grain > 0 ? '<div class="grain" aria-hidden="true"></div>' : ''}

${renderNav(blueprint.nav, blueprint, ctx, navTargets)}

<main>
${renderHero(blueprint.hero, ctx)}

${sections}

</main>

${renderFooter(blueprint.footer, ctx)}

</body>
</html>`;
}
