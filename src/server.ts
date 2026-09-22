/**
 * TurboSlop — control surface server.
 *
 * Plain `node:http`, no framework, no build step. Serves the control surface,
 * exposes the pipeline over a small JSON API, and streams progress over SSE
 * (image generation takes seconds per image, so a hanging request would make
 * the surface feel broken).
 *
 * Everything it touches is confined to the output directory. Paths from the
 * client are validated against a strict slug pattern and never joined blindly.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES, ATMOSPHERE, PALETTE_VISUAL } from './catalog.js';
import { stripEmphasis } from './content.js';
import { describeFontPack, FONT_PACK } from './fonts.js';
import { FRAME_KINDS, frameForLead } from './frames.js';
import { ICON_NAMES } from './icons.js';
import { MOTIF_FAMILIES, motifFamilyForEmotion } from './motifs.js';
import { hasApiKey } from './jev.js';
import { IMAGE_PRESETS, describeImageService, resolveImageService } from './images.js';
import { INTEROP_2026_FEATURES, MODERN_CSS_FEATURES } from './layout.js';
import { describeLlm, resolveLlm } from './llm.js';
import { jevCost, writerCost } from './pricing.js';
import { runPipeline, slugify } from './pipeline.js';
import { getDesign, listDesigns, nextIterationSlug, recordDesign, uniqueSlug } from './registry.js';
import {
  createSession,
  finalizeSession,
  listSessions,
  loadSession,
  regenerateSession,
  saveSession,
  type DirectionSession,
} from './sessions.js';
import { createZip, type ZipEntry } from './zip.js';
import type { DeciderPreference } from './decider.js';
import type { DesignSpec } from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');
const OUT_DIR = path.resolve(process.env.FORGE_OUT_DIR ?? path.resolve(HERE, '..', 'out'));
const PORT = Number(process.env.FORGE_PORT ?? 4400);
/**
 * Interface to bind. `0.0.0.0` is the practical default for containers and
 * private networks; set `FORGE_HOST=127.0.0.1` to keep it strictly local.
 *
 * This surface has NO authentication. Binding it anywhere reachable means
 * anyone who can reach the port can spend your API credits and generate images.
 */
const HOST = process.env.FORGE_HOST ?? '0.0.0.0';
const MAX_BODY = 256 * 1024;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ASSET_RE = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp)$/;

/* ================================================================== *
 * Jobs — in-memory, with an event log so a late SSE subscriber still
 * sees what already happened.
 * ================================================================== */
type JobState = 'running' | 'done' | 'error';
interface JobEvent {
  phase: string;
  message: string;
  index?: number;
  total?: number;
  at: number;
}
interface Job {
  id: string;
  slug: string;
  brief: string;
  state: JobState;
  events: JobEvent[];
  result?: {
    slug?: string;
    sessionId?: string;
    composite?: number;
    notes: string[];
    timings: Record<string, number>;
  };
  error?: string;
  subscribers: Set<(e: JobEvent | { phase: 'end' }) => void>;
  startedAt: number;
}

const jobs = new Map<string, Job>();

function emit(job: Job, event: JobEvent | { phase: 'end' }): void {
  if ('message' in event) job.events.push(event);
  for (const send of job.subscribers) {
    try {
      send(event);
    } catch {
      /* a broken subscriber must not break the job */
    }
  }
}

/* ================================================================== *
 * Helpers
 * ================================================================== */
