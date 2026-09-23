/**
 * TurboSlop — motif generator tests.
 *
 * Runs entirely offline and deterministic: the generator is a pure string
 * function, so these checks need no DOM, no canvas and no renderer. Run:
 *   npx tsx test/motifs.test.ts
 */
import assert from 'node:assert/strict';
import { EMOTIONS } from '../src/catalog.js';
import {
  MOTIF_FAMILIES,
  generateMotif,
  motifFamilyForEmotion,
  motifInk,
  motifToDataUri,
  type MotifFamily,
  type MotifSpec,
} from '../src/motifs.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\n=== TurboSlop / motifs ===\n');

const spec = (over: Partial<MotifSpec> = {}): MotifSpec => ({
  family: 'halftone',
  seed: 42,
  width: 1200,
  height: 800,
  ink: '#a9e6ff',
  ground: '#05060a',
  density: 1,
  ...over,
});

const svgOf = (over: Partial<MotifSpec> = {}): string => generateMotif(spec(over)).svg;
const elCount = (svg: string): number => (svg.match(/</g) ?? []).length;
const numbers = (svg: string): string => (svg.match(/-?\d+(?:\.\d+)?/g) ?? []).join(',');
const isFamily = (x: string): x is MotifFamily => (MOTIF_FAMILIES as readonly string[]).includes(x);

/* ------------------------------------------------------------------ *
 * Markup validity
 * ------------------------------------------------------------------ */
await test('every family emits a standalone, decorative <svg>', () => {
  for (const family of MOTIF_FAMILIES) {
    const { svg } = generateMotif(spec({ family }));
    assert.ok(svg.startsWith('<svg '), `${family}: does not start with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${family}: does not end with </svg>`);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `${family}: missing xmlns`);
    assert.ok(svg.includes('viewBox="0 0 1200 800"'), `${family}: missing viewBox`);
    assert.ok(svg.includes('preserveAspectRatio='), `${family}: missing preserveAspectRatio`);
    assert.ok(svg.includes('width="1200"') && svg.includes('height="800"'), `${family}: missing size attributes`);
    assert.ok(svg.includes('aria-hidden="true"'), `${family}: not aria-hidden`);
    assert.ok(svg.includes('focusable="false"'), `${family}: focusable`);
    assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${family}: more than one root`);
    assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1, `${family}: more than one root close`);
  }
});

await test('no family emits NaN, undefined or Infinity', () => {
  for (const family of MOTIF_FAMILIES) {
    const svg = svgOf({ family });
    for (const bad of ['NaN', 'undefined', 'Infinity']) {
      assert.ok(!svg.includes(bad), `${family}: emitted "${bad}"`);
    }
  }
});

await test('every svg has balanced angle brackets', () => {
  for (const family of MOTIF_FAMILIES) {
    const svg = svgOf({ family });
    assert.equal((svg.match(/</g) ?? []).length, (svg.match(/>/g) ?? []).length, `${family}: unbalanced < >`);
  }
});

await test('geometry is recolourable and keeps a concrete ink fallback', () => {
  for (const family of MOTIF_FAMILIES) {
    const svg = svgOf({ family, ink: '#a9e6ff' });
    assert.ok(svg.includes('var(--motif-ink, #a9e6ff)'), `${family}: missing recolour hook`);
  }
});

await test('all numeric coordinates are rounded to two decimals', () => {
  for (const family of MOTIF_FAMILIES) {
    const svg = svgOf({ family });
    const bad = svg.match(/\d+\.\d{3,}/g);
    assert.equal(bad, null, `${family}: unrounded number(s) ${bad?.join(', ')}`);
  }
});

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */
await test('same spec twice is byte-identical, for every family', () => {
  for (const family of MOTIF_FAMILIES) {
    assert.equal(svgOf({ family }), svgOf({ family }), `${family}: not deterministic`);
  }
});

await test('different seeds produce different strings', () => {
  for (const family of MOTIF_FAMILIES) {
    assert.notEqual(svgOf({ family, seed: 1 }), svgOf({ family, seed: 2 }), `${family}: seeds collapsed`);
  }
});

await test('different seeds produce different geometry, not just headers', () => {
  for (const family of MOTIF_FAMILIES) {
    const a = svgOf({ family, seed: 1 });
    const b = svgOf({ family, seed: 2 });
    assert.notEqual(numbers(a), numbers(b), `${family}: geometry identical across seeds`);
  }
});

await test('families are visually distinct, not one drawing renamed', () => {
  const seen = new Set<string>();
  for (const family of MOTIF_FAMILIES) {
    const svg = svgOf({ family });
    assert.ok(!seen.has(svg), `${family}: duplicates another family's output`);
    seen.add(svg);
  }
});

/* ------------------------------------------------------------------ *
 * Density and budget
 * ------------------------------------------------------------------ */
await test('density 1 draws more elements than density 0', () => {
  for (const family of MOTIF_FAMILIES) {
    const quiet = elCount(svgOf({ family, density: 0 }));
    const busy = elCount(svgOf({ family, density: 1 }));
    assert.ok(busy > quiet, `${family}: busy ${busy} is not > quiet ${quiet}`);
    assert.ok(quiet > 2, `${family}: density 0 is empty-ish (${quiet} tags)`);
  }
});

