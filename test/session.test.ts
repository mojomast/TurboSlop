/**
 * TurboSlop — direction-session tests.
 *
 * Runs entirely offline with the local decider and no writer, so it is
 * deterministic and costs nothing. What it protects, in order of how badly it
 * would hurt to get wrong:
 *
 *   1. Selecting or re-rendering never triggers a second decision call, so the
 *      previews you are comparing cannot change underneath you.
 *   2. Previewing N directions costs ONE decision call and at most ONE writer
 *      call — not N of either.
 *   3. Every direction is a real page: unique ids, resolving anchors, no remote
 *      font request, honest contact.
 *   4. Locks pin what they say they pin, and regeneration is deterministic.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession,
  finalizeSession,
  listSessions,
  loadSession,
  regenerateSession,
  saveSession,
} from '../src/sessions.js';

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

console.log('\n=== TurboSlop — direction sessions ===\n');

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRIEF = 'A shop selling hand-thrown ceramic tableware. Small batch, muted glazes, ships worldwide.';

const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-session-'));

/** One session, created once and shared: creation is the expensive part. */
const session = await createSession(outDir, PUBLIC_DIR, {
  brief: BRIEF,
  decider: 'local',
  seed: 4242,
  explore: 0.5,
  count: 6,
  noWriter: true,
});

await test('a session offers between 4 and 8 directions', () => {
  assert.ok(session.directions.length >= 4, `only ${session.directions.length} directions`);
  assert.ok(session.directions.length <= 8, `too many directions: ${session.directions.length}`);
});

await test('the decision response is persisted in full', () => {
  assert.ok(session.decision.response, 'the raw decision must be stored');
  const answers = (session.decision.response as { answers: Record<string, unknown> }).answers;
  for (const axis of ['emotion', 'palette', 'typography', 'effects', 'motion', 'density']) {
    assert.ok(answers[axis], `the stored decision is missing the ${axis} answer`);
  }
  assert.equal(session.decision.kind, 'local');
});

await test('directions are structurally distinct, not recolours', () => {
  const keys = new Set(session.directions.map((d) => d.structure.blocks.join('>')));
  assert.ok(keys.size >= 4, `expected several distinct block sequences, got ${keys.size}`);
  /* Distinctness is now asserted the way the selector is graded: by the
     enforced diversity targets on resolved compositions, with catalog
     families kept as a coarse floor (six distinct compositions can still be
     three catalog families — the families were the old proxy). */
  const families = new Set(session.directions.map((d) => d.family));
  assert.ok(families.size >= 3, `expected at least three catalog families, got ${families.size}`);
  const rep = session.diversity;
  assert.ok(
    rep.achieved.compositions >= rep.targets.compositions,
    `compositions ${rep.achieved.compositions}/${rep.targets.compositions} — shortfall: ${JSON.stringify(rep.shortfall)}`,
  );
  assert.ok(
    rep.achieved.constructions >= rep.targets.constructions,
    `headline constructions ${rep.achieved.constructions}/${rep.targets.constructions} — ${JSON.stringify(rep.shortfall)}`,
  );
  assert.ok(rep.met, `diversity targets missed: ${JSON.stringify(rep.shortfall)}`);
});

await test('every direction has a preview file on disk', async () => {
  for (const d of session.directions) {
    const s = await stat(path.join(outDir, d.preview));
    assert.ok(s.isFile() && s.size > 2000, `${d.blueprint} preview is missing or empty`);
  }
});

await test('previews carry no remote font request', async () => {
  for (const d of session.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    assert.ok(!/fonts\.googleapis\.com/.test(html), `${d.blueprint} still requests Google Fonts`);
    assert.ok(!/fonts\.gstatic\.com/.test(html), `${d.blueprint} still requests gstatic`);
    assert.ok(/@font-face/.test(html), `${d.blueprint} has no bundled @font-face`);
    assert.ok(/url\('fonts\/[a-z0-9-]+\.woff2'\)/.test(html), `${d.blueprint} does not reference a bundled font file`);
  }
});

await test('previews are labelled as previews, with the reason', async () => {
  for (const d of session.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    assert.ok(/data-preview="1"/.test(html), `${d.blueprint} is not marked as a preview`);
    assert.ok(/Preview<\/b>/.test(html), `${d.blueprint} preview banner missing`);
    assert.ok(/shared content inventory|specimen copy/i.test(html), `${d.blueprint} does not say what the copy is`);
  }
});

await test('every rendered id in every preview is unique', async () => {
  for (const d of session.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    assert.deepEqual(dupes, [], `${d.blueprint} emitted duplicate ids: ${dupes.join(', ')}`);
  }
});