async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function text(res: http.ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveFile(res: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.byteLength,
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inline every relative asset as a data URI, producing ONE portable file.
 * This is the "copy it in one shot" export: paste into an email, a gist, a
 * CMS field, anything.
 */
async function inlineAssets(html: string, slug: string): Promise<string> {
  // Both artwork and the bundled fonts, so a single-file export renders exactly
  // as intended with no request of any kind — remote or local.
  const refs = [...html.matchAll(/(?:src|href|url\()["']?(assets\/[^"')]+|fonts\/[^"')]+)/g)].map(
    (m) => m[1] ?? m[2]!,
  );
  let out = html;
  for (const ref of new Set(refs)) {
    const isAsset = ref.startsWith('assets/');
    const rel = ref.replace(/^(assets|fonts)\//, '');
    if (isAsset && !ASSET_RE.test(rel)) continue;
    if (!isAsset && !/^[A-Za-z0-9._-]+\.(woff2|md)$/.test(rel)) continue;
    try {
      const buf = await readFile(path.join(OUT_DIR, isAsset ? 'assets' : 'fonts', rel));
      const mime = MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream';
      out = out.split(ref).join(`data:${mime};base64,${buf.toString('base64')}`);
    } catch {
      /* a missing file leaves the reference intact rather than breaking the page */
    }
  }
  return out;
}

/** A short human brief describing how a design was produced, for the export. */
function designReadme(spec: DesignSpec, slug: string): string {
  const dec = spec.decisions
    .map((d) => `| ${d.axis} | \`${d.picked}\` | ${d.confidence.toFixed(2)} | ${d.review ? '**review**' : ''} |`)
    .join('\n');
  const assets = spec.assets.length
    ? spec.assets
        .map((a) => {
          const base = `### ${a.slot || a.kind} — \`${path.basename(a.file)}\``;
          if (a.source === 'user') {
            return (
              `${base}\n\n- **supplied by the brief's owner** (${a.nativeWidth}x${a.nativeHeight}px)\n` +
              `- credit: ${a.credit || '_not stated_'}\n- licence: ${a.license || '_not stated_'}\n- alt: ${a.alt}\n`
            );
          }
          return (
            `${base}\n\n` +
            `- seed \`${a.seed}\`, steps ${a.steps}, guidance ${a.cfg}, ${(a.bytes / 1024).toFixed(0)} KB\n` +
            `- native resolution ${a.nativeWidth}x${a.nativeHeight} (generated)\n` +
            `- alt: ${a.alt}\n\n> ${a.prompt}\n`
          );
        })
        .join('\n')
    : '_No generated artwork — the layout uses its CSS gradient fallbacks._\n';

  const c = spec.content;
  return `# ${c?.brand ?? slug}${c ? ` — ${stripEmphasis(c.title)}` : ''}

${c?.description ?? ''}

Generated by **TurboSlop**. This file documents how, so the result can be
reproduced or audited.

## Brief

> ${spec.brief.split('\n').join('\n> ')}

## Decisions

Jev decided these; each carries a calibrated confidence.

| axis | choice | confidence | |
|---|---|---|---|
${dec}

Composite: **${spec.composite.normalized.toFixed(3)} / 1.000**
${spec.review.length ? `\nFlagged for review: ${spec.review.join(', ')}\n` : ''}
## Provenance

| | |
|---|---|
| decider | \`${spec.meta.decider}\` / \`${spec.meta.model}\` (${spec.meta.latencyMs} ms) |
| copy | \`${spec.meta.writer}\`${spec.meta.writer === 'llm' ? ` / \`${spec.meta.writerModel}\` (${spec.meta.writerLatencyMs} ms)` : ' (specimen content)'} |
| images | ${spec.meta.imageCount} at steps ${spec.meta.imageSteps} / guidance ${spec.meta.imageCfg} (${spec.meta.imageMs} ms) |
| decision cost | ~$${spec.meta.estimatedUsd.toFixed(6)} (Jev: input only) |
| writing cost | ~$${spec.meta.writerEstimatedUsd.toFixed(6)} (the writing half usually dominates) |
| **estimated total** | **~$${(spec.meta.estimatedUsd + spec.meta.writerEstimatedUsd).toFixed(6)}** |

## Files

- \`index.html\` — the page
- \`design.spec.json\` — the full decision record, including every probability
- \`assets/\` — generated artwork

## Generated artwork

${assets}
## Content

**${c ? stripEmphasis(c.tagline) : ''}**

${c?.lede ?? ''}

${(c?.aboutBody ?? []).join('\n\n')}
`;
}

/* ================================================================== *
 * Export builders
 * ================================================================== */
async function buildZip(slug: string): Promise<Buffer> {
  const loaded = await getDesign(OUT_DIR, slug);
  if (!loaded) throw new Error('design not found');
  const { spec } = loaded;

  const html = await readFile(path.join(OUT_DIR, `${slug}.html`), 'utf8');
  const entries: ZipEntry[] = [
    { path: 'index.html', data: html },
    { path: 'design.spec.json', data: await readFile(path.join(OUT_DIR, `${slug}.spec.json`)) },
    { path: 'README.md', data: designReadme(spec, slug) },
  ];

  for (const a of spec.assets) {
    const rel = a.file.replace(/^assets\//, '');
    if (!ASSET_RE.test(rel)) continue;
    try {
      entries.push({ path: a.file, data: await readFile(path.join(OUT_DIR, 'assets', rel)) });
    } catch {
      /* skip a missing asset rather than failing the whole export */
    }
  }

  /* The page references fonts/ relatively, so the export must carry them — and
     the licences must travel with the files, as OFL requires. */
  try {
    for (const f of await readdir(path.join(OUT_DIR, 'fonts'))) {
      if (!f.endsWith('.woff2') && f !== 'LICENSES.md') continue;
      entries.push({ path: `fonts/${f}`, data: await readFile(path.join(OUT_DIR, 'fonts', f)) });
    }
  } catch {
    /* no bundled fonts on disk: the page still falls back to system faces */
  }

  // A self-contained page too, so the archive works with no assets folder.
  try {
    entries.push({ path: 'index.selfcontained.html', data: await inlineAssets(html, slug) });
  } catch {
    /* optional */
  }

  return createZip(entries);
}

/**
 * Cost for a design, in one place.
 *
 * Older specs predate `writerEstimatedUsd`, so we recompute from the recorded
 * token counts rather than trusting the stored figure to be present. Pricing
 * lives in `pricing.ts` and is never duplicated into the client.
 */
function computeCosts(spec: DesignSpec): { jev: number; writer: number; total: number } {
  const m = spec.meta;
  const jev = m.estimatedUsd || jevCost(m.inputTokens);
  const writer = m.writerEstimatedUsd || writerCost(m.writerInputTokens, m.writerOutputTokens);
  return { jev, writer, total: jev + writer };
}

/* ================================================================== *
 * Job execution
 * ================================================================== */
interface DesignRequest {
  brief?: string;
  decider?: DeciderPreference;
  copy?: boolean;
  images?: { enabled?: boolean; count?: number; preset?: string; steps?: number; cfg?: number; seed?: number };
  /**
   * Real brand/product images. Local paths, resolved inside
   * FORGE_USER_IMAGE_DIR, copied into the export with their credit and licence.
   */
  userImages?: { slot: string; path: string; alt?: string; credit?: string; license?: string }[];
}

/** Where user image paths resolve. Never the repo, and never the client's cwd. */
const USER_IMAGE_ROOT = path.resolve(process.env.FORGE_USER_IMAGE_DIR ?? process.cwd());

function readUserImages(input: DesignRequest['userImages']) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x) => x && typeof x.slot === 'string' && typeof x.path === 'string')
    .slice(0, 12)
    .map((x) => ({
      slot: x.slot,
      path: x.path,
      ...(typeof x.alt === 'string' ? { alt: x.alt } : {}),
      ...(typeof x.credit === 'string' ? { credit: x.credit } : {}),
      ...(typeof x.license === 'string' ? { license: x.license } : {}),
    }));
}