await test('element budget: under 400 tags at 1200x800 density 1', () => {
  const budget = 400;
  for (const family of MOTIF_FAMILIES) {
    const n = elCount(svgOf({ family, density: 1 }));
    assert.ok(n < budget, `${family}: ${n} tags exceeds the ${budget} budget`);
  }
});

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */
await test('id and filename are stable and derived from the spec', () => {
  const m = generateMotif(spec({ family: 'contour', seed: 7, width: 300, height: 200 }));
  assert.equal(m.id, 'contour-7-300x200');
  assert.equal(m.filename, 'motif-contour-7.svg');
  assert.equal(m.width, 300);
  assert.equal(m.height, 200);
  assert.equal(generateMotif(spec({ family: 'contour', seed: 7, width: 300, height: 200 })).id, m.id);
});

await test('MOTIF_FAMILIES declares the twelve distinct families', () => {
  assert.equal(MOTIF_FAMILIES.length, 12);
  assert.deepEqual(
    [...MOTIF_FAMILIES],
    [
      'halftone',
      'contour',
      'hatching',
      'technical',
      'stamp',
      'truchet',
      'isometric',
      'weave',
      'fishscale',
      'waves',
      'quatrefoil',
      'stipple',
    ],
  );
});

await test('every family is reachable from the catalog emotions or the fallback', () => {
  const reached = new Set<string>(EMOTIONS.map((e) => motifFamilyForEmotion(e.id)));
  reached.add(motifFamilyForEmotion('not-an-emotion'));
  for (const family of MOTIF_FAMILIES) {
    assert.ok(reached.has(family), `${family} is unreachable from any emotion`);
  }
});

/* ------------------------------------------------------------------ *
 * Emotion mapping
 * ------------------------------------------------------------------ */
await test('motifFamilyForEmotion is total over the catalog', () => {
  assert.equal(EMOTIONS.length, 11, 'catalog emotion count changed');
  for (const e of EMOTIONS) {
    const family = motifFamilyForEmotion(e.id);
    assert.ok(isFamily(family), `${e.id}: "${family}" is not a family`);
  }
});

await test('an unknown emotion still returns a valid family', () => {
  assert.ok(isFamily(motifFamilyForEmotion('not-an-emotion')));
});

/* ------------------------------------------------------------------ *
 * Data URI
 * ------------------------------------------------------------------ */
await test('motifToDataUri is URL-encoded, not base64, and escapes #', () => {
  for (const family of MOTIF_FAMILIES) {
    const uri = motifToDataUri(generateMotif(spec({ family })));
    assert.ok(uri.startsWith('data:image/svg+xml,'), `${family}: wrong prefix`);
    assert.ok(!uri.includes('#'), `${family}: raw # not encoded`);
    assert.ok(!uri.includes('base64'), `${family}: must not use base64`);
  }
});

await test('the data uri decodes back to the exact svg', () => {
  const m = generateMotif(spec({ family: 'technical' }));
  const uri = motifToDataUri(m);
  const body = uri.slice('data:image/svg+xml,'.length);
  assert.equal(decodeURIComponent(body), m.svg);
});

/* ------------------------------------------------------------------ *
 * Input validation
 * ------------------------------------------------------------------ */
await test('an unknown family throws a clear error', () => {
  assert.throws(() => generateMotif(spec({ family: 'nope' as MotifFamily })), /unknown family/i);
});

await test('a non-finite seed is treated as 0 rather than throwing', () => {
  const nan = generateMotif(spec({ seed: Number.NaN }));
  assert.equal(nan.id, 'halftone-0-1200x800');
  assert.ok(nan.svg.startsWith('<svg '));
  const inf = generateMotif(spec({ seed: Number.POSITIVE_INFINITY }));
  assert.equal(inf.id, 'halftone-0-1200x800');
});

await test('width and height are clamped to 64..4000', () => {
  assert.equal(generateMotif(spec({ width: 10, height: 10 })).width, 64);
  assert.equal(generateMotif(spec({ width: 10, height: 10 })).height, 64);
  assert.equal(generateMotif(spec({ width: 99999, height: 99999 })).width, 4000);
  assert.equal(generateMotif(spec({ width: 99999, height: 99999 })).height, 4000);
});

await test('density is optional and defaults cleanly', () => {
  const m = generateMotif({ family: 'halftone', seed: 3, width: 512, height: 512, ink: '#ffffff', ground: '#000000' });
  assert.ok(m.svg.startsWith('<svg '));
  assert.ok(!m.svg.includes('NaN'));
  assert.equal(m.svg, generateMotif({ family: 'halftone', seed: 3, width: 512, height: 512, ink: '#ffffff', ground: '#000000' }).svg);
});

await test('injected colour values are sanitised before they reach markup', () => {
  const m = generateMotif(spec({ ink: '"><script>', ground: 'nonsense' }));
  assert.ok(!m.svg.includes('<script>'), 'unsafe ink reached the svg');
  assert.ok(m.svg.includes('var(--motif-ink, #000000)'), 'fallback ink not applied');
});

/* ------------------------------------------------------------------ *
 * Colour derivation
 * ------------------------------------------------------------------ */
await test('motifInk derives a legible ink from real palette colours', () => {
  const out = motifInk('#a9e6ff', '#05060a');
  assert.match(out, /^#[0-9a-f]{6}$/, `expected hex, got ${out}`);
  // A washed-out accent on a light ground must be pushed darker for contrast.
  const low = motifInk('#f4f4f4', '#ffffff');
  assert.match(low, /^#[0-9a-f]{6}$/);
  assert.notEqual(low, '#f4f4f4');
  // Deterministic.
  assert.equal(motifInk('#a9e6ff', '#05060a'), out);
});

console.log(`\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
