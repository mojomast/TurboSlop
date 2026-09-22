/**
 * TurboSlop — image slots and supplied images.
 *
 * The failure these protect against, straight from the measured baseline: two
 * images were generated, zero `<img>` elements appeared in the page, and the
 * same picture was cycled across unrelated tiles. A slot is the fix — an image
 * request describes a PLACE, and the renderer resolves by that place.
 *
 * Everything here is offline. No image service is contacted.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLUEPRINTS } from '../src/blueprint.js';
import { imageSlotsFor } from '../src/blueprint.js';
import { buildSlotPrompts, PROMPT_CHAR_BUDGET } from '../src/images.js';
import { imageSize, ingestUserImages } from '../src/userassets.js';
import { renderHtml } from '../src/render.js';
import { readFile } from 'node:fs/promises';
import { decideWithFallback } from '../src/decider.js';
import { compose } from '../src/compose.js';
import { fallbackContent } from '../src/content.js';
import type { DesignSpec } from '../src/types.js';

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

console.log('\n=== TurboSlop — image slots ===\n');

/** A tiny but real-enough PNG: the generator's own output is a PNG header + data. */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-slots-'));
const userRoot = await mkdtemp(path.join(tmpdir(), 'turboslop-userimg-'));
await mkdir(path.join(userRoot, 'brand'), { recursive: true });
await writeFile(path.join(userRoot, 'brand', 'hero.png'), pngOf(2400, 1500));
await writeFile(path.join(userRoot, 'brand', 'notanimage.txt'), 'hello');

/* ------------------------------------------------------------------ *
 * Slot derivation
 * ------------------------------------------------------------------ */
await test('every blueprint that wants images declares real, unique slots', () => {
  let withSlots = 0;
  for (const bp of BLUEPRINTS) {
    const slots = imageSlotsFor(bp);
    if (bp.imageSlots > 0) {
      withSlots++;
      assert.ok(slots.length > 0, `${bp.id} wants ${bp.imageSlots} images but declares no slots`);
    } else {
      assert.equal(slots.length, 0, `${bp.id} declares slots for a page that shows no images`);
    }
    const ids = slots.map((s) => s.id);
    assert.deepEqual([...new Set(ids)], ids, `${bp.id} has duplicate slot ids: ${ids.join(', ')}`);
    for (const s of slots) {
      assert.ok(/^\d+( \/ \d+)$/.test(s.aspect), `${bp.id}/${s.id}: bad aspect "${s.aspect}"`);
      assert.ok(['native', 'texture'].includes(s.scale), `${bp.id}/${s.id}: bad scale`);
      assert.ok(s.placement.length > 5, `${bp.id}/${s.id}: no placement described`);
    }
  }
  assert.ok(withSlots >= 8, `expected most blueprints to want images, only ${withSlots} do`);
});