function readImageOptions(input: DesignRequest['images']) {
  const enabled = Boolean(input?.enabled);
  const count = Math.max(1, Math.min(16, Number(input?.count ?? 1) || 1));
  const preset = typeof input?.preset === 'string' && input.preset in IMAGE_PRESETS ? input.preset : 'balanced';
  return {
    enabled,
    count,
    preset,
    ...(typeof input?.steps === 'number' ? { steps: input.steps } : {}),
    ...(typeof input?.cfg === 'number' ? { cfg: input.cfg } : {}),
    ...(typeof input?.seed === 'number' ? { seed: input.seed } : {}),
  };
}

async function startJob(opts: {
  brief: string;
  instructions?: string;
  parentSlug?: string;
  decider: DeciderPreference;
  noCopy: boolean;
  images: ReturnType<typeof readImageOptions>;
  userImages?: ReturnType<typeof readUserImages>;
}): Promise<Job> {
  const parent = opts.parentSlug ? await getDesign(OUT_DIR, opts.parentSlug) : null;
  if (opts.parentSlug && !parent) throw new Error('parent design not found');

  const slug = parent
    ? await nextIterationSlug(OUT_DIR, parent.record.slug)
    : await uniqueSlug(OUT_DIR, slugify(opts.brief));

  const job: Job = {
    id: randomUUID(),
    slug,
    brief: opts.brief,
    state: 'running',
    events: [],
    subscribers: new Set(),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const result = await runPipeline({
        brief: opts.brief,
        parent: parent ? { spec: parent.spec, instructions: opts.instructions ?? '' } : null,
        decider: opts.decider,
        noCopy: opts.noCopy,
        images: opts.images,
        ...(opts.userImages?.length ? { userImages: opts.userImages, userImageRoot: USER_IMAGE_ROOT } : {}),
        outDir: OUT_DIR,
        slug,
        onProgress: (e) => emit(job, { ...e, at: Date.now() }),
      });

      await recordDesign(OUT_DIR, {
        slug,
        brief: opts.brief,
        ...(parent ? { parent: parent.record.slug, revision: parent.record.revision + 1 } : {}),
        source: 'surface',
      });

      job.state = 'done';
      job.result = {
        slug,
        composite: result.spec.composite.normalized,
        notes: result.notes,
        timings: result.timings,
      };
      emit(job, { phase: 'end' });
    } catch (err) {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      emit(job, { phase: 'error', message: job.error, at: Date.now() });
      emit(job, { phase: 'end' });
    }
  })();

  return job;
}

