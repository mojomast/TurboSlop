/**
 * TurboSlop — the shared asset plan.
 *
 * A CONTROLLED FIXTURE image service (a local HTTP server implementing the
 * Supra2 API) counts every request, so these are offline evidence, not
 * live-service claims — the fixture is labelled as such in the report.
 *
 * What must hold:
 *   - zero renderable slots ⇒ ZERO requests to the asset service (the
 *     baseline's "2 generated, 0 rendered" cannot recur);
 *   - supplied images resolve FIRST and suppress generation for their slots;
 *   - slot ownership is validated against the actual rendered module VARIANT
 *     and available content (an `items:table` draws no plates);
 *   - every requested asset appears in its INTENDED slot in the rendered HTML,
 *     verified via `data-slot`, not by finding a URL somewhere;
 *   - assets (and their metadata) survive a real ZIP export, with fonts and
 *     their licences.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLUEPRINTS, resolveBlueprint } from '../src/blueprint.js';
import {
  availableModulesOf,
  contentDiagnostics,
  finalizeAssets,
  renderableSlots,
  verifyAssetPlacement,
} from '../src/assetplan.js';
import { compose } from '../src/compose.js';
import { decideWithFallback } from '../src/decider.js';
import { buildDirections } from '../src/directions.js';
import { fallbackContent } from '../src/content.js';
import { buildZip } from '../src/export.js';
import { runPipeline } from '../src/pipeline.js';
import { renderHtml } from '../src/render.js';
import { finalizeSession, createSession } from '../src/sessions.js';
import type { DesignSpec } from '../src/types.js';

let passed = 0;
let failed = 0;
let skipped = 0;

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
function skip(name: string, reason: string): void {
  skipped++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

console.log('\n=== TurboSlop — shared asset plan (controlled fixture service) ===\n');

/* ------------------------------------------------------------------ *
 * The FIXTURE: a local Supra2 stand-in that counts every request.
 * ------------------------------------------------------------------ */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface Fixture {
  port: number;
  generateCalls: number;
  prompts: string[];
  close: () => Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  let n = 0;
  const state: Fixture = {
    port: 0,
    generateCalls: 0,
    prompts: [],
    close: async () => undefined,
  };
  const jobs: { id: string; status: string; prompt: string; seed: number; steps: number; cfg: number; image: string; seconds: number }[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          prompt: string;
          seed: number;
          steps: number;
          cfg: number;
        };
        state.generateCalls++;
        state.prompts.push(body.prompt);
        const id = `fx${++n}`;
        jobs.push({ id, status: 'done', ...body, image: `/images/${id}.png`, seconds: 0.01 });
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      });
      return;
    }
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobs }));
      return;
    }
    const img = /^\/images\/(fx\d+)\.png$/.exec(url.pathname);
    if (img) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG_1PX);
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.port = (server.address() as { port: number }).port;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}

const fixture = await startFixture();
const originalImageEnv = process.env.FORGE_IMAGE_BASE_URL;
process.env.FORGE_IMAGE_BASE_URL = `http://127.0.0.1:${fixture.port}`;

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRIEF = 'A three-day independent games festival in Rotterdam. Talks, a tournament, and a late-night arcade.';
const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-assets-'));
const uploadRoot = await mkdtemp(path.join(tmpdir(), 'turboslop-uploads-'));

async function specFor(blueprintId: string, brief = BRIEF): Promise<DesignSpec> {
  const decided = await decideWithFallback(brief, { preference: 'local' });
  const { spec } = compose(brief, decided, {
    seed: 99,
    direction: {
      blueprint: blueprintId,
      palette: 'paper-ink',
      typography: 'grotesk-tight',
      effects: 'tactile-paper',
      motion: 'breath',
      density: 'balanced',
      fit: 0.7,
      novelty: 1,
      rationale: 'test',
    },
  });
  const axes = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  spec.content = fallbackContent(brief, axes);
  return spec;
}

