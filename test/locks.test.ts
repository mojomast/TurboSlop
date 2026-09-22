/**
 * TurboSlop — selection, locks, regeneration and batch immutability.
 *
 * Each test reproduces a specific review finding:
 *
 *   1. `regenerateSession` accepted a blueprint lock but did not apply it.
 *   2. A lock checkbox on one card could use values from another card.
 *   3. Unknown lock names were silently dropped; incompatible combinations
 *      were discovered only as wrong output.
 *   4. Regeneration overwrote the previous batch's preview files, so saved
 *      links broke and backtracking was impossible.
 *
 * Offline: local decider, no writer, no network, no image service.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LockError,
  assertLocksAreCompatible,
  createSession,
  loadSession,
  normalizeLocks,
  regenerateSession,
  saveSession,
  type DirectionSession,
} from '../src/sessions.js';
import { LOCK_NAMES, baseOf } from '../src/directions.js';
import type { SessionLock } from '../src/sessions.js';

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

console.log('\n=== TurboSlop — locks, regeneration, batch versions ===\n');

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRIEF = 'A three-day independent games festival in Rotterdam. Talks, a tournament, and a late-night arcade.';
const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-locks-'));

const originalProject = process.env.FORGE_PROJECT;
process.env.FORGE_PROJECT = 'locks-suite';

const session = await createSession(outDir, PUBLIC_DIR, {
  brief: BRIEF,
  decider: 'local',
  seed: 31337,
  explore: 0.8,
  count: 6,
  noWriter: true,
});

const sha = async (p: string) => createHash('sha256').update(await readFile(path.join(outDir, p))).digest('hex');

/* ================================================================== *
 * Lock binding — explicit values, explicit sources
 * ================================================================== */
await test('a lock binds to the card it came from, not to whatever is selected', () => {
  const s: DirectionSession = { ...session, selectedIndex: 0 };
  const card = 3;
  const locks = normalizeLocks(s, [{ name: 'palette', fromIndex: card }], s.selectedIndex!);
  assert.equal(locks[0]!.fromIndex, card);
  assert.equal(
    locks[0]!.value,
    s.directions[card]!.palette,
    'the pinned value must be card 3’s palette even though card 1 is selected',
  );

  // An explicit value must MATCH the source card, or the two disagree.
  assert.throws(
    () => normalizeLocks(s, [{ name: 'palette', value: 'not-a-palette', fromIndex: card }], s.selectedIndex!),
    /claims value/,
    'a lock claiming a value the source card does not have must be refused',
  );
});

await test('unknown lock names are rejected with the list of what CAN be locked', () => {
  assert.throws(
    () => normalizeLocks(session, [{ name: 'vibes' }], 0),
    (err: unknown) => {
      assert.ok(err instanceof LockError, 'must be a LockError');
      assert.match(err.message, /unknown lock "vibes"/);
      for (const name of LOCK_NAMES) assert.ok(err.message.includes(name), `message must list ${name}`);
      assert.match(err.message, /turboslop\/directions@/, 'the message must name the selection version');
      return true;
    },
  );
});

await test('a lock with no source direction is refused, not guessed', () => {
  const noSelection: DirectionSession = { ...session, selectedIndex: null };
  assert.throws(() => normalizeLocks(noSelection, [{ name: 'palette' }], null), /no source direction/);
});

await test('blueprint and composition locks are different, and incompatible ones explain why', () => {
  const a = session.directions[0]!;
  const b = session.directions[1]!;
  assert.equal(baseOf(a.blueprint), a.baseBlueprint, 'baseOf resolves the catalog blueprint of a variant');

  // A composition lock from card 0 with a blueprint lock from card 1: only an
  // error if they are actually different families.
  const compo: SessionLock = { name: 'composition', value: a.blueprint, fromIndex: 0 };
  const blueOther: SessionLock = { name: 'blueprint', value: baseOf(b.blueprint), fromIndex: 1 };
  if (baseOf(a.blueprint) !== baseOf(b.blueprint)) {
    assert.throws(
      () => assertLocksAreCompatible([compo, blueOther]),
      /incompatible locks.*belongs to blueprint/s,
      'cross-family composition+blueprint locks must be explained',
    );
  }
  const sameFamily: SessionLock[] = [
    { name: 'composition', value: a.blueprint, fromIndex: 0 },
    { name: 'blueprint', value: a.baseBlueprint, fromIndex: 0 },
  ];
  assertLocksAreCompatible(sameFamily); // must not throw

  assert.throws(
    () => assertLocksAreCompatible([{ name: 'palette', value: 'nope', fromIndex: 0 }]),
    /not in the catalog/,
  );
});