/* ================================================================== *
 * Direction-session jobs (the contact sheet)
 * ================================================================== */
interface DirectionsRequest {
  brief?: string;
  decider?: DeciderPreference;
  copy?: boolean;
  seed?: number;
  explore?: number;
  count?: number;
}

/**
 * One decision call, ONE shared content inventory, N local renders.
 *
 * Deliberately not N full generations: previewing six directions must not cost
 * six writer calls and six image batches. The session records exactly how many
 * model calls it made, and the surface shows that number.
 */
async function startDirectionsJob(opts: DirectionsRequest): Promise<Job> {
  const job: Job = {
    id: randomUUID(),
    slug: '',
    brief: opts.brief!,
    state: 'running',
    events: [],
    subscribers: new Set(),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      emit(job, { phase: 'decide', message: 'One decision call for the whole direction set…', at: Date.now() });
      const session = await createSession(OUT_DIR, PUBLIC_DIR, {
        brief: opts.brief!,
        decider: opts.decider ?? 'auto',
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.explore !== undefined ? { explore: opts.explore } : {}),
        ...(opts.count !== undefined ? { count: opts.count } : {}),
        noWriter: opts.copy === false,
      });
      emit(
        job,
        { phase: 'content', message: `Inventory: ${session.inventorySource} (${session.metrics.modelCalls} model calls total)`, at: Date.now() },
      );
      emit(job, { phase: 'render', message: `${session.directions.length} directions rendered locally`, at: Date.now() });
      job.result = {
        sessionId: session.id,
        notes: [session.previewLabel, ...session.directions.map((d) => d.blueprint)],
        timings: {
          decideMs: session.metrics.decideMs,
          inventoryMs: session.metrics.inventoryMs,
          renderMs: session.metrics.renderMs,
          totalMs: session.metrics.totalMs,
          modelCalls: session.metrics.modelCalls,
          estimateUsd: session.metrics.estimateUsd,
        },
      };
      job.state = 'done';
      emit(job, { phase: 'end' });
    } catch (err) {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      emit(job, { phase: 'error', message: job.error, at: Date.now() });
      emit(job, { phase: 'end' });
    }
  })();

  return job;
}

/**
 * Finalize one direction into a real design.
 *
 * This is the only place a second writer call happens, because final copy is
 * written FOR the chosen blueprint and only for the modules it renders.
 */
