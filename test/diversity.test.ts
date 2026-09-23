/**
 * TurboSlop — layout-diversity tests (requirement: diversity is an ENFORCED
 * property of the generated set).
 *
 * Runs entirely offline: local decider, no writer, no network.
 *
 * What it protects, in order of how badly it would hurt to get wrong:
 *
 *   1. At maximum exploration a six-direction set spans at least four distinct
 *      compositions, three headline constructions, three visual treatments,
 *      and several members that still differ in grayscale — measured on the
 *      resolved design fingerprint, not on blueprint ids.
 *   2. Near-duplicates are rejected explicitly, and recent designs from
 *      project history are kept out of a new set (scoped by project).
 *   3. The same versioned inputs + seed + history snapshot reproduce the same
 *      result, and a changed history snapshot is the input that changes it.
 *   4. The search is bounded, and any target shortfall is REPORTED with a
 *      reason rather than papered over.
 *   5. Single-design generation applies history too, not just batches.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decideWithFallback } from '../src/decider.js';
import {
  MAX_CANDIDATES,
  buildDirections,
  type BuildResult,
  type Distributions,
  type Direction,
} from '../src/directions.js';
import {
  GRAYSCALE_SEPARATION,
  HISTORY_SEPARATION,
  MIN_SEPARATION,
  SELECTION_VERSION,
  featureDistance,
  featuresOf,
  grayscaleDistance,
  reportDiversity,
  targetsFor,
  type DesignFeatures,
} from '../src/fingerprint.js';
import { fallbackContent } from '../src/content.js';
import type { ModuleId } from '../src/blueprint.js';
import { availableModulesOf } from '../src/assetplan.js';
import { historyFeatures, loadHistory, projectId, recordHistory } from '../src/history.js';
import { runPipeline } from '../src/pipeline.js';

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

console.log('\n=== TurboSlop — enforced layout diversity ===\n');

/* The seven baseline briefs, verbatim. */
const BRIEFS: [string, string][] = [
  ['festival', 'A three-day independent games festival in Rotterdam. Talks, a tournament, and a late-night arcade.'],
  ['shop', 'A shop selling hand-thrown ceramic tableware. Small batch, muted glazes, ships worldwide.'],
  ['software', 'A CLI tool that catches flaky tests before CI does. Fast, scriptable, one config file.'],
  ['editorial', 'An independent quarterly magazine about urban gardening. Long reads, photography, no ads.'],
  ['service', 'A mobile bike repair service that comes to your office. Same-day, fixed prices.'],
  ['artist', 'A painter working in large-format oils about industrial estuaries. Exhibitions and commissions.'],
  ['technical', 'An API for satellite imagery pricing. Docs-first, high volume, enterprise SLAs.'],
];
const NAMED = ['festival', 'shop', 'software'];

interface Built {
  brief: string;
  distributions: Distributions;
  wantsDark: boolean;
  availableModules: Set<ModuleId>;
  /** Which decider produced these inputs — printed with live evidence. */
  kind: 'local' | 'live';
  model: string;
  latencyMs: number;
}
const cache = new Map<string, Built>();

/**
 * Decision inputs for a brief.
 *
 * `local` is the offline control this suite is built on; `live` is real Jev and
 * is only reachable when TYPESAFE_API_KEY is present — the same targets must
 * hold under it, which is the last check below.
 */