/* ================================================================== *
 * Constrained regeneration — the lock is APPLIED
 * ================================================================== */
await test('a blueprint lock is actually applied during constrained regeneration', async () => {
  const source = session.directions[2]!;
  const regen = await regenerateSession(outDir, session, {
    seed: 1001,
    count: 6,
    fromIndex: 2,
    locks: [{ name: 'blueprint', value: source.baseBlueprint, fromIndex: 2 }],
  });
  assert.ok(regen.directions.length >= 4);
  for (const d of regen.directions) {
    assert.equal(
      d.baseBlueprint,
      source.baseBlueprint,
      `blueprint lock not applied: ${d.id} resolved to ${d.baseBlueprint}, expected ${source.baseBlueprint}`,
    );
  }
  assert.equal(regen.locks[0]!.name, 'blueprint');
  assert.equal(regen.locks[0]!.value, source.baseBlueprint);
});

await test('a composition lock pins the EXACT layout — base plus variant', async () => {
  const source = session.directions[1]!;
  const regen = await regenerateSession(outDir, session, {
    seed: 1002,
    count: 5,
    fromIndex: 1,
    locks: [{ name: 'composition', value: source.blueprint, fromIndex: 1 }],
  });
  for (const d of regen.directions) {
    assert.equal(d.blueprint, source.blueprint, `composition lock not applied: ${d.blueprint}`);
  }
});

await test('styling locks from one card survive regeneration with that card’s exact values', async () => {
  const source = session.directions[4] ?? session.directions[1]!;
  const idx = session.directions.indexOf(source);
  const regen = await regenerateSession(outDir, session, {
    seed: 1003,
    count: 6,
    fromIndex: idx,
    locks: [
      { name: 'palette', fromIndex: idx },
      { name: 'typography', fromIndex: idx },
      { name: 'motion', fromIndex: idx },
    ],
  });
  for (const d of regen.directions) {
    assert.equal(d.palette, source.palette, `palette lock drifted to ${d.palette}`);
    assert.equal(d.typography, source.typography, `typography lock drifted to ${d.typography}`);
    assert.equal(d.motion, source.motion, `motion lock drifted to ${d.motion}`);
  }
  // Unlocked properties are free to move — at least one should differ from the source.
  const allSameStructure = regen.directions.every((d) => d.blueprint === source.blueprint);
  const allSameEffects = regen.directions.every((d) => d.effects === source.effects);
  assert.ok(
    !(allSameStructure && allSameEffects),
    'only unlocked properties may re-roll, but everything being frozen means the search was not constrained — it was copied',
  );
  // fit/similarity are recomputed for the constrained set, never carried over.
  assert.ok(regen.diversity.achieved.directions === regen.directions.length, 'diversity report must be recomputed');
  for (const d of regen.directions) assert.ok(Number.isFinite(d.fit) && d.fit > 0, 'fit must be recomputed and finite');
  assert.ok(
    regen.directions.some((d) => d.novelty <= 1),
    'separation is re-measured inside the new set',
  );
});

await test('an impossible lock combination fails with an explanation, not an empty set', async () => {
  // Composition of one blueprint + blueprint of a different family.
  const a = session.directions[0]!;
  const other = session.directions.find((d) => d.baseBlueprint !== a.baseBlueprint)!;
  const locks: SessionLock[] = [
    { name: 'composition', value: a.blueprint, fromIndex: 0 },
    { name: 'blueprint', value: other.baseBlueprint, fromIndex: session.directions.indexOf(other) },
  ];
  await assert.rejects(
    async () => {
      assertLocksAreCompatible(locks);
      await regenerateSession(outDir, session, { seed: 1004, locks: locks.map((l) => ({ name: l.name, value: l.value, fromIndex: l.fromIndex })) });
    },
    (err: unknown) => {
      assert.ok(err instanceof LockError);
      assert.match(err.message, /incompatible|no direction satisfies/);
      return true;
    },
  );
});

await test('regeneration with an unknown lock name fails loudly through the same path the API uses', async () => {
  await assert.rejects(() => normalizeAndRegen(session, [{ name: 'vibes' }]), /unknown lock/);
});
async function normalizeAndRegen(
  s: DirectionSession,
  locks: { name: string; value?: string; fromIndex?: number }[],
): Promise<unknown> {
  const normalized = normalizeLocks(s, locks, 0);
  return regenerateSession(outDir, s, {
    seed: 1005,
    locks: normalized.map((l) => ({ name: l.name, value: l.value, fromIndex: l.fromIndex })),
  });
}

/* ================================================================== *
 * Immutable previous batches
 * ================================================================== */
