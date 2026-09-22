/**
 * TurboSlop — scoped revision.
 *
 * The regression this reproduces: an OFFLINE request to fix punctuation came
 * back as a different page — the blueprint had changed from `data-metrics` to
 * `story-origin`, and palette, typography and motion changed with it, because
 * revision re-ran the whole decision/selection pipeline.
 *
 * What must hold:
 *   - copy-only revision preserves the resolved visual spec: blueprint,
 *     tokens, seed, assets, decisions — all byte-identical; with no writer the
 *     copy is left alone and SAYS SO (honest, not silently "regenerated");
 *   - a visual revision touches only the axes the request names and preserves
 *     everything unrelated (content, seed, assets, unmentioned axes);
 *   - revision never re-decides: the stored decision is untouched;
 *   - revision and "explore new directions" are different endpoints — this
 *     suite only ever calls `reviseSession`.
 *
 * Offline: local decider, no writer, no network.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSession, finalizeSession, loadSession, reviseSession } from '../src/sessions.js';
import { classifyRevision } from '../src/revise.js';

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

console.log('\n=== TurboSlop — scoped revision ===\n');

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRIEF = 'An API for satellite imagery pricing. Docs-first, high volume, enterprise SLAs.';
const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-revise-'));

const originalProject = process.env.FORGE_PROJECT;
process.env.FORGE_PROJECT = 'revise-suite';

const session = await createSession(outDir, PUBLIC_DIR, {
  brief: BRIEF,
  decider: 'local',
  seed: 606,
  explore: 0.5,
  count: 6,
  noWriter: true,
});

/* Pick a direction whose blueprint is a real data-led page so the original
   `data-metrics → story-origin` swap is exactly reproducible. */
const pickIndex = Math.max(
  0,
  session.directions.findIndex((d) => d.blueprint.startsWith('data-')),
);
await finalizeSession(outDir, session, 'revise-parent', { index: pickIndex, finalCopy: false });
const reloaded = (await loadSession(outDir, session.id))!;

const parentSpec = JSON.parse(await readFile(path.join(outDir, 'revise-parent.spec.json'), 'utf8'));
const parentHtml = await readFile(path.join(outDir, 'revise-parent.html'), 'utf8');
const decisionBefore = JSON.stringify(reloaded.decision.response);

const blueprintAttr = (html: string) => /data-blueprint="([^"]+)"/.exec(html)![1]!;

/* ================================================================== *
 * Classification
 * ================================================================== */
await test('scope classification defaults to COPY: a wording request can never reach a visual axis', () => {
  assert.equal(classifyRevision('Fix the punctuation in the headline, it reads oddly.'), 'copy');
  assert.equal(classifyRevision('Please reword the lede and tighten the spelling.'), 'copy');
  assert.equal(classifyRevision('Change the tagline wording and the CTA copy.'), 'copy');
  assert.equal(classifyRevision('Make the headline say something else entirely.'), 'copy');
  // A vague request is still copy: preserving the design is the safe default.
  assert.equal(classifyRevision('make it feel more premium'), 'copy');
  // Visual vocabulary is required before any visual axis may move.
  assert.equal(classifyRevision('make the palette darker'), 'visual');
  assert.equal(classifyRevision('switch to a serif typeface'), 'visual');
  assert.equal(classifyRevision('slow the motion down and add more whitespace'), 'visual');
  assert.equal(classifyRevision('reword the lede AND make the palette darker'), 'mixed');
});

/* ================================================================== *
 * Copy-only revision, offline
 * ================================================================== */
let copySlug = '';
await test('an offline copy-only revision changes NO visual property', async () => {
  const s = (await loadSession(outDir, session.id))!;
  const result = await reviseSession(outDir, s, {
    instructions: 'Fix the punctuation in the headline — it reads oddly, and reword the lede slightly.',
  });

  assert.equal(result.scope, 'copy', 'punctuation/wording must classify as copy');
  assert.equal(result.modelCalls, 0, 'offline copy revision spends no model call');
  assert.ok(
    result.notes.some((n) => /copy left unchanged.*no writer/i.test(n)),
    `offline must say the copy was left alone, honestly. notes: ${result.notes.join(' | ')}`,
  );

  /* ---- the resolved visual spec, preserved verbatim ---- */
  assert.equal(result.spec.blueprint, parentSpec.blueprint, 'THE REGRESSION: blueprint must not change');
  assert.equal(
    blueprintAttr(result.html),
    blueprintAttr(parentHtml),
    `data-blueprint changed from ${blueprintAttr(parentHtml)} to ${blueprintAttr(result.html)}`,
  );
  assert.deepEqual(result.spec.tokens, parentSpec.tokens, 'every visual token must be preserved');
  for (const axis of ['palette', 'typography', 'motion', 'effects', 'density', 'layout', 'emotion'] as const) {
    assert.equal(
      result.spec.tokens[axis],
      parentSpec.tokens[axis],
      `${axis} changed during a COPY revision — this is the exact finding`,
    );
  }
  assert.equal(result.spec.seed, parentSpec.seed, 'seed must be preserved');
  assert.deepEqual(result.spec.assets, parentSpec.assets, 'assets must be preserved');
  assert.deepEqual(
    result.spec.decisions.map((d: { picked: string }) => d.picked),
    parentSpec.decisions.map((d: { picked: string }) => d.picked),
    'no decision may be re-run or altered',
  );
  assert.deepEqual(result.spec.content, parentSpec.content, 'offline: the copy itself is unchanged too');
  assert.equal(result.spec.composite.normalized, parentSpec.composite.normalized, 'composite must not move');
  assert.notEqual(result.slug, 'revise-parent', 'a revision is a new file, never an overwrite');
  copySlug = result.slug;
});