async function startFinalizeJob(
  session: DirectionSession,
  index: number,
  opts: {
    finalCopy: boolean;
    userImages?: { slot: string; path: string; alt?: string; credit?: string; license?: string }[];
    userImageRoot?: string;
  },
): Promise<Job> {
  const slug = await uniqueSlug(OUT_DIR, slugify(session.brief));
  const job: Job = {
    id: randomUUID(),
    slug,
    brief: session.brief,
    state: 'running',
    events: [],
    subscribers: new Set(),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const chosen = session.directions[index];
      if (!chosen) throw new Error(`no direction at index ${index}`);
      emit(
        job,
        { phase: 'content', message: opts.finalCopy ? `Writing final copy for ${chosen.blueprint}…` : 'Reusing the shared inventory as final copy', at: Date.now() },
      );
      const { spec, write } = await finalizeSession(OUT_DIR, session, slug, {
        index,
        finalCopy: opts.finalCopy,
        ...(opts.userImages?.length ? { userImages: opts.userImages, userImageRoot: opts.userImageRoot } : {}),
      });

      await recordDesign(OUT_DIR, {
        slug,
        brief: session.brief,
        ...(spec.content?.brand ? { title: spec.content.brand } : {}),
        source: 'surface',
      });

      session.selectedIndex = index;
      session.finalSlug = slug;
      session.history.push({
        at: new Date().toISOString(),
        event: 'finalized',
        detail: `${chosen.blueprint} → ${slug}`,
      });
      await saveSession(OUT_DIR, session);

      emit(job, { phase: 'write', message: `Wrote ${slug}.html`, at: Date.now() });
      job.result = {
        slug,
        sessionId: session.id,
        composite: spec.composite.normalized,
        notes: [
          write.source === 'llm'
            ? `final copy: ${write.model} in ${write.latencyMs}ms`
            : 'final copy: specimen (no writer configured)',
          `blueprint ${chosen.blueprint}`,
        ],
        timings: { writerMs: write.latencyMs, totalMs: Date.now() - job.startedAt },
      };
      job.state = 'done';
      emit(job, { phase: 'end' });
    } catch (err) {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      emit(job, { phase: 'error', message: job.error, at: Date.now() });
      emit(job, { phase: 'end' });
    }
  })();

  return job;
}

/* ================================================================== *
 * Routing
 * ================================================================== */