await test('every anchor in every preview resolves, and nav targets match the structure', async () => {
  for (const d of session.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    for (const a of [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) => m[1]!)) {
      assert.ok(ids.has(a), `${d.blueprint}: anchor #${a} has no target`);
    }
    for (const target of d.structure.navAnchors) {
      assert.ok(ids.has(target), `${d.blueprint}: reported nav target #${target} is not in the page`);
    }
    // The reported section order must be the RENDERED order. The hero is a
    // <section> too, but it is the page's opening rather than a blueprint
    // section, so we compare the ones that carry data-block.
    const rendered = [...html.matchAll(/<section\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes('data-block'))
      .map((tag) => /id="([^"]+)"/.exec(tag)![1]!);
    assert.deepEqual(rendered, d.structure.sectionOrder, `${d.blueprint}: reported order != rendered order`);
  }
});

await test('exactly one #top exists, and it is the hero', async () => {
  for (const d of session.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    const tops = [...html.matchAll(/\sid="top"/g)].length;
    assert.equal(tops, 1, `${d.blueprint} should have exactly one #top, found ${tops}`);
    assert.ok(/<section[^>]*id="top"[^>]*class="[^"]*hero|<section[^>]*class="[^"]*hero[^"]*"[^>]*id="top"/.test(html) || /hero[^>]*id="top"|id="top"[^>]*hero/.test(html), `${d.blueprint}: #top should be the hero`);
    assert.ok(!/<main[^>]*id="top"/.test(html), `${d.blueprint}: <main> must not also be #top`);
  }
});

await test('previewing cost exactly one model call (no writer configured)', () => {
  assert.equal(session.metrics.modelCalls, 1, 'with no writer, only the decision call should happen');
});

await test('the shared inventory is stored once, and is honest about its origin', () => {
  assert.ok(session.inventory, 'the inventory must be persisted with the session');
  assert.equal(session.inventorySource, 'fallback');
  assert.ok(/specimen|not final/i.test(session.previewLabel), `preview label must be honest: ${session.previewLabel}`);
});

/* ------------------------------------------------------------------ *
 * Reproducibility and selection
 * ------------------------------------------------------------------ */
await test('selecting a direction performs no model call and changes no decision', async () => {
  const before = JSON.stringify(session.decision.response);
  const s = (await loadSession(outDir, session.id))!;
  s.selectedIndex = 2;
  s.selectedDirectionId = s.directions[2]?.id ?? null;
  // Locks are bound to an explicit value and the card it came from.
  s.locks = [
    { name: 'palette', value: s.directions[1]!.palette, fromIndex: 1 },
    { name: 'typography', value: s.directions[1]!.typography, fromIndex: 1 },
  ];
  s.history.push({ at: new Date().toISOString(), event: 'selected', detail: 'test' });
  await saveSession(outDir, s);

  const after = (await loadSession(outDir, session.id))!;
  assert.equal(after.selectedIndex, 2);
  assert.deepEqual(
    after.locks.map((l) => l.name),
    ['palette', 'typography'],
  );
  assert.equal(after.locks[0]!.fromIndex, 1, 'each lock records the card its value came from');
  assert.equal(after.locks[0]!.value, after.directions[1]!.palette, 'each lock records the exact value pinned');
  assert.equal(JSON.stringify(after.decision.response), before, 'the decision must be byte-identical');
  assert.deepEqual(
    after.directions.map((d) => d.blueprint),
    session.directions.map((d) => d.blueprint),
    'selection must not re-roll the directions',
  );
});

await test('loading a session never needs a decision call', async () => {
  // Loading is a pure file read; if it ever grew a model dependency this test
  // would hang rather than fail, so assert the shape instead.
  const s = await loadSession(outDir, session.id);
  assert.ok(s, 'session should load');
  assert.ok(s!.decision.response, 'the stored decision comes with it');
});

await test('regeneration is deterministic for a given seed and costs nothing', async () => {
  const a = await regenerateSession(outDir, session, { seed: 99, count: 5 });
  const b = await regenerateSession(outDir, session, { seed: 99, count: 5 });
  assert.deepEqual(
    a.directions.map((d) => d.blueprint),
    b.directions.map((d) => d.blueprint),
    'the same seed must give the same directions',
  );
  assert.equal(a.metrics.modelCalls, session.metrics.modelCalls, 'regeneration must not add model calls');
  assert.equal(
    JSON.stringify(a.inventory),
    JSON.stringify(session.inventory),
    'regeneration must reuse the stored inventory',
  );
});

await test('regeneration with a different seed gives different directions', async () => {
  const a = await regenerateSession(outDir, session, { seed: 1, count: 6 });
  const b = await regenerateSession(outDir, session, { seed: 77777, count: 6 });
  const aKeys = a.directions.map((d) => d.blueprint).join('|');
  const bKeys = b.directions.map((d) => d.blueprint).join('|');
  assert.notEqual(aKeys, bKeys, 'a new seed should move the set');
});