async function inputsFor(brief: string, preference: 'local' | 'live' = 'local'): Promise<Built> {
  const cacheKey = `${preference}:${brief}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const decided = await decideWithFallback(brief, { preference });
  const distributions: Distributions = {};
  for (const [id, ans] of Object.entries(decided.response.answers)) {
    if (ans.type === 'choice') distributions[id as keyof Distributions] = ans.probabilities;
  }
  const wantsDark =
    ((decided.response.answers.wants_dark_ground as { noul?: number } | undefined)?.noul ?? 0) > 0.6;
  /* Availability is derived the SAME way sessions derive it: from the
     specimen content built on the decision's own axes. */
  const { compose } = await import('../src/compose.js');
  const primary = compose(brief, decided, { seed: 1 }).spec;
  const axes = primary.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const built: Built = {
    brief,
    distributions,
    wantsDark,
    availableModules: availableModulesOf(fallbackContent(brief, axes)),
    kind: decided.kind,
    model: decided.response.model,
    latencyMs: decided.latencyMs,
  };
  cache.set(cacheKey, built);
  return built;
}

async function build(
  brief: string,
  seed: number,
  explore: number,
  history?: DesignFeatures[],
  preference: 'local' | 'live' = 'local',
): Promise<BuildResult> {
  const input = await inputsFor(brief, preference);
  return buildDirections({
    brief: input.brief,
    distributions: input.distributions,
    count: 6,
    seed,
    wantsDark: input.wantsDark,
    explore,
    history,
    availableModules: input.availableModules,
  });
}

/* ================================================================== *
 * 1. The targets, at maximum exploration
 * ================================================================== */
for (const [name, brief] of BRIEFS) {
  await test(`${name}: a six-direction set at explore=1 meets the composition/construction/treatment/grayscale targets`, async () => {
    for (const seed of [11, 42, 97]) {
      const built = await build(brief, seed, 1);
      const { achieved, targets, met, shortfall } = built.report;
      const where = `${name} seed ${seed}: compositions ${achieved.compositions}/${targets.compositions}, constructions ${achieved.constructions}/${targets.constructions}, treatments ${achieved.treatments}/${targets.treatments}, grayscale ${achieved.grayscaleDistinct}/${targets.grayscaleDistinct}`;
      assert.equal(achieved.directions, 6, `${where} — expected six directions`);
      assert.ok(achieved.compositions >= 4, `${where} — need ≥4 distinct compositions`);
      assert.ok(achieved.constructions >= 3, `${where} — need ≥3 headline constructions`);
      assert.ok(achieved.treatments >= 3, `${where} — need ≥3 visual treatments`);
      assert.ok(
        achieved.grayscaleDistinct >= 3,
        `${where} — need ≥3 members differing from the best fit even in grayscale`,
      );
      assert.ok(achieved.minSeparation >= MIN_SEPARATION, `${where} — min separation ${achieved.minSeparation} < ${MIN_SEPARATION}`);
      assert.ok(
        achieved.minGrayscaleSeparation > 0,
        `${where} — grayscale separation must be measured`,
      );
      if (!met) {
        // A miss must carry an explanation, never a silent gap.
        assert.ok(shortfall.length > 0, `${where} — report says targets missed but gives no reason`);
        for (const s of shortfall) assert.ok(s.reason && s.reason.length > 10, `${where} — shortfall ${s.target} has no real reason`);
      }
      assert.equal(met, shortfall.length === 0, `${where} — met flag and shortfall list disagree`);
    }
  });
}

await test('at explore=0 the targets drop to the fit-first floor, at explore=1 they ask for the full spread', () => {
  const low = targetsFor(6, 0);
  const high = targetsFor(6, 1);
  assert.ok(low.compositions < high.compositions, 'explore must actually move the target');
  assert.equal(high.compositions, 4);
  assert.equal(high.constructions, 3);
  assert.equal(high.treatments, 3);
});

/* ================================================================== *
 * 2. Near-duplicate rejection and bounded search
 * ================================================================== */
await test('the candidate search is bounded, de-duplicated, and near-duplicates are rejected explicitly', async () => {
  const built = await build(BRIEFS[0]![1], 11, 1);
  assert.ok(built.stats.generated <= MAX_CANDIDATES, `generated ${built.stats.generated} > bound ${MAX_CANDIDATES}`);
  assert.ok(built.stats.structures <= 57, `structures ${built.stats.structures} should be 19 bases × ≤3 variants`);
  assert.ok(built.stats.unique <= built.stats.generated, 'exact-key de-duplication can only shrink the pool');
  assert.ok(
    built.stats.afterNearDuplicate <= built.stats.unique,
    'near-duplicate rejection can only shrink the pool further',
  );
  assert.ok(
    built.stats.afterNearDuplicate < built.stats.generated,
    `expected the de-dup stages to reject something, got ${built.stats.generated} → ${built.stats.afterNearDuplicate}`,
  );
});

await test('no two directions in a set share a fingerprint key, and every pair is separated', async () => {
  const built = await build(BRIEFS[1]![1], 7, 1);
  const { fingerprintKey } = await import('../src/fingerprint.js');
  const keys = built.directions.map((d) => fingerprintKey(d.features));
  assert.equal(new Set(keys).size, keys.length, 'duplicate direction fingerprints in one set');
  for (let i = 0; i < built.directions.length; i++) {
    for (let j = i + 1; j < built.directions.length; j++) {
      const d = featureDistance(built.directions[i]!.features, built.directions[j]!.features);
      assert.ok(d >= MIN_SEPARATION, `directions ${i} and ${j} are only ${d} apart`);
    }
  }
});

await test('the same inputs, seed and history snapshot reproduce the same result byte for byte', async () => {
  const a = await build(BRIEFS[2]![1], 2024, 1, []);
  const b = await build(BRIEFS[2]![1], 2024, 1, []);
  assert.deepEqual(
    a.directions.map((d) => ({ id: d.id, fit: d.fit, f: d.features })),
    b.directions.map((d) => ({ id: d.id, fit: d.fit, f: d.features })),
    'same versioned inputs + seed + snapshot must reproduce the same set',
  );
  assert.equal(a.report.met, b.report.met);
});

await test('a different history snapshot is the input that changes the selection — still deterministically', async () => {
  const base = await build(BRIEFS[2]![1], 2024, 1, []);
  const hostile = await build(BRIEFS[2]![1], 2024, 1, base.directions.map((d) => d.features));
  const hostileAgain = await build(BRIEFS[2]![1], 2024, 1, base.directions.map((d) => d.features));
  assert.deepEqual(
    hostile.directions.map((d) => d.id),
    hostileAgain.directions.map((d) => d.id),
    'a hostile snapshot must still reproduce',
  );
  /* Nothing in the new set may repeat what history already holds. */
  if (!hostile.stats.historyRelaxed) {
    for (const d of hostile.directions) {
      for (const h of base.directions) {
        assert.ok(
          featureDistance(d.features, h.features) >= HISTORY_SEPARATION,
          `direction ${d.id} is ${featureDistance(d.features, h.features)} from a recent design`,
        );
      }
    }
    assert.notDeepEqual(
      hostile.directions.map((d) => d.id),
      base.directions.map((d) => d.id),
      'feeding the previous set as history must move the new set off it',
    );
  } else {
    // Starvation escape must be declared, not silent.
    assert.ok(base.directions.length > 0 && hostile.directions.length > 0);
  }
});

await test('grayscale distance drops the hue-only terms and still measures the rest', async () => {
  const a = await build(BRIEFS[1]![1], 5, 1);
  const first = a.directions[0]!.features;
  const twin: DesignFeatures = { ...first, effects: 'brutalist-block', motion: 'kinetic' };
  assert.equal(featureDistance(first, twin) > 0, true, 'hue terms count in the full distance');
  assert.equal(
    grayscaleDistance(first, twin),
    0,
    'a hue-and-motion-only change must be invisible in grayscale',
  );
  const moved: DesignFeatures = { ...first, construction: first.construction === 'caps' ? 'stacked' : 'caps' };
  assert.ok(
    grayscaleDistance(first, moved) >= 0.08,
    `a construction change must show in grayscale, got ${grayscaleDistance(first, moved)}`,
  );
  assert.ok(GRAYSCALE_SEPARATION > 0 && MIN_SEPARATION > HISTORY_SEPARATION);
});

/* ================================================================== *
 * 3. Project-scoped history persistence
 * ================================================================== */
const histDir = await mkdtemp(path.join(tmpdir(), 'turboslop-hist-'));
const originalProject = process.env.FORGE_PROJECT;

await test('resolved fingerprints persist across sessions, scoped by project', async () => {
  process.env.FORGE_PROJECT = 'diversity-suite';
  assert.equal(projectId(), 'diversity-suite');

  const feat = featuresOf({
    blueprint: (await import('../src/blueprint.js')).BLUEPRINTS[0]!,
    typefaceId: 'grotesk-tight',
    density: 'balanced',
    emotion: 'awe',
    paletteBg: '#000000',
    effects: 'flat-plain',
    motion: 'glacial',
  });
  await recordHistory(histDir, [{ features: feat, source: 'design:test-a', seed: 5 }], 'diversity-suite');
  await recordHistory(histDir, [{ features: feat, source: 'design:test-a', seed: 5 }], 'diversity-suite');
  const loaded = await loadHistory(histDir, 'diversity-suite');
  assert.equal(loaded.length, 1, 'the same fingerprint must not be recorded twice');

  const other = await loadHistory(histDir, 'other-project');
  assert.deepEqual(other, [], 'history must be scoped by project — another project sees none of it');

  process.env.FORGE_PROJECT = 'other-project';
  assert.equal(projectId(), 'other-project');
  const snap = await historyFeatures(histDir);
  assert.deepEqual(snap.features, [], 'the snapshot the selector sees is project-scoped');

  process.env.FORGE_PROJECT = 'diversity-suite';
  const snap2 = await historyFeatures(histDir);
  assert.equal(snap2.features.length, 1, 'back on the original project, the entry is there');
  assert.equal(snap2.entries[0]!.source, 'design:test-a');
});

await test('an invalid project id is refused rather than silently writing a weird file', () => {
  assert.throws(() => projectId('../../etc/passwd'), /FORGE_PROJECT/);
  assert.equal(projectId(''), 'default', 'an empty FORGE_PROJECT falls back to the default project');
});

if (originalProject === undefined) delete process.env.FORGE_PROJECT;
else process.env.FORGE_PROJECT = originalProject;
await rm(histDir, { recursive: true, force: true });

/* ================================================================== *
 * 4. Single-design generation applies history too
 * ================================================================== */
const pipeDir = await mkdtemp(path.join(tmpdir(), 'turboslop-pipe-'));
process.env.FORGE_PROJECT = 'pipeline-history';

await test('a single-design run records its resolved design and avoids repeating it next time', async () => {
  const brief = BRIEFS[1]![1]; // the ceramics shop control brief
  const first = await runPipeline({
    brief,
    decider: 'local',
    noCopy: true,
    seed: 4242,
    explore: 1,
    images: { enabled: false, count: 0, preset: 'balanced' },
    outDir: pipeDir,
    slug: 'control-1',
  });
  assert.ok(first.notes.some((n) => n.startsWith('selection:')), `expected selection stats in the notes, got: ${first.notes.join(' | ')}`);

  const hist = await historyFeatures(pipeDir);
  assert.equal(hist.entries.length, 1, 'the run must record what it resolved');
  assert.equal(hist.entries[0]!.source, 'design:control-1');

  const second = await runPipeline({
    brief,
    decider: 'local',
    noCopy: true,
    seed: 4242,
    explore: 1,
    images: { enabled: false, count: 0, preset: 'balanced' },
    outDir: pipeDir,
    slug: 'control-2',
  });
  // The second run saw history: its resolved design must not be a repeat of
  // the first (or the notes must say the filter was relaxed to avoid starving).
  const hist2 = await historyFeatures(pipeDir);
  assert.equal(hist2.entries.length, 2, 'the second run adds its own resolved design');
  const [a, b] = hist2.entries;
  assert.ok(a && b);
  const dist = featureDistance(a.features, b.features);
  const relaxed = second.notes.some((n) => n.includes('history separation was relaxed'));
  assert.ok(
    dist >= HISTORY_SEPARATION || relaxed,
    `second run repeated the first at distance ${dist} without declaring a relaxation: ${second.notes.join(' | ')}`,
  );
});

delete process.env.FORGE_PROJECT;
await rm(pipeDir, { recursive: true, force: true });

/* ================================================================== *
 * 5. The report itself
 * ================================================================== */
await test('the diversity report counts what a set actually contains', () => {
  const mk = (seq: string, construction: 'caps' | 'stacked', treatment: 'plain' | 'shaped', tone: 'light' | 'dark'): DesignFeatures => ({
    lead: 'statement', hero: 'display', nav: 'bar', footer: 'masthead', columns: 12, rhythm: 'even',
    sequence: seq, typeface: 'grotesk-tight', construction, alignment: 'start', labelStyle: 'eyebrow',
    measureCh: 60, headScale: 1, headWeight: 400, trackingEm: -0.01,
    treatment, motifFamily: 'halftone', motifRole: 'band/none', imageSlots: 0, imageScale: 'none',
    tone, density: 'balanced', effects: 'flat-plain', motion: 'glacial',
  });
  const set = [
    mk('a>c', 'stacked', 'plain', 'light'),
    mk('a>c', 'stacked', 'plain', 'light'), // exact duplicate
    mk('b>d', 'caps', 'shaped', 'dark'),
  ];
  const report = reportDiversity(set, targetsFor(3, 1));
  assert.equal(report.achieved.compositions, 2, 'two distinct compositions');
  assert.equal(report.achieved.constructions, 2);
  assert.equal(report.achieved.treatments, 2);
  assert.equal(report.achieved.minSeparation, 0, 'an exact duplicate must show as zero separation');
  assert.equal(report.met, false);
  assert.ok(report.shortfall.length >= 1);
  assert.ok(
    report.shortfall.every((s) => typeof s.reason === 'string' && s.reason.length > 0),
    'every shortfall carries a reason',
  );
});

await test('the selection version is recorded and stable', () => {
  assert.match(SELECTION_VERSION, /^turboslop\/directions@\d+$/);
});

/* ================================================================== *
 * 6. Direction sets across seeds for the three named briefs
 *   (complete sets, compared — the evidence the report tables quote)
 * ================================================================== */
await test('festival, ceramics-shop and software produce different COMPLETE sets across seeds', async () => {
  const summary: Record<string, string[]> = {};
  for (const [name, brief] of BRIEFS.filter(([n]) => NAMED.includes(n))) {
    const sets: string[] = [];
    for (const seed of [11, 42, 97]) {
      const built = await build(brief, seed, 1);
      sets.push(built.directions.map((d) => `${d.blueprint.id}/${d.palette}/${d.features.construction}/${d.features.treatment}`).join(' | '));
      assert.ok(built.report.met, `${name} seed ${seed} missed targets: ${JSON.stringify(built.report.shortfall)}`);
    }
    summary[name] = sets;
    assert.equal(new Set(sets).size, sets.length, `${name}: two seeds produced the identical complete set`);
  }
  /* And across briefs the sets differ — diversity is not seed-only noise. */
  const values = Object.values(summary).map((v) => v[0]);
  assert.equal(new Set(values).size, values.length, 'different briefs produced the same first set');
  // Printed for the implementation report's evidence table.
  for (const [name, sets] of Object.entries(summary)) {
    for (const [i, s] of sets.entries()) console.log(`  info  ${name} seed ${[11, 42, 97][i]}: ${s}`);
  }
});

/* ================================================================== *
 * 7. The same targets under a LIVE Jev decision
 *
 * The offline control above proves the selector enforces the targets against
 * the local decider's distributions. This proves the targets are not an
 * artefact of those distributions: the real service's answer goes through the
 * identical selector and must clear the identical bar. It needs a key, so it
 * skips with the reason when there is none — never silently, never counted as
 * a pass.
 * ================================================================== */
const hasJevKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());

if (!hasJevKey) {
  skip('live-Jev diversity', 'no TYPESAFE_API_KEY — the local decider is the offline control');
} else {
  await test('a LIVE Jev decision also yields sets that meet every diversity target', async () => {
    for (const [name, brief] of BRIEFS.filter(([n]) => NAMED.includes(n))) {
      const inputs = await inputsFor(brief, 'live');
      assert.equal(inputs.kind, 'live', `${name}: expected a live decision, got ${inputs.kind}`);
      assert.match(inputs.model, /^jev/i, `${name}: live decision must come from a Jev model, got ${inputs.model}`);
      for (const seed of [11, 42, 97]) {
        const built = await build(brief, seed, 1, undefined, 'live');
        const { achieved, targets, met, shortfall } = built.report;
        const where =
          `${name} (live ${inputs.model}, ${inputs.latencyMs}ms) seed ${seed}: ` +
          `compositions ${achieved.compositions}/${targets.compositions}, ` +
          `constructions ${achieved.constructions}/${targets.constructions}, ` +
          `treatments ${achieved.treatments}/${targets.treatments}, ` +
          `grayscale ${achieved.grayscaleDistinct}/${targets.grayscaleDistinct}`;
        assert.equal(achieved.directions, 6, `${where} — expected six directions`);
        assert.ok(achieved.compositions >= 4, `${where} — need ≥4 distinct compositions`);
        assert.ok(achieved.constructions >= 3, `${where} — need ≥3 headline constructions`);
        assert.ok(achieved.treatments >= 3, `${where} — need ≥3 visual treatments`);
        assert.ok(achieved.grayscaleDistinct >= 3, `${where} — need ≥3 grayscale-distinct members`);
        assert.ok(achieved.minSeparation >= MIN_SEPARATION, `${where} — min separation ${achieved.minSeparation}`);
        assert.equal(met, shortfall.length === 0, `${where} — met flag and shortfall list disagree`);
        for (const s of shortfall) assert.ok(s.reason?.length > 10, `${where} — shortfall ${s.target} has no real reason`);
        console.log(`  info  LIVE ${where} — met=${met}`);
      }
    }
  });
}

console.log(
  failed
    ? `\n=== ${failed} FAILED, ${passed} passed${skipped ? `, ${skipped} skipped` : ''} ===\n`
    : `\nall ${passed} checks passed${skipped ? `, ${skipped} skipped` : ''}\n`,
);
if (failed) process.exit(1);
