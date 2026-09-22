#!/usr/bin/env node
/**
 * TurboSlop — evidence generation.
 *
 * Produces the RAW artefacts the implementation report quotes, so every table
 * in the report comes from the same measurements rather than from prose:
 *
 *   evidence/
 *     raw.json         sessions, direction sets, diversity reports, inventory
 *                      hashes, metrics (model calls + timings), fixture run
 *     measure.json     live-browser geometry for every preview at 1440×900 and
 *                      390×844 (section geometry, images, overflow, duplicate
 *                      ids, broken anchors, h1 size/lines)
 *     calibrate.json   fingerprint distance vs rendered geometry (produced by
 *                      scripts/calibrate.ts)
 *     tables.md        the report's markdown tables (scripts/report.ts)
 *     shots/           representative desktop/mobile/full screenshots
 *
 * Scope: the three briefs the review names — festival, ceramics-shop and
 * software — across three seeds, plus the CONTROLLED IMAGE-SERVICE FIXTURE
 * run (labelled: fixture evidence, not live-service evidence).
 *
 * Everything runs offline: local decider, no writer, no network. The same
 * command reproduces the same evidence from the same inputs.
 *
 * Usage:
 *   npx tsx scripts/evidence.ts --out evidence
 *   npx tsx scripts/evidence.ts --out /tmp/ev --no-measure --no-fixture
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSession, finalizeSession, type DirectionSession } from '../src/sessions.js';
import { historyFeatures, projectId } from '../src/history.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');

interface Cli {
  out: string;
  seeds: number[];
  briefs: string[];
  measure: boolean;
  fixture: boolean;
  shots: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    out: 'evidence',
    seeds: [11, 42, 97],
    briefs: ['festival', 'shop', 'software'],
    measure: true,
    fixture: true,
    shots: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') cli.out = argv[++i]!;
    else if (a === '--seeds') cli.seeds = argv[++i]!.split(',').map(Number);
    else if (a === '--briefs') cli.briefs = argv[++i]!.split(',');
    else if (a === '--no-measure') cli.measure = false;
    else if (a === '--no-fixture') cli.fixture = false;
    else if (a === '--no-shots') cli.shots = false;
  }
  return cli;
}

/** The baseline briefs the review names, verbatim. */
const BRIEFS: Record<string, string> = {
  festival: 'A three-day independent games festival in Rotterdam. Talks, a tournament, and a late-night arcade.',
  shop: 'A shop selling hand-thrown ceramic tableware. Small batch, muted glazes, ships worldwide.',
  software: 'A CLI tool that catches flaky tests before CI does. Fast, scriptable, one config file.',
  editorial: 'An independent quarterly magazine about urban gardening. Long reads, photography, no ads.',
  service: 'A mobile bike repair service that comes to your office. Same-day, fixed prices.',
  artist: 'A painter working in large-format oils about industrial estuaries. Exhibitions and commissions.',
  technical: 'An API for satellite imagery pricing. Docs-first, high volume, enterprise SLAs.',
};