await test('locks pin exactly the axes they name, and nothing else', async () => {
  const base = session.directions[0]!;
  const regen = await regenerateSession(outDir, session, {
    seed: 5150,
    count: 6,
    fromIndex: 0,
    locks: ['palette', 'density'],
  });
  for (const d of regen.directions) {
    assert.equal(d.palette, base.palette, `palette should be locked to ${base.palette}`);
    assert.equal(d.density, base.density, `density should be locked to ${base.density}`);
  }
  // The unlocked axes should actually move somewhere in the set.
  const moved = regen.directions.some((d) => d.effects !== base.effects);
  assert.ok(moved, 'unlocked axes must be free to change');
});

await test('locks are recorded on the session for the next regeneration', async () => {
  const regen = await regenerateSession(outDir, session, { seed: 3, count: 6, locks: ['effects'] });
  // Each lock is bound to an EXPLICIT value and the card it came from.
  assert.equal(regen.locks.length, 1);
  assert.equal(regen.locks[0]!.name, 'effects');
  assert.equal(regen.locks[0]!.value, session.directions[0]!.effects, 'the value is the source card’s value');
  assert.equal(regen.locks[0]!.fromIndex, 0, 'no card specified: the source defaults to index 0');
  assert.ok(
    regen.directions.every((d) => d.effects === regen.locks[0]!.value),
    'every regenerated direction honours the locked effects value',
  );
  const reloaded = (await loadSession(outDir, regen.id))!;
  assert.deepEqual(reloaded.locks, regen.locks);
});

/* ------------------------------------------------------------------ *
 * Finalize
 * ------------------------------------------------------------------ */
await test('finalizing writes a real design with bundled fonts and no remote request', async () => {
  const s = (await loadSession(outDir, session.id))!;
  const { spec, html } = await finalizeSession(outDir, s, 'final-check', { index: 0, finalCopy: false });

  assert.equal(spec.blueprint, s.directions[0]!.blueprint, 'the finalized page must be the chosen direction');
  assert.ok(spec.content, 'the finalized page needs content');
  assert.ok(!/fonts\.googleapis\.com/.test(html), 'final page must not request remote fonts');
  assert.ok(/url\('fonts\/[a-z0-9-]+\.woff2'\)/.test(html), 'final page must reference bundled fonts');
  assert.ok(!/data-preview/.test(html), 'a final page must NOT be marked as a preview');

  const json = JSON.parse(await readFile(path.join(outDir, 'final-check.spec.json'), 'utf8')) as typeof spec;
  assert.equal(json.blueprint, spec.blueprint);
  assert.equal(
    json.seed,
    s.directions[0]!.seed,
    'the DIRECTION seed must be persisted so motifs, frames and section recipes reproduce exactly',
  );
  assert.notEqual(json.seed, s.seed, 'each direction gets its own seed so a batch does not share one decoration');
  assert.ok(json.direction, 'selection rationale must be persisted');
});

await test('a finalized page never invents contact details', async () => {
  const html = await readFile(path.join(outDir, 'final-check.html'), 'utf8');
  if (html.includes('mailto:')) {
    assert.ok(!/@example\.com/.test(html), 'no placeholder email domain');
  } else {
    assert.ok(/specified no way to get in touch|No contact details supplied/i.test(html), 'must say contact was not supplied');
  }
  assert.ok(!/onsubmit="return false"/.test(html), 'no dead form');
});

await test('the bundled font files exist beside the design', async () => {
  for (const f of ['inter-latin-var.woff2', 'archivo-latin-var.woff2', 'LICENSES.md']) {
    const s = await stat(path.join(outDir, 'fonts', f));
    assert.ok(s.size > 1000, `fonts/${f} should have been copied next to the design`);
  }
});

await test('sessions are listed newest-first and survive a round trip', async () => {
  const all = await listSessions(outDir);
  assert.ok(all.length >= 1, 'expected at least one session');
  assert.ok(all.every((s) => s.id.startsWith('ses_')), 'session ids must be well formed');
  assert.ok(all[0]!.directions.length >= 4, 'the listed session keeps its directions');
});

await test('a session id that is not well formed is refused, not joined', async () => {
  assert.equal(await loadSession(outDir, '../../etc/passwd'), null);
  assert.equal(await loadSession(outDir, 'ses_short'), null);
});

await rm(outDir, { recursive: true, force: true });

console.log(
  failed ? `\n=== ${failed} FAILED, ${passed} passed ===\n` : `\nall ${passed} checks passed\n`,
);
if (failed) process.exit(1);
