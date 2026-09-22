/**
 * TurboSlop — bundled font pack tests.
 *
 * The pack exists so exported pages never issue a remote font request. These
 * tests protect the two things that makes that true: the referenced bytes are
 * really on disk and really woff2, and the OFL licence text really travels with
 * every family. Nothing here touches the network — the fetch is the script's
 * job; this only inspects what was committed.
 *
 * Run: npx tsx test/fonts.test.ts
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import {
  FONT_DIRECTIONS,
  FONT_PACK,
  fontDirectionFor,
  fontFaceCss,
  fontFaceCssFor,
  fontFilesFor,
  describeFontPack,
} from '../src/fonts.js';
import type { FontDirection } from '../src/fonts.js';
import { TYPEFACES } from '../src/catalog.js';

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

console.log('\n=== TurboSlop / fonts ===\n');

const FONT_DIR = new URL('../public/fonts/', import.meta.url);
const fontUrl = (name: string): URL => new URL(name, FONT_DIR);
/** Repo-root-relative paths returned by the public API. */
const rootUrl = (...parts: string[]): URL => new URL(`../${parts.join('/')}`, import.meta.url);

const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]); // 'wOF2'
const MIN_BYTES = 5 * 1024;
const MAX_PACK_BYTES = 1.5 * 1024 * 1024;

async function readFont(name: string): Promise<Buffer> {
  return readFile(fontUrl(name));
}

/* ================================================================== *
 * The files themselves
 * ================================================================== */
await test('every bundled file referenced by FONT_PACK exists on disk', async () => {
  for (const face of FONT_PACK) {
    const buf = await readFont(face.file);
    assert.ok(buf.length > 0, `${face.file} is empty`);
  }
});

await test('every bundled file is a real woff2 over 5 KB', async () => {
  for (const face of FONT_PACK) {
    const buf = await readFont(face.file);
    assert.ok(buf.length > MIN_BYTES, `${face.file} is only ${buf.length} bytes`);
    assert.ok(
      buf.subarray(0, 4).equals(WOFF2_MAGIC),
      `${face.file} does not start with the wOF2 magic bytes (got ${buf.subarray(0, 4).toString('hex')})`,
    );
  }
});

await test('each family ships exactly one distinct file, and all files are covered', async () => {
  const files = FONT_PACK.map((f) => f.file);
  assert.equal(new Set(files).size, files.length, 'two families share a file name');
  const onDisk = [...files].sort();
  const fromManifest = fontFilesFor([...FONT_DIRECTIONS])
    .map((f) => f.file)
    .sort();
  assert.deepEqual(fromManifest, onDisk, 'manifest and FONT_PACK disagree about the files');
});

await test('the pack covers every direction exactly once and has no NaN/undefined', () => {
  const directions = FONT_PACK.map((f) => f.direction);
  assert.deepEqual([...directions].sort(), [...FONT_DIRECTIONS].sort(), 'directions do not match FONT_DIRECTIONS');
  assert.equal(new Set(directions).size, FONT_DIRECTIONS.length, 'a direction is missing from the pack');
  for (const face of FONT_PACK) {
    assert.ok(face.family.length > 0 && !face.family.includes('undefined'), `${face.file} has no family`);
    const [lo, hi] = face.weightRange;
    assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && lo < hi, `bad weight range for ${face.file}`);
  }
});

/* ================================================================== *
 * Licences
 * ================================================================== */
const licences = await readFile(fontUrl('LICENSES.md'), 'utf8');

await test('LICENSES.md exists, is non-trivial, and carries the OFL text', () => {
  assert.ok(licences.length > 5000, `LICENSES.md is only ${licences.length} chars`);
  assert.match(licences, /SIL OPEN FONT LICENSE Version 1\.1/i, 'the OFL headline is missing');
  assert.match(licences, /redistribution/i, 'the redistribution notice is missing');
});

await test('LICENSES.md names every bundled family and its file', () => {
  for (const face of FONT_PACK) {
    assert.ok(licences.includes(face.family), `LICENSES.md does not name ${face.family}`);
    assert.ok(licences.includes(face.file), `LICENSES.md does not list ${face.file}`);
  }
});

await test('LICENSES.md keeps a copyright line and the OFL notice for each family', () => {
  const copyrights = licences.match(/^Copyright .+$/gm) ?? [];
  assert.ok(copyrights.length >= FONT_PACK.length, `expected ${FONT_PACK.length} copyright lines, found ${copyrights.length}`);
  const notices = licences.match(/SIL OPEN FONT LICENSE Version 1\.1/gi) ?? [];
  assert.ok(notices.length >= FONT_PACK.length, 'each family must carry its own verbatim licence');
  assert.match(licences, /unmodified/i, 'the unmodified-subset note is missing');
});

await test('every family licence is a real SPDX identifier whose text resolves', async () => {
  for (const face of FONT_PACK) {
    assert.equal(face.license.spdx, 'OFL-1.1', `${face.family} is not OFL-1.1`);
    assert.match(face.license.name, /SIL Open Font License 1\.1/);
    const text = await readFile(rootUrl(face.license.file), 'utf8');
    assert.ok(text.length > 0, `licence file ${face.license.file} is empty`);
    assert.ok(text.includes(face.family), `licence file does not mention ${face.family}`);
  }
});

/* ================================================================== *
 * Direction mapping — total over the catalog
 * ================================================================== */