await test('a full-bleed hero slot is declared a texture, never a photograph', () => {
  // The rule the mission states: do not enlarge a 256px asset into a
  // photographic hero. A hero that renders far wider than 256 must be declared
  // as atmosphere.
  for (const bp of BLUEPRINTS) {
    for (const s of imageSlotsFor(bp)) {
      if (s.role === 'hero-texture' || s.role === 'hero-figure') {
        if (s.desktopWidth > 320) {
          assert.equal(s.scale, 'texture', `${bp.id}/${s.id} renders ${s.desktopWidth}px but is not declared a texture`);
        }
      }
      if (s.scale === 'native') {
        assert.ok(s.desktopWidth <= 320, `${bp.id}/${s.id} claims native at ${s.desktopWidth}px — larger than a 256px asset`);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * Prompting
 * ------------------------------------------------------------------ */
await test('slot prompts describe the place, not a count', async () => {
  const r = await decideWithFallback('A shop selling hand-thrown ceramic tableware.', { offline: true });
  const { spec } = compose('A shop selling hand-thrown ceramic tableware.', r);
  const bp = BLUEPRINTS.find((b) => b.id === 'catalogue-gallery')!;
  const slots = imageSlotsFor(bp);
  const prompts = buildSlotPrompts(spec, slots);
  assert.equal(prompts.length, slots.length, 'exactly one prompt per slot');
  assert.deepEqual(prompts.map((p) => p.slot), slots.map((s) => s.id), 'prompts keep slot order and identity');
  for (const p of prompts) {
    assert.ok(p.prompt.length <= PROMPT_CHAR_BUDGET, `${p.slot}: prompt is ${p.prompt.length} chars, over the encoder budget`);
    assert.ok(!/undefined|NaN/.test(p.prompt), `${p.slot}: leaked a placeholder`);
  }
  // Different roles must not produce the same request.
  const hero = prompts.find((p) => p.slot === 'hero');
  const tile = prompts.find((p) => p.slot === 'gallery-1');
  if (hero && tile) assert.notEqual(hero.prompt, tile.prompt, 'a hero field and a tile still life must differ');
});

/* ------------------------------------------------------------------ *
 * Intrinsic size detection
 * ------------------------------------------------------------------ */
await test('intrinsic size is read from the file, not assumed', () => {
  assert.deepEqual(imageSize(pngOf(2400, 1500)), { width: 2400, height: 1500, format: 'png' });
  assert.equal(imageSize(Buffer.from('not an image at all, sadly')).format, 'unknown');
  // A JPEG SOF0 marker is enough to learn the frame size.
  // SOI, then SOF0 carrying 600x800 — the marker alone is enough.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x00, 0x00, 0x00]);
  const js = imageSize(jpeg);
  assert.equal(js.format, 'jpeg');
  assert.equal(js.width, 0x0320);
  assert.equal(js.height, 0x0258);
});

/* ------------------------------------------------------------------ *
 * Supplied images
 * ------------------------------------------------------------------ */
await test('a supplied image is copied in, with its size, credit and licence', async () => {
  const { assets, notes } = await ingestUserImages({
    outDir,
    slug: 'slotset',
    root: userRoot,
    requests: [{ slot: 'hero', path: 'brand/hero.png', alt: 'Kiln interior', credit: 'A. Potter', license: 'CC-BY-4.0' }],
    allowedSlots: ['hero', 'gallery-1'],
  });
  assert.equal(assets.length, 1, `expected one asset, got ${assets.length} (${notes.join('; ')})`);
  const a = assets[0]!;
  assert.equal(a.source, 'user');
  assert.equal(a.slot, 'hero');
  assert.equal(a.nativeWidth, 2400, 'the real pixel width must be recorded');
  assert.equal(a.nativeHeight, 1500);
  assert.equal(a.credit, 'A. Potter');
  assert.equal(a.license, 'CC-BY-4.0');
  const s = await stat(path.join(outDir, a.file));
  assert.ok(s.size > 0, 'the image must be copied into the export');
});

await test('a supplied image with no attribution is recorded honestly, not guessed', async () => {
  const { assets, notes } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'items-1', path: 'brand/hero.png' }],
    allowedSlots: ['hero', 'items-1'],
  });
  assert.equal(assets.length, 1);
  assert.equal(assets[0]!.credit, '');
  assert.equal(assets[0]!.license, '');
  assert.ok(notes.some((n) => /no credit or licence/i.test(n)), 'the gap must be reported');
});

await test('path traversal is refused', async () => {
  const { assets, notes } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'hero', path: '../../../etc/passwd' }],
    allowedSlots: ['hero'],
  });
  assert.equal(assets.length, 0, 'nothing outside the root may be read');
  assert.ok(notes.some((n) => /outside the configured image directory/i.test(n)), notes.join('; '));
});

await test('a non-image is refused with a note rather than failing the job', async () => {
  const { assets, notes } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'hero', path: 'brand/notanimage.txt' }],
    allowedSlots: ['hero'],
  });
  assert.equal(assets.length, 0);
  assert.ok(notes.some((n) => /not a PNG, JPEG, WebP or GIF/i.test(n)), notes.join('; '));
});