await test('revision never re-decides: the stored decision is byte-identical afterwards', async () => {
  const s = (await loadSession(outDir, session.id))!;
  await reviseSession(outDir, s, { instructions: 'Rename the brand slightly for consistency.' });
  const after = (await loadSession(outDir, session.id))!;
  assert.equal(JSON.stringify(after.decision.response), decisionBefore, 'the decision must not be touched');
  assert.equal(after.selectedIndex, s.selectedIndex, 'revision must not re-run selection');
  assert.equal(after.finalSlug, s.finalSlug, 'revision must not re-point the finalized design');
});

await test('the finalized parent is untouched by the revision', async () => {
  const now = JSON.parse(await readFile(path.join(outDir, 'revise-parent.spec.json'), 'utf8'));
  assert.deepEqual(now, parentSpec, 'the parent design file must not be mutated');
  const revision = JSON.parse(await readFile(path.join(outDir, `${copySlug}.spec.json`), 'utf8'));
  assert.equal(revision.blueprint, parentSpec.blueprint);
});

await test('revision requires a finalized design first', async () => {
  const s = (await loadSession(outDir, session.id))!;
  const unfinalized = { ...s, finalSlug: undefined, revisions: s.revisions };
  await assert.rejects(
    () => reviseSession(outDir, unfinalized as typeof s, { instructions: 'fix the punctuation' }),
    /finalize the direction first/,
  );
});

/* ================================================================== *
 * Visual revision — scoped to the named axes
 * ================================================================== */
await test('a visual revision touches only the axes the request names', async () => {
  const s = (await loadSession(outDir, session.id))!;
  const beforePalette = parentSpec.tokens.palette;
  const result = await reviseSession(outDir, s, {
    instructions: 'Make the palette darker — the light ground is too washed out on a projector.',
  });

  assert.equal(result.scope, 'visual');
  assert.notEqual(result.spec.tokens.palette, beforePalette, 'the requested axis must move');
  assert.ok(result.notes.some((n) => n.startsWith('palette:')), `the change must be reported: ${result.notes.join(' | ')}`);

  // Everything the request did NOT name is preserved.
  assert.equal(result.spec.blueprint, parentSpec.blueprint, 'blueprint is unrelated and must be preserved');
  assert.equal(result.spec.seed, parentSpec.seed, 'seed is unrelated and must be preserved');
  assert.deepEqual(result.spec.content, parentSpec.content, 'content is unrelated in a visual edit');
  assert.deepEqual(result.spec.assets, parentSpec.assets, 'assets are unrelated in a visual edit');
  for (const axis of ['typography', 'motion', 'effects', 'density', 'layout', 'emotion'] as const) {
    assert.equal(result.spec.tokens[axis], parentSpec.tokens[axis], `${axis} was not named — must not move`);
  }
  assert.ok(
    result.notes.some((n) => /copy unchanged/.test(n)),
    'a visual edit must say the copy was left alone',
  );
  // The decision record follows the token honestly, with provenance.
  const d = result.spec.decisions.find((x) => x.axis === 'palette')!;
  assert.equal(d.picked, result.spec.tokens.palette, 'the record must show the value the page uses');
  assert.match(d.rationale, /Revised to/);
  const html = await readFile(path.join(outDir, `${result.slug}.html`), 'utf8');
  assert.ok(html.includes(`data-palette="${result.spec.tokens.palette}"`), 'the page must render the new palette');
  assert.equal(blueprintAttr(html), blueprintAttr(parentHtml), 'data-blueprint must be unchanged');
});

await test('a visual request that matches no catalog axis changes nothing and says why', async () => {
  const s = (await loadSession(outDir, session.id))!;
  const result = await reviseSession(outDir, s, {
    instructions: 'Make it feel like a crisp autumn morning.',
  });
  // "autumn" has no palette rule… but classifyRevision sees no visual
  // vocabulary, so this is a COPY-scope request: everything visual preserved.
  assert.equal(result.scope, 'copy');
  assert.deepEqual(result.spec.tokens, parentSpec.tokens, 'no visual axis may move without visual vocabulary');
});

await test('the session records revisions without losing its batches or versions', async () => {
  const s = (await loadSession(outDir, session.id))!;
  assert.ok((s.revisions ?? 0) >= 3, `revisions counted, got ${s.revisions}`);
  assert.equal(s.versions.length, 0, 'revision must not touch batch history');
  assert.ok(s.history.some((e) => e.event === 'revised'), 'the revision is on the timeline');
});

if (originalProject === undefined) delete process.env.FORGE_PROJECT;
else process.env.FORGE_PROJECT = originalProject;
await rm(outDir, { recursive: true, force: true });

console.log(failed ? `\n=== ${failed} FAILED, ${passed} passed ===\n` : `\nall ${passed} checks passed\n`);
if (failed) process.exit(1);