await test('fontDirectionFor is total over all catalog typeface ids', () => {
  assert.ok(TYPEFACES.length >= 7, 'catalog unexpectedly lost typefaces');
  for (const t of TYPEFACES) {
    const dir = fontDirectionFor(t.id);
    assert.ok((FONT_DIRECTIONS as readonly string[]).includes(dir), `${t.id} -> invalid direction ${dir}`);
  }
});

await test('fontDirectionFor maps the known ids and defaults unknown ids to restrained', () => {
  const expected: Record<string, FontDirection> = {
    'grotesk-tight': 'poster',
    'condensed-heavy': 'poster',
    'editorial-serif': 'literary',
    'geometric-open': 'friendly',
    'rounded-friendly': 'friendly',
    'mono-technical': 'technical',
    'humanist-light': 'restrained',
  };
  for (const [id, dir] of Object.entries(expected)) {
    assert.equal(fontDirectionFor(id), dir, `${id} mapped wrong`);
  }
  assert.equal(fontDirectionFor('not-a-typeface'), 'restrained');
  assert.notEqual(fontDirectionFor('not-a-typeface'), undefined as unknown as FontDirection);
});

/* ================================================================== *
 * CSS emission
 * ================================================================== */
await test('fontFaceCss emits a complete @font-face for every direction', () => {
  for (const face of FONT_PACK) {
    const css = fontFaceCss(face.direction);
    assert.ok(css.includes('@font-face'), `${face.direction} missing @font-face`);
    assert.ok(css.includes(`font-family: '${face.family}'`), `${face.direction} missing family`);
    assert.ok(css.includes("format('woff2')"), `${face.direction} missing woff2 format`);
    assert.ok(css.includes('font-display: swap'), `${face.direction} missing font-display: swap`);
    assert.ok(css.includes('font-style: normal'), `${face.direction} missing font-style`);
    assert.ok(css.includes(`font-weight: ${face.weightRange[0]} ${face.weightRange[1]}`), `${face.direction} missing weight range`);
    assert.ok(css.includes(`url('../fonts/${face.file}')`), `${face.direction} missing local url`);
    if (face.variation) assert.ok(css.includes(`font-variation-settings: ${face.variation}`), `${face.direction} missing variation`);
    assert.ok(!css.includes('undefined') && !css.includes('NaN'), `${face.direction} output contains undefined/NaN`);
  }
});

await test('fontFaceCss honours a custom basePath', () => {
  const css = fontFaceCss('poster', 'assets/fonts/');
  assert.ok(css.includes("url('assets/fonts/archivo-latin-var.woff2')"), 'custom basePath ignored');
  assert.ok(css.includes("url('../fonts/archivo-latin-var.woff2')") === false, 'default path leaked in');
});

await test('fontFaceCss returns an empty string for an unknown direction', () => {
  const unknown = 'mystery' as string;
  assert.equal(fontFaceCss(unknown as FontDirection), '');
});

await test('fontFaceCssFor emits only the requested directions', () => {
  const css = fontFaceCssFor(['poster', 'literary']);
  assert.ok(css.includes('archivo-latin-var.woff2'));
  assert.ok(css.includes('source-serif-4-latin-var.woff2'));
  assert.equal((css.match(/@font-face/g) ?? []).length, 2, 'expected exactly two @font-face blocks');
  assert.ok(!css.includes('nunito-latin-var.woff2'), 'friendly leaked in');
  assert.ok(!css.includes('jetbrains-mono-latin-var.woff2'), 'technical leaked in');
  assert.ok(!css.includes('inter-latin-var.woff2'), 'restrained leaked in');
});

await test('fontFaceCssFor dedupes repeated directions and tolerates empty input', () => {
  const css = fontFaceCssFor(['poster', 'poster', 'poster']);
  assert.equal((css.match(/@font-face/g) ?? []).length, 1, 'duplicate direction emitted twice');
  assert.equal(fontFaceCssFor([]), '');
});

/* ================================================================== *
 * Export manifest
 * ================================================================== */
await test('fontFilesFor returns only existing files with correct byte counts', async () => {
  const entries = fontFilesFor([...FONT_DIRECTIONS]);
  assert.equal(entries.length, FONT_PACK.length);
  for (const entry of entries) {
    assert.ok(entry.path.startsWith('public/fonts/'), `unexpected path ${entry.path}`);
    const info = await stat(rootUrl(entry.path));
    assert.equal(info.size, entry.bytes, `${entry.file} byte count is stale`);
    const buf = await readFile(rootUrl(entry.path));
    assert.equal(buf.length, entry.bytes, `${entry.file} read length differs from manifest`);
  }
});

await test('fontFilesFor([]) is empty and ignores unknown directions', () => {
  assert.deepEqual(fontFilesFor([]), []);
  const unknown = 'mystery' as string;
  assert.deepEqual(fontFilesFor([unknown as FontDirection]), []);
});

/* ================================================================== *
 * Size + summary
 * ================================================================== */
await test('the whole pack stays under 1.5 MB', async () => {
  let total = 0;
  for (const face of FONT_PACK) total += (await stat(fontUrl(face.file))).size;
  assert.ok(total < MAX_PACK_BYTES, `pack is ${(total / 1024).toFixed(1)} KB, over the 1.5 MB budget`);
  assert.ok(total > 0, 'pack is empty');
});

await test('describeFontPack names every family without NaN or undefined', () => {
  const summary = describeFontPack();
  assert.match(summary, /OFL/);
  for (const face of FONT_PACK) assert.ok(summary.includes(face.family), `summary omits ${face.family}`);
  assert.ok(!summary.includes('undefined') && !summary.includes('NaN'), 'summary contains undefined/NaN');
});

console.log(`\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