await test('an image for a slot this direction does not render is refused', async () => {
  const { assets, notes } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'hero', path: 'brand/hero.png' }],
    allowedSlots: ['items-1'],
  });
  assert.equal(assets.length, 0);
  assert.ok(notes.some((n) => /ignored: this direction renders/i.test(n)), notes.join('; '));
});

/* ------------------------------------------------------------------ *
 * Resolution in the renderer
 * ------------------------------------------------------------------ */
async function specFor(bpId: string, brief = 'A shop selling hand-thrown ceramic tableware.'): Promise<DesignSpec> {
  const r = await decideWithFallback(brief, { offline: true });
  const { spec } = compose(brief, r);
  spec.blueprint = bpId;
  spec.content = fallbackContent(brief, spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence })));
  return spec;
}

await test('an asset lands in the slot it was made for, not wherever it fits', async () => {
  const spec = await specFor('catalogue-gallery');
  const { assets } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'items-2', path: 'brand/hero.png', alt: 'Second tile', credit: 'A', license: 'B' }],
    allowedSlots: ['hero', 'items-1', 'items-2'],
  });
  spec.assets = assets;
  const html = renderHtml(spec);
  // The supplied image must appear exactly once, and among the gallery figures.
  assert.equal([...html.matchAll(/Second tile/g)].length, 1, 'the supplied image should appear once');
  const gallery = /<div class="gallery">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  assert.ok(gallery.includes('Second tile'), 'the supplied image belongs in the gallery, not the hero');
});

await test('a texture slot is marked as atmosphere in the markup', async () => {
  const spec = await specFor('image-mosaic');
  spec.assets = [
    { kind: 'backdrop', slot: 'hero', source: 'generated', file: 'assets/x/00-hero-1.png', alt: 'texture', credit: '', license: '', nativeWidth: 256, nativeHeight: 256, prompt: 'p', seed: 1, steps: 4, cfg: 2, bytes: 1, seconds: 0 },
  ];
  const html = renderHtml(spec);
  assert.ok(html.includes('data-texture="1"'), 'an enlarged 256px asset must be marked as a texture');
  assert.ok(/content="image-mosaic"/.test(html) || html.includes('data-blueprint="image-mosaic"'));
});

await test('a supplied image beats a generated one for the same slot', async () => {
  const spec = await specFor('catalogue-gallery');
  const { assets: userAssets } = await ingestUserImages({
    outDir, slug: 'slotset', root: userRoot,
    requests: [{ slot: 'items-1', path: 'brand/hero.png', alt: 'Supplied tile', credit: 'C', license: 'D' }],
    allowedSlots: ['hero', 'items-1', 'items-2'],
  });
  spec.assets = [
    { kind: 'motif', slot: 'items-1', source: 'generated', file: 'assets/x/gen.png', alt: 'Generated tile', credit: '', license: '', nativeWidth: 256, nativeHeight: 256, prompt: 'p', seed: 1, steps: 4, cfg: 2, bytes: 1, seconds: 0 },
    ...userAssets,
  ];
  const html = renderHtml(spec);
  assert.ok(html.includes('Supplied tile'), 'the supplied image must be used');
  assert.ok(!html.includes('Generated tile'), 'the generated image for that slot must be dropped');
});

await test('no asset is ever referenced from a path outside the output', async () => {
  const spec = await specFor('catalogue-gallery');
  const html = renderHtml(spec);
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    assert.ok(!m[1]!.startsWith('/') && !m[1]!.includes('..'), `unsafe image src: ${m[1]}`);
  }
});

// The generated-font suite keeps its temp dir; clean ours.
await rm(outDir, { recursive: true, force: true });
await rm(userRoot, { recursive: true, force: true });
void readFile;
void fileURLToPath;

console.log(failed ? `\n=== ${failed} FAILED, ${passed} passed ===\n` : `\nall ${passed} checks passed\n`);
if (failed) process.exit(1);