const beforeBatch = session.batch;
const beforeDir = session.previewDir;
const beforePreviews = await Promise.all(session.directions.map((d) => sha(d.preview)));
const beforeDirections = JSON.parse(JSON.stringify(session.directions));

const regen = await regenerateSession(outDir, session, { seed: 2001, count: 6 });

await test('the previous batch is preserved immutably — previews, metadata and links', async () => {
  assert.equal(regen.batch, beforeBatch + 1, 'batch counter advances');
  assert.equal(regen.versions.length, 1, 'the outgoing batch is kept as a version');
  const version = regen.versions[0]!;
  assert.equal(version.batch, beforeBatch);
  assert.equal(version.previewDir, beforeDir, 'the archived preview directory is the one that was live');
  assert.deepEqual(
    version.directions.map((d) => d.id),
    beforeDirections.map((d: { id: string }) => d.id),
    'the archived batch keeps its own directions',
  );

  // Every old preview file is byte-identical after regeneration.
  for (const [i, d] of session.directions.entries()) {
    const now = await sha(d.preview);
    assert.equal(now, beforePreviews[i], `batch ${beforeBatch} preview ${i} was rewritten`);
  }
  // …and the new batch has its own directory.
  for (const d of regen.directions) {
    assert.ok(d.preview.includes(`/b${regen.batch}/`), `new preview must live in the new batch dir: ${d.preview}`);
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    assert.ok(html.length > 1000, 'the new preview must exist');
  }
  assert.notEqual(regen.previewDir, beforeDir);
  assert.equal(regen.versions[0]!.directions.length, beforeDirections.length);
});

await test('the archived batch is reloadable from disk after further regeneration', async () => {
  const second = await regenerateSession(outDir, regen, { seed: 2002, count: 6 });
  assert.equal(second.versions.length, 2, 'both earlier batches survive');
  const reloaded = (await loadSession(outDir, second.id))!;
  assert.equal(reloaded.versions.length, 2);
  const oldest = reloaded.versions[0]!;
  for (const d of oldest.directions) {
    const html = await readFile(path.join(outDir, d.preview), 'utf8');
    assert.ok(html.length > 1000, `archived preview ${d.preview} must still resolve`);
  }
});

await test('regeneration is deterministic: same session inputs + same seed = same set', async () => {
  const fresh = (await loadSession(outDir, session.id))!;
  const a = await regenerateSession(outDir, fresh, { seed: 777, count: 5 });
  const b = await regenerateSession(outDir, fresh, { seed: 777, count: 5 });
  assert.deepEqual(
    a.directions.map((d) => d.id),
    b.directions.map((d) => d.id),
    'the same seed must reproduce the same directions',
  );
  assert.notDeepEqual(
    a.directions.map((d) => d.id),
    fresh.directions.map((d) => d.id),
    'a new seed must move off the current batch',
  );
});

await test('direction ids are stable identities derived from their own inputs', async () => {
  const again = await createSession(outDir, PUBLIC_DIR, {
    brief: BRIEF,
    decider: 'local',
    seed: 4242,
    explore: 0.45,
    count: 6,
    noWriter: true,
  });
  void again; // a second session differs by history; identity is checked inside one lineage:
  const ids = new Set(regen.directions.map((d) => d.id));
  assert.equal(ids.size, regen.directions.length, 'ids must be unique within a batch');
  for (const d of regen.directions) {
    assert.match(d.id, /^dir_[0-9a-f]+$/, 'id shape is stable and content-derived');
    const twin = regen.directions.find(
      (x) =>
        x.blueprint === d.blueprint &&
        x.palette === d.palette &&
        x.typography === d.typography &&
        x.effects === d.effects &&
        x.motion === d.motion &&
        x.density === d.density,
    );
    assert.equal(twin?.id, d.id, 'the same resolved direction must map to the same id');
  }
});

await test('the session survives a save/load round trip with its versions intact', async () => {
  const current = (await loadSession(outDir, session.id))!;
  assert.ok(current.versions.length >= 2, 'the archived batches are on disk');
  await saveSession(outDir, current);
  const again = (await loadSession(outDir, session.id))!;
  assert.deepEqual(again, current, 'a session must round trip byte for byte');
  assert.equal(again.selectionVersion, current.selectionVersion);
  assert.equal(again.project, 'locks-suite', 'the project scope is persisted with the session');
});

if (originalProject === undefined) delete process.env.FORGE_PROJECT;
else process.env.FORGE_PROJECT = originalProject;
await rm(outDir, { recursive: true, force: true });

console.log(failed ? `\n=== ${failed} FAILED, ${passed} passed ===\n` : `\nall ${passed} checks passed\n`);
if (failed) process.exit(1);