const hasUnzip = (() => {
  try {
    execFileSync('which', ['unzip'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/* ================================================================== *
 * 1. Slot ownership: the ACTUAL rendered variant and content
 * ================================================================== */
await test('an items:table layout renders no catalogue plates, so it owns no items slots', () => {
  const tableBp = BLUEPRINTS.find((b) => b.id === 'product-spec')!;
  assert.equal(tableBp.sections.find((s) => s.module === 'items')?.variant, 'table', 'precondition: this layout draws a table');
  const withAppetite = { ...tableBp, imageSlots: 6 };
  const slots = renderableSlots(withAppetite, undefined);
  const itemsSlots = slots.filter((s) => s.id.startsWith('items-'));
  assert.deepEqual(itemsSlots, [], 'the table variant draws no plates — it must not own items slots');
});

await test('an empty gallery renders no figures, so gallery slots are not renderable', () => {
  const mosaic = BLUEPRINTS.find((b) => b.id === 'image-mosaic')!;
  const empty = fallbackContent(BRIEF, [{ axis: 'emotion', picked: 'awe', confidence: 0.5 }]);
  const noItems = { ...empty, items: [] };
  const slots = renderableSlots(mosaic, noItems);
  assert.deepEqual(
    slots.map((s) => s.id),
    ['hero'],
    'with no items the gallery contributes nothing; only the hero slot remains',
  );
  const withItems = renderableSlots(mosaic, empty);
  assert.ok(withItems.length > 1, `with items the gallery slots come back, got ${withItems.length}`);
});

await test('a layout with imageSlots: 0 has no slots at all', () => {
  const zero = BLUEPRINTS.find((b) => b.id === 'data-metrics')!;
  assert.equal(zero.imageSlots, 0);
  assert.deepEqual(renderableSlots(zero, undefined), []);
});

/* ================================================================== *
 * 2. ZERO SLOTS ⇒ ZERO REQUESTS
 * ================================================================== */
await test('zero renderable slots make zero requests to the asset service', async () => {
  const before = fixture.generateCalls;
  const spec = await specFor('data-metrics');
  const bp = resolveBlueprint(spec.blueprint)!;
  const result = await finalizeAssets(
    { spec, blueprint: bp, settings: { enabled: true, count: 5, preset: 'turbo' }, outDir, slug: 'zero' },
    null,
  );
  assert.equal(fixture.generateCalls, before, 'the fixture must see NO request when there are no slots');
  assert.equal(result.assets.length, 0);
  assert.equal(result.imageMs, 0, 'asset time is 0 when nothing was requested');
  assert.ok(
    result.notes.some((n) => /0 image slots/.test(n)),
    `the plan must say why nothing was requested: ${result.notes.join(' | ')}`,
  );
});

await test('the CLI pipeline path turns an enabled image setting into an image-capable layout and real requests', async () => {
  /* The resolved defect: the best fit for a brief was a layout with zero image
     slots, so "generate images" requested nothing. Selection must now prefer a
     layout that can hold an image; the plan still never fires a request into a
     layout that cannot (that rule is covered by the plan and session tests). */
  const decided = await decideWithFallback(BRIEF, { preference: 'local' });
  const distributions: Record<string, Record<string, number>> = {};
  for (const [id, ans] of Object.entries(decided.response.answers)) {
    if (ans.type === 'choice') distributions[id] = ans.probabilities;
  }
  let seed = -1;
  for (let s = 1; s < 400; s++) {
    const built = buildDirections({
      brief: BRIEF,
      distributions: distributions as never,
      count: 6,
      seed: s,
      explore: 0.5,
      wantsDark: false,
      availableModules: availableModulesOf(fallbackContent(BRIEF, [])),
    });
    if (built.directions[0] && built.directions[0].blueprint.imageSlots === 0) {
      seed = s;
      break;
    }
  }
  assert.ok(seed > 0, 'expected to find a zero-slot best direction within 400 seeds');

  const before = fixture.generateCalls;
  const run = await runPipeline({
    brief: BRIEF,
    decider: 'local',
    noCopy: true,
    seed,
    images: { enabled: true, count: 4, preset: 'turbo' },
    outDir,
    slug: 'pipeline-images',
  });
  const blueprint = resolveBlueprint(run.spec.blueprint)!;
  assert.ok(
    blueprint.imageSlots > 0,
    `an image-enabled run must resolve to a layout with slots, got ${blueprint.id} (${blueprint.imageSlots})`,
  );
  const requests = fixture.generateCalls - before;
  assert.ok(requests > 0, `image setting is on and the layout has slots, so requests must happen (notes: ${run.notes.join(' | ')})`);
  assert.equal(requests, run.spec.meta.imageCount, 'every generated asset came from one request');
  assert.ok(
    run.notes.some((n) => /layouts that cannot hold an image were excluded/.test(n)),
    `the search restriction must be reported, got: ${run.notes.join(' | ')}`,
  );
  assert.ok(!run.notes.some((n) => /0 image slots/.test(n)), 'no request can be skipped for this run');
  assert.ok(run.timings.imageMs >= 0, 'asset time measured separately');
  assert.ok(run.timings.renderMs >= 0, 'local render time is measured separately');
});

/* ================================================================== *
 * 3. Supplied images resolve FIRST
 * ================================================================== */
const suppliedPng = path.join(uploadRoot, 'brand-hero.png');
await writeFile(suppliedPng, PNG_1PX);

await test('supplied images suppress generation for their slots; the rest are filled', async () => {
  const spec = await specFor('image-mosaic');
  const bp = resolveBlueprint('image-mosaic')!;
  const renderable = renderableSlots(bp, spec.content);
  assert.ok(renderable.length >= 3, `precondition: several renderable slots, got ${renderable.length}`);

  const before = fixture.generateCalls;
  const result = await finalizeAssets(
    {
      spec,
      blueprint: bp,
      settings: { enabled: true, count: 3, preset: 'turbo' },
      userImages: [
        { slot: 'hero', path: suppliedPng, alt: 'Brand hero photo', credit: 'Studio', license: 'CC-BY-4.0' },
        { slot: 'gallery-1', path: suppliedPng },
      ],
      userImageRoot: uploadRoot,
      outDir,
      slug: 'supplied',
    },
    null,
  );

  const unfilled = renderable.length - 2;
  const expectedRequests = Math.min(3, unfilled);
  assert.equal(
    fixture.generateCalls - before,
    expectedRequests,
    `supplied slots must not be requested: wanted ${expectedRequests}, fixture saw ${fixture.generateCalls - before}`,
  );

  const heroAsset = result.assets.find((a) => a.slot === 'hero')!;
  assert.ok(heroAsset, 'the hero slot must be filled');
  assert.equal(heroAsset.source, 'user');
  assert.equal(heroAsset.alt, 'Brand hero photo');
  assert.equal(heroAsset.credit, 'Studio');
  assert.equal(heroAsset.license, 'CC-BY-4.0');
  assert.equal(heroAsset.nativeWidth, 1, 'intrinsic size is read from the file');
  assert.equal(result.assets.filter((a) => a.slot === 'hero').length, 1, 'one asset per slot');

  const generated = result.assets.filter((a) => a.source === 'generated');
  assert.equal(generated.length, expectedRequests);
  for (const g of generated) {
    assert.notEqual(g.slot, 'hero', 'generation must never overwrite a supplied slot');
    assert.notEqual(g.slot, 'gallery-1');
    assert.ok(renderable.some((r) => r.id === g.slot), `generated for a non-renderable slot ${g.slot}`);
  }
  assert.equal(result.plan.filledByUser.length, 2);
});

await test('when every renderable slot is supplied, generation is skipped entirely', async () => {
  const spec = await specFor('image-mosaic');
  const bp = resolveBlueprint('image-mosaic')!;
  const renderable = renderableSlots(bp, spec.content);
  const before = fixture.generateCalls;
  const result = await finalizeAssets(
    {
      spec,
      blueprint: bp,
      settings: { enabled: true, count: 8, preset: 'turbo' },
      userImages: renderable.map((s) => ({ slot: s.id, path: suppliedPng })),
      userImageRoot: uploadRoot,
      outDir,
      slug: 'all-supplied',
    },
    null,
  );
  assert.equal(fixture.generateCalls, before, '0 requests when nothing is unfilled');
  assert.equal(result.assets.filter((a) => a.source === 'user').length, renderable.length);
  assert.ok(
    result.notes.some((n) => /0 image requests were made/.test(n)),
    `the plan must report 0 requests: ${result.notes.join(' | ')}`,
  );
});

await test('a supplied image for a slot this layout does not render is REFUSED with a note', async () => {
  const spec = await specFor('data-metrics'); // zero slots
  const bp = resolveBlueprint('data-metrics')!;
  const result = await finalizeAssets(
    {
      spec,
      blueprint: bp,
      settings: { enabled: false, count: 0, preset: 'turbo' },
      userImages: [{ slot: 'gallery-1', path: suppliedPng }],
      userImageRoot: uploadRoot,
      outDir,
      slug: 'refused',
    },
    null,
  );
  assert.equal(result.assets.length, 0, 'the refusal must not become an asset');
  assert.ok(
    result.notes.some((n) => /ignored|renders no image slots/i.test(n)),
    `refusals are reported, not silent: ${result.notes.join(' | ')}`,
  );
});

/* ================================================================== *
 * 4. Assets land in their INTENDED slots
 * ================================================================== */
await test('every generated asset renders in its own slot, verified by data-slot', async () => {
  const spec = await specFor('image-mosaic');
  const bp = resolveBlueprint('image-mosaic')!;
  const result = await finalizeAssets(
    { spec, blueprint: bp, settings: { enabled: true, count: 4, preset: 'turbo' }, outDir, slug: 'placed' },
    null,
  );
  spec.assets = result.assets;
  const html = renderHtml(spec);
  const report = verifyAssetPlacement(html, spec.assets);
  assert.ok(
    report.ok,
    `placement failed: ${report.issues.map((i) => `${i.slot} (${i.file}): ${i.reason}`).join('; ')}`,
  );
  assert.equal(report.checked, spec.assets.filter((a) => a.slot).length, 'every slotted asset is checked');

  // And the honest negative: an asset claiming a different slot is caught.
  const wrong = spec.assets.map((a, i) => (i === 0 ? { ...a, slot: a.slot === 'hero' ? 'gallery-5' : 'hero' } : a));
  const bad = verifyAssetPlacement(html, wrong);
  assert.equal(bad.ok, false, 'a borrowed slot must be detected');
  assert.ok(bad.issues.length >= 1);
});

await test('slot-less legacy assets are reported as unverifiable rather than silently passing', () => {
  const report = verifyAssetPlacement('<div data-slot="hero"><img src="assets/x/1.png"></div>', [
    { slot: '', file: 'assets/x/1.png' } as never,
  ]);
  assert.equal(report.checked, 0, 'nothing to verify without a recorded slot');
  assert.equal(report.ok, true, 'and no false alarm either');
});

/* ================================================================== *
 * 5. Finalize through the REAL session path, then export
 * ================================================================== */
let finalizeZipSlug = '';

await test('finalizing the selected direction honours the image setting and verifies placement', async () => {
  process.env.FORGE_PROJECT = 'assetplan-suite';
  const session = await createSession(outDir, PUBLIC_DIR, {
    brief: BRIEF,
    decider: 'local',
    seed: 808,
    explore: 0.7,
    count: 6,
    noWriter: true,
  });
  // Choose a direction that actually renders slots, if one exists in the set.
  const idx = Math.max(
    0,
    session.directions.findIndex((d) => d.imageSlots.length > 0),
  );
  const chosen = session.directions[idx]!;
  const before = fixture.generateCalls;

  const result = await finalizeSession(outDir, session, 'asset-final', {
    index: idx,
    finalCopy: false,
    images: { enabled: true, count: 2, preset: 'turbo' },
    userImages: chosen.imageSlots.length
      ? [{ slot: chosen.imageSlots[0]!.id, path: suppliedPng, alt: 'Supplied slot art', credit: 'me', license: 'CC0' }]
      : [],
    userImageRoot: uploadRoot,
  });

  const wanted = Math.min(2, Math.max(0, chosen.imageSlots.length - 1));
  if (chosen.imageSlots.length === 0) {
    assert.equal(fixture.generateCalls - before, 0, 'no slots, no requests — through the session path too');
    assert.ok(result.notes.some((n) => /0 image slots/.test(n)));
  } else {
    assert.equal(fixture.generateCalls - before, wanted, `session finalize must request exactly the unfilled slots (notes: ${result.notes.join(' | ')})`);
    assert.ok(
      result.placement.ok,
      `placement issues: ${result.placement.issues.map((i) => `${i.slot} (${i.file}): ${i.reason}`).join('; ')} | ` +
        `assets: ${result.spec.assets.map((a) => `${a.slot}=${a.file}`).join(', ')} | blueprint ${chosen.blueprint} | slots ${chosen.imageSlots.map((x) => x.id).join(',')}`,
    );
    const specOnDisk = JSON.parse(await readFile(path.join(outDir, 'asset-final.spec.json'), 'utf8')) as DesignSpec;
    assert.ok(specOnDisk.assets.length >= 1);
    const supplied = specOnDisk.assets.find((a) => a.source === 'user');
    assert.ok(supplied, 'the supplied image must be in the stored spec');
    assert.equal(supplied!.alt, 'Supplied slot art');
    assert.equal(supplied!.credit, 'me');
    assert.equal(supplied!.license, 'CC0');
    assert.equal(supplied!.nativeWidth, 1, 'dimensions survive into the spec');
    const html = await readFile(path.join(outDir, 'asset-final.html'), 'utf8');
    assert.ok(verifyAssetPlacement(html, specOnDisk.assets).ok, 'stored page has every asset in its slot');
  }
  finalizeZipSlug = 'asset-final';
});

await test('the ZIP export carries assets, fonts WITH licences, and a self-contained page', async () => {
  if (!finalizeZipSlug) return skip('zip export', 'the finalize step did not complete');
  let specOnDisk: DesignSpec;
  try {
    specOnDisk = JSON.parse(await readFile(path.join(outDir, `${finalizeZipSlug}.spec.json`), 'utf8')) as DesignSpec;
  } catch {
    return skip('zip export', `no ${finalizeZipSlug}.spec.json — the finalize step did not complete`);
  }
  const zip = await buildZip(outDir, finalizeZipSlug);
  assert.ok(zip.byteLength > 1000, 'the archive must not be empty');

  if (hasUnzip) {
    const zipPath = path.join(outDir, 'export-check.zip');
    await writeFile(zipPath, zip);
    execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
    const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const expect = ['index.html', 'index.selfcontained.html', 'design.spec.json', 'README.md', 'fonts/LICENSES.md'];
    for (const e of expect) assert.ok(listing.includes(e), `export missing ${e} (have: ${listing.join(', ')})`);
    assert.ok(listing.some((l) => l.startsWith('fonts/') && l.endsWith('.woff2')), 'bundled fonts must travel');
    for (const a of specOnDisk.assets) {
      assert.ok(listing.includes(a.file), `export must carry the asset ${a.file}`);
    }
    await rm(zipPath, { force: true });
  } else {
    skip('zip listing check', 'unzip not installed');
  }

  // The self-contained page inlines what it references — fonts too.
  const selfcontained = zip.includes(Buffer.from('data:font/woff2;base64,'))
    ? 'inlined fonts'
    : zip.includes(Buffer.from('index.selfcontained.html'))
      ? 'present'
      : 'missing';
  assert.notEqual(selfcontained, 'missing', 'the self-contained entry must be in the archive');

  // The self-contained page embeds the OFL licence text with the embedded fonts.
  if (hasUnzip) {
    const zipPath = path.join(outDir, 'export-check3.zip');
    await writeFile(zipPath, zip);
    const selfcontained = execFileSync('unzip', ['-p', zipPath, 'index.selfcontained.html'], { encoding: 'utf8' });
    await rm(zipPath, { force: true });
    assert.ok(
      selfcontained.includes('TURBO SLOP — BUNDLED FONT LICENCES'),
      'the single-file export must carry the font licences with the embedded fonts (OFL)',
    );
    assert.ok(selfcontained.includes('data:font/woff2;base64,'), 'and the fonts themselves');
  }

  // Metadata documentation: the README names credits/licences for user art.
  if (specOnDisk.assets.some((a) => a.source === 'user') && hasUnzip) {
    const zipPath = path.join(outDir, 'export-check2.zip');
    await writeFile(zipPath, zip);
    const readme = execFileSync('unzip', ['-p', zipPath, 'README.md'], { encoding: 'utf8' });
    await rm(zipPath, { force: true });
    const userAsset = specOnDisk.assets.find((a) => a.source === 'user')!;
    assert.ok(
      readme.includes(`licence: ${userAsset.license}`),
      `the export README must record the supplied image licence (alt/dims/source/credit/licence travel with it)`,
    );
    assert.ok(readme.includes('dimensions: '), 'the export README records intrinsic dimensions');
    assert.ok(readme.includes('source: user'), 'the export README records the source');
  }
});

await test('content diagnostics are reported for what the inventory cannot fill', async () => {
  const spec = await specFor('event-programme');
  const bp = resolveBlueprint('event-programme')!;
  const thin = { ...spec.content!, features: [], stats: [] };
  const diagnostics = contentDiagnostics(bp, thin);
  assert.ok(
    diagnostics.some((d) => d.includes('pricing')),
    `a pricing section with no prices must surface a diagnostic: ${diagnostics.join(' | ')}`,
  );
  const modules = availableModulesOf(thin);
  assert.ok(!modules.has('pricing'), 'pricing is honestly unavailable without features+stats');
});

/* ------------------------------------------------------------------ */
if (originalImageEnv === undefined) delete process.env.FORGE_IMAGE_BASE_URL;
else process.env.FORGE_IMAGE_BASE_URL = originalImageEnv;
await fixture.close();
await rm(outDir, { recursive: true, force: true });
await rm(uploadRoot, { recursive: true, force: true });

console.log(
  failed
    ? `\n=== ${failed} FAILED, ${passed} passed${skipped ? `, ${skipped} skipped` : ''} ===\n`
    : `\nall ${passed} checks passed${skipped ? `, ${skipped} skipped` : ''}\n`,
);
if (failed) process.exit(1);
