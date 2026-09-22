#!/usr/bin/env node
/**
 * TurboSlop — render a matrix of directions to HTML for measurement.
 *
 * Renders the cross-product of blueprints × effect kits (× optionally palettes
 * and typefaces) with the specimen content, so a whole class of layout can be
 * loaded in a browser and measured at once. No network, no keys, no writer.
 *
 * Usage:
 *   npx tsx scripts/render-matrix.ts --out /tmp/matrix
 *   npx tsx scripts/render-matrix.ts --out /tmp/matrix --effects organic-mesh
 *   npx tsx scripts/render-matrix.ts --out /tmp/matrix --blueprints catalogue-rail,data-metrics
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BLUEPRINTS } from '../src/blueprint.js';
import { EFFECT_KIT_IDS } from '../src/styles.js';
import { compose } from '../src/compose.js';
import { fallbackContent } from '../src/content.js';
import { decideWithFallback } from '../src/decider.js';
import { renderHtml } from '../src/render.js';

interface Args {
  out: string;
  effects: string[];
  blueprints: string[];
  brief: string;
}

function parse(argv: string[]): Args {
  const a: Args = {
    out: 'matrix-out',
    effects: [...EFFECT_KIT_IDS],
    blueprints: BLUEPRINTS.map((b) => b.id),
    brief: 'A shop selling hand-thrown ceramic tableware. Small batch, muted glazes, ships worldwide.',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i] ?? a.out;
    else if (k === '--effects') a.effects = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (k === '--blueprints') a.blueprints = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (k === '--brief') a.brief = argv[++i] ?? a.brief;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });

  const decided = await decideWithFallback(args.brief, { offline: true });
  const axes = decided.response;

  let n = 0;
  for (const bp of BLUEPRINTS) {
    if (!args.blueprints.includes(bp.id)) continue;
    for (const effects of args.effects) {
      const { spec } = compose(args.brief, decided, {
        seed: 7,
        direction: {
          blueprint: bp.id,
          palette: spec0Palette(axes),
          typography: spec0Type(axes),
          effects,
          motion: pick(axes, 'motion', 'breath'),
          density: pickScore(axes),
        },
      });
      const ax = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
      spec.content = fallbackContent(args.brief, ax);
      spec.meta.writer = 'fallback';

      const html = renderHtml(spec, { preview: true, copySource: 'specimen' });
      const slug = `${bp.id}--${effects}`;
      await writeFile(path.join(args.out, `${slug}.html`), html, 'utf8');
      n++;
    }
  }
  console.log(`  rendered ${n} page(s) into ${args.out}`);
}

/** Palette from the offline decider's argmax, so the matrix varies colour too. */
function spec0Palette(resp: { answers: Record<string, { type: string; choice?: string }> }): string {
  const a = resp.answers.palette;
  return a?.choice ?? 'sage-mist';
}
function spec0Type(resp: { answers: Record<string, { type: string; choice?: string }> }): string {
  const a = resp.answers.typography;
  return a?.choice ?? 'grotesk-tight';
}
function pick(
  resp: { answers: Record<string, { type: string; choice?: string }> },
  axis: string,
  fallback: string,
): string {
  return resp.answers[axis]?.choice ?? fallback;
}
function pickScore(resp: { answers: Record<string, { type: string; score?: number }> }): string {
  const s = resp.answers.density;
  const idx = Math.max(0, Math.min(2, Math.round(s?.score ?? 1)));
  return ['quiet', 'balanced', 'dense'][idx]!;
}

main().catch((err) => {
  console.error(`render-matrix failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