async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const method = req.method ?? 'GET';

  /* ---- state: everything the surface needs to render itself ---- */
  if (p === '/api/state' && method === 'GET') {
    const service = resolveImageService();
    const llm = resolveLlm();
    json(res, 200, {
      availability: {
        jev: hasApiKey() ? 'live' : 'local',
        jevNote: hasApiKey() ? 'TYPESAFE_API_KEY present' : 'no key — using the local decider',
        llm: llm ? `${llm.provider}/${llm.model}` : null,
        llmNote: describeLlm(llm),
        images: service ? service.baseUrl : null,
        imagesNote: describeImageService(service),
      },
      catalog: CANDIDATES,
      atmosphere: Object.entries(ATMOSPHERE).map(([emotion, a]) => ({ emotion, ...a })),
      paletteVisual: PALETTE_VISUAL,
      features: { interop2026: INTEROP_2026_FEATURES, modern: MODERN_CSS_FEATURES },
      presets: Object.entries(IMAGE_PRESETS).map(([id, preset]) => ({ id, ...preset })),
      /** The bundled, licensed type pack — no page depends on a remote font. */
      type: {
        summary: describeFontPack(),
        families: FONT_PACK.map((f) => ({
          direction: f.direction,
          family: f.family,
          file: f.file,
          license: f.license.spdx,
          note: f.note,
        })),
      },
      /** Code-rendered asset vocabulary the renderer can draw on. */
      assets: {
        motifFamilies: [...MOTIF_FAMILIES],
        frames: [...FRAME_KINDS],
        icons: [...ICON_NAMES],
        motifByEmotion: Object.fromEntries(
          ['awe', 'serenity', 'delight', 'tension', 'nostalgia', 'mystery', 'trust', 'energy', 'intimacy', 'optimism'].map(
            (e) => [e, motifFamilyForEmotion(e)],
          ),
        ),
        frameByLead: Object.fromEntries(
          ['statement', 'product', 'catalogue', 'story', 'date', 'data', 'image', 'offer'].map((l) => [
            l,
            frameForLead(l, 'other'),
          ]),
        ),
      },
      outDir: OUT_DIR,
    });
    return true;
  }

  /* ---- designs ---- */
  if (p === '/api/designs' && method === 'GET') {
    json(res, 200, { designs: await listDesigns(OUT_DIR) });
    return true;
  }

  const detail = /^\/api\/designs\/([a-z0-9-]+)$/.exec(p);
  if (detail && method === 'GET') {
    const loaded = await getDesign(OUT_DIR, detail[1]!);
    if (!loaded) return json(res, 404, { error: 'not found' }), true;
    json(res, 200, { ...loaded, costs: computeCosts(loaded.spec) });
    return true;
  }

  /* ---- exports ---- */
  const zipRoute = /^\/api\/designs\/([a-z0-9-]+)\/export\.zip$/.exec(p);
  if (zipRoute && method === 'GET') {
    const slug = zipRoute[1]!;
    try {
      const buf = await buildZip(slug);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${slug}.zip"`,
        'Content-Length': buf.byteLength,
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch (err) {
      json(res, 404, { error: err instanceof Error ? err.message : 'export failed' });
    }
    return true;
  }

  const selfRoute = /^\/api\/designs\/([a-z0-9-]+)\/selfcontained$/.exec(p);
  if (selfRoute && method === 'GET') {
    const slug = selfRoute[1]!;
    try {
      const html = await readFile(path.join(OUT_DIR, `${slug}.html`), 'utf8');
      text(res, 200, await inlineAssets(html, slug), 'text/html; charset=utf-8');
    } catch {
      text(res, 404, 'not found');
    }
    return true;
  }

  /* ---- direction sessions: the contact sheet ---- */
  if (p === '/api/directions' && method === 'POST') {
    try {
      const body = (await readBody(req)) as DirectionsRequest;
      const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
      if (!brief) return json(res, 400, { error: 'brief is required' }), true;
      const job = await startDirectionsJob({
        brief,
        decider: body.decider ?? 'auto',
        copy: body.copy,
        ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
        ...(typeof body.explore === 'number' ? { explore: body.explore } : {}),
        ...(typeof body.count === 'number' ? { count: body.count } : {}),
      });
      json(res, 202, { jobId: job.id });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  if (p === '/api/sessions' && method === 'GET') {
    const all = await listSessions(OUT_DIR);
    // The list is a summary: previews are fetched per session on demand.
    json(res, 200, {
      sessions: all.slice(0, 40).map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        brief: s.brief,
        seed: s.seed,
        explore: s.explore,
        directions: s.directions.length,
        modelCalls: s.metrics.modelCalls,
        estimateUsd: s.metrics.estimateUsd,
        totalMs: s.metrics.totalMs,
        previewLabel: s.previewLabel,
        finalSlug: s.finalSlug ?? null,
      })),
    });
    return true;
  }

  const sessionRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)$/.exec(p);
  if (sessionRoute && method === 'GET') {
    const s = await loadSession(OUT_DIR, sessionRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    json(res, 200, { session: s });
    return true;
  }

  /** Record the human's choice and locks. Deliberately model-free. */
  const selectRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/select$/.exec(p);
  if (selectRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, selectRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    try {
      const body = (await readBody(req)) as { index?: number; locks?: string[] };
      const index = typeof body.index === 'number' ? body.index : null;
      const locks = Array.isArray(body.locks) ? body.locks.filter((x) => typeof x === 'string') : s.locks;
      if (index !== null && !s.directions[index]) return json(res, 400, { error: 'no such direction' }), true;
      s.selectedIndex = index;
      s.locks = locks;
      s.history.push({
        at: new Date().toISOString(),
        event: 'selected',
        detail: `direction ${index}${locks.length ? `, locked ${locks.join('+')}` : ''}`,
      });
      await saveSession(OUT_DIR, s);
      json(res, 200, { session: s });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /**
   * Re-roll the unlocked directions. Purely local: the stored decision and the
   * stored inventory are reused, so this costs NOTHING and cannot change the
   * previews you already have.
   */
  const regenRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/regenerate$/.exec(p);
  if (regenRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, regenRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    try {
      const body = (await readBody(req)) as { locks?: string[]; fromIndex?: number; count?: number; seed?: number };
      const updated = await regenerateSession(OUT_DIR, s, {
        ...(Array.isArray(body.locks) ? { locks: body.locks.filter((x) => typeof x === 'string') } : {}),
        ...(typeof body.fromIndex === 'number' ? { fromIndex: body.fromIndex } : {}),
        ...(typeof body.count === 'number' ? { count: body.count } : {}),
        ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
      });
      json(res, 200, { session: updated });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /** Finalize a chosen direction into a real, exportable design. */
  const finRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/finalize$/.exec(p);
  if (finRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, finRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    try {
      const body = (await readBody(req)) as { index?: number; finalCopy?: boolean; userImages?: DesignRequest['userImages'] };
      const index = typeof body.index === 'number' ? body.index : (s.selectedIndex ?? 0);
      if (!s.directions[index]) return json(res, 400, { error: 'no such direction' }), true;
      const job = await startFinalizeJob(s, index, {
        finalCopy: body.finalCopy !== false,
        userImages: readUserImages(body.userImages),
        userImageRoot: USER_IMAGE_ROOT,
      });
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /**
   * "A revision of this design" — deliberately a separate endpoint from
   * regenerating directions. This keeps the chosen design's identity and asks
   * for a change to it.
   */
  const reviseRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/revise$/.exec(p);
  if (reviseRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, reviseRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    if (!s.finalSlug) return json(res, 400, { error: 'finalize the direction first, then revise it' }), true;
    try {
      const body = (await readBody(req)) as DesignRequest & { instructions?: string };
      const parentSlug = s.finalSlug;
      const parent = await getDesign(OUT_DIR, parentSlug);
      if (!parent) return json(res, 404, { error: 'parent design not found' }), true;
      const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
      if (!instructions) return json(res, 400, { error: 'instructions are required' }), true;
      const job = await startJob({
        brief: parent.spec.brief,
        instructions,
        parentSlug,
        decider: body.decider ?? 'auto',
        noCopy: body.copy === false,
        images: readImageOptions(body.images),
      });
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /* ---- jobs ---- */
  if (p === '/api/design' && method === 'POST') {
    try {
      const body = (await readBody(req)) as DesignRequest;
      const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
      if (!brief) return json(res, 400, { error: 'brief is required' }), true;
      const job = await startJob({
        brief,
        decider: body.decider ?? 'auto',
        noCopy: body.copy === false,
        images: readImageOptions(body.images),
        userImages: readUserImages(body.userImages),
      });
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  const iterate = /^\/api\/designs\/([a-z0-9-]+)\/iterate$/.exec(p);
  if (iterate && method === 'POST') {
    try {
      const body = (await readBody(req)) as DesignRequest & { instructions?: string };
      const parentSlug = iterate[1]!;
      const parent = await getDesign(OUT_DIR, parentSlug);
      if (!parent) return json(res, 404, { error: 'parent not found' }), true;
      const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
      if (!instructions) return json(res, 400, { error: 'instructions are required' }), true;

      const job = await startJob({
        brief: parent.spec.brief,
        instructions,
        parentSlug,
        decider: body.decider ?? 'auto',
        noCopy: body.copy === false,
        images: readImageOptions(body.images),
      });
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  const jobRoute = /^\/api\/jobs\/([0-9a-f-]+)$/.exec(p);
  if (jobRoute && method === 'GET') {
    const job = jobs.get(jobRoute[1]!);
    if (!job) return json(res, 404, { error: 'unknown job' }), true;
    json(res, 200, {
      id: job.id,
      slug: job.slug,
      state: job.state,
      events: job.events,
      result: job.result,
      error: job.error,
    });
    return true;
  }

  const eventsRoute = /^\/api\/jobs\/([0-9a-f-]+)\/events$/.exec(p);
  if (eventsRoute && method === 'GET') {
    const job = jobs.get(eventsRoute[1]!);
    if (!job) return json(res, 404, { error: 'unknown job' }), true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Replay so a subscriber that connects late still sees the full story.
    for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);

    if (job.state !== 'running') {
      res.write(`data: ${JSON.stringify({ phase: 'end' })}\n\n`);
      res.end();
      return true;
    }

    const send = (e: unknown) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
      if ((e as { phase?: string }).phase === 'end' && !res.writableEnded) res.end();
    };
    job.subscribers.add(send);
    req.on('close', () => job.subscribers.delete(send));
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const p = decodeURIComponent(url.pathname);

    try {
      if (p.startsWith('/api/')) {
        const handled = await handleApi(req, res, url);
        if (!handled) json(res, 404, { error: 'no such endpoint' });
        return;
      }

      // Control surface
      if (p === '/' || p === '/index.html') {
        if (await serveFile(res, path.join(PUBLIC_DIR, 'index.html'))) return;
        text(res, 500, 'control surface not built: public/index.html missing');
        return;
      }

      /* Live preview. The path is structured so a page's RELATIVE references
         (fonts/, assets/) resolve without rewriting the HTML: a page served at
         /preview/<id>/ finds its fonts at /preview/<id>/fonts/. */
      const preview = /^\/preview\/([a-z0-9_-]+)\/(.*)$/.exec(p);
      if (preview) {
        const id = preview[1]!;
        const rest = preview[2] ?? '';

        if (rest.startsWith('fonts/')) {
          const rel = rest.replace(/^fonts\//, '');
          if (/^[A-Za-z0-9._-]+\.(woff2|md)$/.test(rel) && (await serveFile(res, path.join(OUT_DIR, 'fonts', rel))))
            return;
          text(res, 404, 'not found');
          return;
        }
        if (rest.startsWith('assets/')) {
          const rel = rest.replace(/^assets\//, '');
          if (ASSET_RE.test(rel) && (await serveFile(res, path.join(OUT_DIR, 'assets', rel)))) return;
          text(res, 404, 'not found');
          return;
        }
        if (rest === '' || rest === 'index.html') {
          if (await serveFile(res, path.join(OUT_DIR, `${id}.html`))) return;
          // A session's directions are numbered files under previews/<id>/.
          if (await serveFile(res, path.join(OUT_DIR, 'previews', id, '0.html'))) return;
          text(res, 404, 'not found');
          return;
        }
        // A specific direction in a session: /preview/<sessionId>/<n>
        if (/^\d+$/.test(rest) && (await serveFile(res, path.join(OUT_DIR, 'previews', id, `${rest}.html`)))) return;
        text(res, 404, 'not found');
        return;
      }

      // Bundled fonts, served absolutely for pages that ask for /fonts/.
      const font = /^\/fonts\/([A-Za-z0-9._-]+\.(?:woff2|md))$/.exec(p);
      if (font) {
        if (await serveFile(res, path.join(OUT_DIR, 'fonts', font[1]!))) return;
        if (await serveFile(res, path.join(PUBLIC_DIR, 'fonts', font[1]!))) return;
        text(res, 404, 'not found');
        return;
      }

      // Generated artwork
      const asset = /^\/assets\/([a-z0-9-]+)\/([A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp))$/.exec(p);
      if (asset) {
        const rel = `${asset[1]}/${asset[2]}`;
        if (ASSET_RE.test(rel) && (await serveFile(res, path.join(OUT_DIR, 'assets', rel)))) return;
        text(res, 404, 'not found');
        return;
      }

      text(res, 404, 'not found');
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'server error' });
    }
  })();
});

server.listen(PORT, HOST, () => {
  const service = resolveImageService();
  const loopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  console.log(`\n  TurboSlop control surface`);
  console.log(`  http://${loopback ? HOST : 'localhost'}:${PORT}${loopback ? '' : `   (bound to ${HOST})`}\n`);
  console.log(`  out dir      ${OUT_DIR}`);
  console.log(`  Jev          ${hasApiKey() ? 'live (TYPESAFE_API_KEY set)' : 'local stand-in (no key)'}`);
  console.log(`  copywriter   ${describeLlm(resolveLlm())}`);
  console.log(`  images       ${describeImageService(service)}`);
  if (!loopback) {
    console.log('');
    console.log(`  note         Bound to ${HOST}, and this surface has NO authentication.`);
    console.log(`               Anyone who can reach port ${PORT} can spend your API credits.`);
    console.log(`               Keep it on a private network (tailnet/VPN), or front it with`);
    console.log(`               an authenticating proxy. Set FORGE_HOST=127.0.0.1 to go local.`);
  }
  console.log('');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