const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/* ------------------------------------------------------------------ *
 * Controlled fixture image service (deliberately NOT a live service)
 * ------------------------------------------------------------------ */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function startFixture(): Promise<{ port: number; generateCalls: number; prompts: string[]; close: () => Promise<void> }> {
  const state = { port: 0, generateCalls: 0, prompts: [] as string[], close: async () => {} };
  const jobs: Record<string, unknown>[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt: string; seed: number; steps: number; cfg: number };
        state.generateCalls++;
        state.prompts.push(body.prompt.slice(0, 60));
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
    if (/^\/images\/fx\d+\.png$/.test(url.pathname)) {
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

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const outAbs = path.resolve(cli.out);
  const workDir = path.join(outAbs, 'work');
  const pagesDir = path.join(outAbs, 'pages');
  const shotsDir = path.join(outAbs, 'shots');
  await mkdir(workDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });

  process.env.FORGE_OUT_DIR = workDir;
  process.env.FORGE_PROJECT = 'evidence';
  const wallStart = Date.now();

  const sessions: unknown[] = [];
  const pageMap: Record<string, { brief: string; seed: number; direction: number; session: string; preview: string }> = {};
  const inventoryHashes: Record<string, string[]> = {};
  const publicDir = path.join(REPO, 'public');

  /* ---- 1. Sessions: complete direction sets across seeds ------------- */
  for (const name of cli.briefs) {
    const brief = BRIEFS[name];
    if (!brief) throw new Error(`unknown brief "${name}" (have: ${Object.keys(BRIEFS).join(', ')})`);
    inventoryHashes[name] = [];
    for (const seed of cli.seeds) {
      const t0 = Date.now();
      const session: DirectionSession = await createSession(workDir, publicDir, {
        brief,
        decider: 'local',
        seed,
        explore: 1,
        count: 6,
        noWriter: true,
      });
      const inventoryHash = sha256(session.inventory);
      inventoryHashes[name]!.push(inventoryHash);

      for (const d of session.directions) {
        const slug = `${name}-s${seed}-d${d.index}`;
        await copyFile(path.join(workDir, d.preview), path.join(pagesDir, `${slug}.html`));
        pageMap[slug] = { brief: name, seed, direction: d.index, session: session.id, preview: d.preview };
      }

      sessions.push({
        brief: name,
        seed,
        session: session.id,
        createdAt: session.createdAt,
        selectionVersion: session.selectionVersion,
        project: session.project,
        previewLabel: session.previewLabel,
        inventorySource: session.inventorySource,
        inventoryHash,
        historyKeys: session.historyKeys.length,
        metrics: session.metrics,
        diversity: session.diversity,
        stats: session.stats,
        wallMs: Date.now() - t0,
        directions: session.directions.map((d) => ({
          index: d.index,
          id: d.id,
          blueprint: d.blueprint,
          baseBlueprint: d.baseBlueprint,
          composition: d.composition,
          palette: d.palette,
          typography: d.typography,
          effects: d.effects,
          motion: d.motion,
          density: d.density,
          lead: d.lead,
          fit: d.fit,
          novelty: d.novelty,
          seed: d.seed,
          construction: d.features.construction,
          treatment: d.features.treatment,
          hero: d.features.hero,
          nav: d.features.nav,
          footer: d.features.footer,
          tone: d.features.tone,
          imageSlots: d.imageSlots.length,
          diagnostics: d.diagnostics,
          preview: d.preview,
          /* The full resolved fingerprint — what calibrate.ts compares against
             measured geometry. */
          features: d.features,
        })),
      });
      console.log(`  session  ${name} seed ${seed}: ${session.directions.length} directions, ` +
        `compositions ${session.diversity.achieved.compositions}, constructions ${session.diversity.achieved.constructions}, ` +
        `treatments ${session.diversity.achieved.treatments}, grayscale ${session.diversity.achieved.grayscaleDistinct} ` +
        `(met ${session.diversity.met}) · ${Date.now() - t0}ms`);
    }
  }

  /* Fonts beside the pages, so file:// rendering uses the bundled faces. */
  try {
    for (const f of await readdir(path.join(publicDir, 'fonts'))) {
      if (f.endsWith('.woff2') || f === 'LICENSES.md') {
        await copyFile(path.join(publicDir, 'fonts', f), path.join(pagesDir, f));
      }
    }
  } catch { /* fonts optional for measurement */ }

  const history = await historyFeatures(workDir, projectId());

  /* ---- 2b. Style probe: the NEAR bands the selector removes -------------
     Selection enforces ≥0.2 separation, so a real corpus contains almost no
     close pairs — good, but it leaves the near-duplicate threshold
     uncalibrated. This probe renders ONE blueprint with controlled styling
     changes (and one other blueprint as the far control) against the SAME
     inventory, producing pairs in every band. */
  const styleProbe: { slug: string; features: import('../src/fingerprint.js').DesignFeatures; note: string }[] = [];
  {
    const { decideWithFallback } = await import('../src/decider.js');
    const { compose } = await import('../src/compose.js');
    const { renderHtml } = await import('../src/render.js');
    const { featuresOf } = await import('../src/fingerprint.js');
    const { imageSlotsFor, resolveBlueprint } = await import('../src/blueprint.js');
    const { fallbackContent } = await import('../src/content.js');
    const { PALETTE_BY_ID } = await import('../src/catalog.js');

    const probeBrief = BRIEFS.shop!;
    const decided = await decideWithFallback(probeBrief, { preference: 'local' });
    const emotionAnswer = decided.response.answers.emotion;
    const emotion = emotionAnswer?.type === 'choice' ? emotionAnswer.choice : 'other';
    /* The shop session's inventory: fixed content for every probe page. */
    const probeContent = fallbackContent(
      probeBrief,
      Object.values(decided.response.answers)
        .filter((a) => a.type !== 'noul')
        .map((a, i) => ({ axis: `axis${i}`, picked: a.type === 'choice' ? a.choice : String((a as { score: number }).score ?? 0), confidence: a.type === 'choice' ? a.confidence : 1 })),
    );

    const variants: [string, string, string, string, string][] = [
      ['statement-display', 'paper-ink', 'grotesk-tight', 'balanced', 'control'],
      ['statement-display', 'noir-lime', 'grotesk-tight', 'dense', 'same structure, palette + density'],
      ['statement-display', 'paper-ink', 'editorial-serif', 'balanced', 'same structure, typeface'],
      ['catalogue-gallery', 'paper-ink', 'grotesk-tight', 'balanced', 'different structure, same styling'],
    ];
    for (const [i, [bpId, palette, typeface, density, note]] of variants.entries()) {
      const { spec } = compose(probeBrief, decided, {
        seed: 1000 + i,
        direction: {
          blueprint: bpId,
          palette,
          typography: typeface,
          effects: 'tactile-paper',
          motion: 'breath',
          density,
          fit: 0.7,
          novelty: 1,
          rationale: 'style probe',
        },
      });
      spec.content = probeContent;
      const slug = `cal-s${i}`;
      const html = renderHtml(spec, { fontBasePath: 'fonts/' });
      await writeFile(path.join(pagesDir, `${slug}.html`), html, 'utf8');
      const bp = resolveBlueprint(bpId)!;
      const features = featuresOf({
        blueprint: bp,
        typefaceId: typeface,
        density,
        emotion,
        paletteBg: PALETTE_BY_ID[palette]!.bg,
        effects: 'tactile-paper',
        motion: 'breath',
        imageScales: imageSlotsFor(bp).map((s) => s.scale),
      });
      styleProbe.push({ slug, features, note });
      pageMap[slug] = { brief: '__styleProbe__', seed: 0, direction: i, session: 'probe', preview: `pages/${slug}.html` };
    }
    console.log(`  probe     ${styleProbe.length} style-probe pages (calibration only, not part of any direction set)`);
  }

  /* ---- 2. Controlled fixture image run -------------------------------- */
  let fixture: unknown = null;
  if (cli.fixture) {
    const fx = await startFixture();
    const previousBase = process.env.FORGE_IMAGE_BASE_URL;
    process.env.FORGE_IMAGE_BASE_URL = `http://127.0.0.1:${fx.port}`;
    try {
      const session = await createSession(workDir, publicDir, {
        brief: BRIEFS.festival!,
        decider: 'local',
        seed: 4242,
        explore: 1,
        count: 6,
        noWriter: true,
      });
      const idx = Math.max(0, session.directions.findIndex((d) => d.imageSlots.length > 0));
      const chosen = session.directions[idx]!;
      const uploadDir = path.join(outAbs, 'fixture-uploads');
      await mkdir(uploadDir, { recursive: true });
      const suppliedFile = path.join(uploadDir, 'supplied-hero.png');
      await writeFile(suppliedFile, PNG_1PX);
      const suppliedSlot = chosen.imageSlots[0]?.id;

      const before = fx.generateCalls;
      const result = await finalizeSession(workDir, session, 'fixture-final', {
        index: idx,
        finalCopy: false,
        images: { enabled: true, count: 2, preset: 'turbo' },
        ...(suppliedSlot ? { userImages: [{ slot: suppliedSlot, path: suppliedFile, alt: 'Supplied fixture photo', credit: 'fixture', license: 'CC0' }] } : {}),
        userImageRoot: uploadDir,
      });

      let zipEntries: string[] = [];
      try {
        const { buildZip } = await import('../src/export.js');
        const zip = await buildZip(workDir, 'fixture-final');
        const zipPath = path.join(outAbs, 'fixture-export.zip');
        await writeFile(zipPath, zip);
        const list = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
        zipEntries = list.status === 0 ? list.stdout.split('\n').filter(Boolean) : [];
        const testRun = spawnSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
        fixture = {
          label: 'CONTROLLED FIXTURE — local HTTP stand-in for the image service, NOT live-service evidence',
          direction: chosen.id,
          blueprint: chosen.blueprint,
          renderableSlots: chosen.imageSlots.map((s) => s.id),
          suppliedSlot,
          requestsToService: fx.generateCalls - before,
          assetsOnPage: result.spec.assets.length,
          assetSource: result.spec.assets.map((a) => ({ slot: a.slot, source: a.source, license: a.license, size: `${a.nativeWidth}x${a.nativeHeight}` })),
          placement: result.placement,
          notes: result.notes,
          imageMs: result.assetMs,
          zipTestOk: testRun.status === 0 || /zipfile is empty/.test(testRun.stderr ?? ''),
          zipEntries,
        };
      } catch (err) {
        fixture = { error: err instanceof Error ? err.message : String(err) };
      } finally {
        if (previousBase === undefined) delete process.env.FORGE_IMAGE_BASE_URL;
        else process.env.FORGE_IMAGE_BASE_URL = previousBase;
        await fx.close();
      }
      console.log(`  fixture  ${chosen.blueprint}: ${JSON.stringify(fixture, null, 0).slice(0, 220)}`);
    } catch (err) {
      if (process.env.FORGE_IMAGE_BASE_URL) delete process.env.FORGE_IMAGE_BASE_URL;
      await fx.close();
      fixture = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /* ---- 3. Raw evidence file ------------------------------------------ */
  const raw = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    selectionVersion: sessions.length
      ? (sessions[0] as { selectionVersion: string }).selectionVersion
      : 'unknown',
    command: `npx tsx scripts/evidence.ts --out ${cli.out} --seeds ${cli.seeds.join(',')} --briefs ${cli.briefs.join(',')}`,
    briefs: Object.fromEntries(cli.briefs.map((b) => [b, BRIEFS[b]])),
    seeds: cli.seeds,
    contentInventory: {
      note: 'the writer is off, so the specimen inventory is deterministic — identical hashes across seeds prove the design variation below is not content variation',
      hashes: inventoryHashes,
      fixed: Object.fromEntries(Object.entries(inventoryHashes).map(([k, v]) => [k, new Set(v).size === 1])),
    },
    historyEntriesAtEnd: history.entries.length,
    sessions,
    pageMap,
    styleProbe,
    fixture,
    wallMs: Date.now() - wallStart,
  };
  await writeFile(path.join(outAbs, 'raw.json'), JSON.stringify(raw, null, 1), 'utf8');
  console.log(`  raw      ${path.join(cli.out, 'raw.json')}`);

  /* ---- 4. Live-browser measurement ----------------------------------- */
  if (cli.measure) {
    const args = ['scripts/measure.ts', '--dir', pagesDir, '--out', path.join(outAbs, 'measure.json')];
    if (cli.shots) args.push('--shots', shotsDir);
    console.log(`  measure  ${args.join(' ')}`);
    const run = spawnSync(TSX, args, { cwd: REPO, stdio: 'inherit', env: process.env });
    if (run.status !== 0) throw new Error(`measure.ts exited ${run.status}`);
  }

  console.log(`\n  evidence written to ${cli.out} in ${Date.now() - wallStart} ms`);
}

main().catch((err) => {
  console.error(`\n  evidence failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
