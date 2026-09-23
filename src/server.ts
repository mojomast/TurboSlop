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
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES, ATMOSPHERE, PALETTE_VISUAL } from './catalog.js';
import { describeFontPack, FONT_PACK } from './fonts.js';
import { FRAME_KINDS, frameForLead } from './frames.js';
import { ICON_FAMILIES, ICON_NAMES } from './icons.js';
import { LUCIDE_ICON_NAMES } from './iconpacks.js';
import { MOTIF_FAMILIES, motifFamilyForEmotion } from './motifs.js';
import { hasApiKey } from './jev.js';
import { IMAGE_PRESETS, describeImageService, resolveImageService } from './images.js';
import { INTEROP_2026_FEATURES, MODERN_CSS_FEATURES } from './layout.js';
import { describeLlm, resolveLlm } from './llm.js';
import { jevCost, writerCost } from './pricing.js';
import { runPipeline, slugify } from './pipeline.js';
import { getDesign, listDesigns, nextIterationSlug, recordDesign, uniqueSlug } from './registry.js';
import {
  LockError,
  SELECTION_VERSION,
  assertLocksAreCompatible,
  createSession,
  finalizeSession,
  listSessions,
  loadSession,
  normalizeLocks,
  regenerateSession,
  reviseSession,
  saveSession,
  type DirectionSession,
} from './sessions.js';
import { buildZip, contentDisposition, inlineAssets } from './export.js';
import { projectId, listHistoryProjects } from './history.js';
import { imageSize } from './userassets.js';
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
/**
 * Read a JSON body.
 *
 * `maxBytes` is per-route: uploads of real photographs need more than the
 * default API limit, and giving EVERY route a large limit would be the wrong
 * trade.
 */
async function readBody(req: http.IncomingMessage, maxBytes = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new Error(`request body too large (limit ${maxBytes} bytes)`);
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

  /* Heartbeat while the shared inventory is being written — that is the slow
     step (~10 s with a real writer) and the surface must not look frozen. */
  const heartbeat = setInterval(() => {
    if (job.state !== 'running') return;
    const secs = Math.round((Date.now() - job.startedAt) / 1000);
    emit(job, {
      phase: 'content',
      message: `still writing the shared inventory… (${secs}s so far — one writer call covers all six previews)`,
      at: Date.now(),
    });
  }, 3000);
  heartbeat.unref?.();

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
        /* Progress while the shared inventory is being written — the slowest
           step. Without this the surface looks frozen for ~10 s. */
        onProgress: (e) => emit(job, { phase: e.phase, message: e.message, at: Date.now() }),
      });
      emit(
        job,
        { phase: 'content', message: `Inventory: ${session.inventorySource} (${session.metrics.modelCalls} model calls total)`, at: Date.now() },
      );
      emit(job, { phase: 'render', message: `${session.directions.length} directions rendered locally`, at: Date.now() });
      const div = session.diversity;
      job.result = {
        sessionId: session.id,
        notes: [
          session.previewLabel,
          `compositions ${div.achieved.compositions}/${div.targets.compositions} · ` +
            `headline constructions ${div.achieved.constructions}/${div.targets.constructions} · ` +
            `treatments ${div.achieved.treatments}/${div.targets.treatments} · ` +
            `grayscale-distinct ${div.achieved.grayscaleDistinct}/${div.targets.grayscaleDistinct}` +
            (div.met ? ' — all targets met' : ` — missed: ${div.shortfall.map((s) => s.target).join(', ')}`),
          ...session.directions.map((d) => d.blueprint),
        ],
        timings: {
          decideMs: session.metrics.decideMs,
          inventoryMs: session.metrics.inventoryMs,
          renderMs: session.metrics.renderMs,
          assetsMs: session.metrics.assetsMs,
          totalMs: session.metrics.totalMs,
          modelCalls: session.metrics.modelCalls,
          estimateUsd: session.metrics.estimateUsd,
        },
      };
      job.state = 'done';
      clearInterval(heartbeat);
      emit(job, { phase: 'end' });
    } catch (err) {
      job.state = 'error';
      clearInterval(heartbeat);
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
    images?: { enabled: boolean; count: number; preset: string; steps?: number; cfg?: number; seed?: number };
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
      if (opts.images?.enabled) {
        emit(job, { phase: 'images', message: `Asset plan for ${chosen.blueprint} (${chosen.imageSlots.length} renderable slot(s))`, at: Date.now() });
      }
      const { spec, write, notes, placement, assetMs } = await finalizeSession(OUT_DIR, session, slug, {
        index,
        finalCopy: opts.finalCopy,
        ...(opts.images ? { images: opts.images } : {}),
        ...(opts.userImages?.length ? { userImages: opts.userImages, userImageRoot: opts.userImageRoot } : {}),
      });

      await recordDesign(OUT_DIR, {
        slug,
        brief: session.brief,
        ...(spec.content?.brand ? { title: spec.content.brand } : {}),
        source: 'surface',
      });

      emit(job, { phase: 'write', message: `Wrote ${slug}.html`, at: Date.now() });
      job.result = {
        slug,
        sessionId: session.id,
        composite: spec.composite.normalized,
        notes: [
          write.source === 'llm'
            ? `final copy: ${write.model} in ${write.latencyMs}ms`
            : 'final copy: shared inventory (no extra writer call)',
          `direction ${chosen.id} — blueprint ${chosen.blueprint}, seed ${chosen.seed}`,
          `assets: ${spec.assets.length} on the page (${placement.checked} slot-checked${placement.ok ? '' : `, ${placement.issues.length} issue(s)`})`,
          ...notes,
          ...(chosen.diagnostics.length ? chosen.diagnostics : []),
        ],
        timings: {
          writerMs: write.latencyMs,
          assetMs,
          /* At most one model call here — the final-copy write — and none when
             the shared inventory is reused. */
          modelCalls: write.source === 'llm' ? 1 : 0,
          totalMs: Date.now() - job.startedAt,
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
 * Revise the chosen design — a SCOPED change, not a regeneration.
 *
 * Zero or one writer call, never a Jev call, never a re-selection: the stored
 * resolved spec is the input and only what the request names may move.
 */
async function startReviseJob(session: DirectionSession, instructions: string, finalCopy: boolean): Promise<Job> {
  const parentSlug = session.finalSlug!;
  const slug = await nextIterationSlug(OUT_DIR, parentSlug);
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
      emit(job, { phase: 'content', message: `Applying a scoped revision to ${parentSlug}…`, at: Date.now() });
      const result = await reviseSession(OUT_DIR, session, {
        instructions,
        finalCopy,
      });
      const parent = await getDesign(OUT_DIR, parentSlug);
      await recordDesign(OUT_DIR, {
        slug: result.slug,
        brief: session.brief,
        parent: parentSlug,
        revision: (parent?.record.revision ?? 1) + 1,
        ...(result.spec.content?.brand ? { title: result.spec.content.brand } : {}),
        source: 'surface',
      });
      emit(job, { phase: 'write', message: `Wrote ${result.slug}.html (${result.scope} revision)`, at: Date.now() });
      job.result = {
        slug: result.slug,
        sessionId: session.id,
        notes: [`scope: ${result.scope}`, ...result.notes],
        timings: {
          writerMs: result.writerMs,
          modelCalls: result.modelCalls,
          totalMs: Date.now() - job.startedAt,
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
        /** The vendored Lucide family, and the families a page may choose from. */
        lucideIcons: [...LUCIDE_ICON_NAMES],
        iconFamilies: [...ICON_FAMILIES],
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
      /** Project scoping for recent-design history (novelty across runs). */
      project: projectId(),
      historyProjects: await listHistoryProjects(OUT_DIR),
      /** Which selection algorithm is running — recorded for reproducibility. */
      selectionVersion: SELECTION_VERSION,
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
      const buf = await buildZip(OUT_DIR, slug);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition(`${slug}.zip`),
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
      text(res, 200, await inlineAssets(html, OUT_DIR), 'text/html; charset=utf-8');
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
        batch: s.batch ?? 0,
        versions: s.versions?.length ?? 0,
        locks: s.locks?.length ?? 0,
        selectedDirectionId: s.selectedDirectionId ?? null,
        selectionVersion: s.selectionVersion ?? 'unknown',
        /** Diversity of the CURRENT batch — targets and whether they were met. */
        diversity: s.diversity
          ? { met: s.diversity.met, achieved: s.diversity.achieved, targets: s.diversity.targets }
          : null,
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

  /**
   * Record the human's choice and locks. Deliberately model-free.
   *
   * Locks arrive as `{name, value?, fromIndex}` (or a bare axis name, resolved
   * against the card they came from). Each is bound to an EXPLICIT value and
   * an explicit source direction, then validated for unknown names and
   * incompatible combinations — with an explanation, never silently dropped.
   */
  const selectRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/select$/.exec(p);
  if (selectRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, selectRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    try {
      const body = (await readBody(req)) as {
        index?: number;
        locks?: (string | { name: string; value?: string; fromIndex?: number })[];
      };
      const index = typeof body.index === 'number' ? body.index : null;
      if (index !== null && !s.directions[index]) return json(res, 400, { error: 'no such direction' }), true;
      let locks = s.locks;
      if (Array.isArray(body.locks)) {
        const inputs = body.locks.filter(
          (x): x is string | { name: string; value?: string; fromIndex?: number } =>
            typeof x === 'string' || (typeof x === 'object' && x !== null && typeof x.name === 'string'),
        );
        locks = normalizeLocks(s, inputs, index ?? s.selectedIndex);
        // Compatibility (composition vs blueprint, etc.) is checked here, not
        // discovered later at regeneration time.
        assertLocksAreCompatible(locks);
      }
      s.selectedIndex = index;
      if (index !== null) s.selectedDirectionId = s.directions[index]?.id ?? null;
      s.locks = locks;
      s.history.push({
        at: new Date().toISOString(),
        event: 'selected',
        detail:
          `direction ${index}` +
          (locks.length
            ? `, locked ${locks.map((l) => `${l.name}=${l.value} (from #${l.fromIndex + 1})`).join('; ')}`
            : ''),
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
      const body = (await readBody(req)) as {
        locks?: (string | { name: string; value?: string; fromIndex?: number })[];
        fromIndex?: number;
        count?: number;
        seed?: number;
      };
      const updated = await regenerateSession(OUT_DIR, s, {
        ...(Array.isArray(body.locks) ? { locks: body.locks } : {}),
        ...(typeof body.fromIndex === 'number' ? { fromIndex: body.fromIndex } : {}),
        ...(typeof body.count === 'number' ? { count: body.count } : {}),
        ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
      });
      json(res, 200, { session: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bad request';
      // Lock problems are a 400 with the explanation the human can act on.
      json(res, 400, { error: message, lockError: err instanceof LockError });
    }
    return true;
  }

  /** Finalize a chosen direction into a real, exportable design. */
  const finRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/finalize$/.exec(p);
  if (finRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, finRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    try {
      const body = (await readBody(req)) as {
        index?: number;
        finalCopy?: boolean;
        images?: { enabled?: boolean; count?: number; preset?: string; steps?: number; cfg?: number; seed?: number };
        userImages?: DesignRequest['userImages'];
      };
      const index = typeof body.index === 'number' ? body.index : (s.selectedIndex ?? 0);
      if (!s.directions[index]) return json(res, 400, { error: 'no such direction' }), true;
      const userImages = readUserImages(body.userImages);
      /* UI uploads live under the output directory (uploads/…); paths coming
         from the composer resolve inside FORGE_USER_IMAGE_DIR as before. */
      const uploadsOnly = userImages.length > 0 && userImages.every((u) => u.path.startsWith('uploads/'));
      const job = await startFinalizeJob(s, index, {
        finalCopy: body.finalCopy !== false,
        images: readImageOptions(body.images),
        userImages,
        userImageRoot: uploadsOnly ? OUT_DIR : USER_IMAGE_ROOT,
      });
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /**
   * "A revision of this design" — deliberately a separate endpoint from
   * regenerating directions, and separate from "explore new directions".
   * A scoped change to the chosen resolved spec: copy-only edits preserve
   * layout, styling, seed and assets; visual edits preserve everything the
   * request does not name. It never re-runs the decision or the selection.
   */
  const reviseRoute = /^\/api\/sessions\/(ses_[a-z0-9]+)\/revise$/.exec(p);
  if (reviseRoute && method === 'POST') {
    const s = await loadSession(OUT_DIR, reviseRoute[1]!);
    if (!s) return json(res, 404, { error: 'session not found' }), true;
    if (!s.finalSlug) return json(res, 400, { error: 'finalize the direction first, then revise it' }), true;
    try {
      const body = (await readBody(req)) as { instructions?: string; finalCopy?: boolean };
      const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
      if (!instructions) return json(res, 400, { error: 'instructions are required' }), true;
      const job = await startReviseJob(s, instructions, body.finalCopy !== false);
      json(res, 202, { jobId: job.id, slug: job.slug });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'bad request' });
    }
    return true;
  }

  /**
   * Image import: upload a real photograph, then assign it to a slot when
   * finalizing. Local files only (no URL fetching), magic-byte validated,
   * written under the output directory so exports can carry it.
   */
  if (p === '/api/uploads' && method === 'POST') {
    try {
      const body = (await readBody(req, 16 * 1024 * 1024)) as {
        name?: string;
        dataUrl?: string;
        alt?: string;
        credit?: string;
        license?: string;
      };
      if (typeof body.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(body.dataUrl)) {
        return json(res, 400, { error: 'dataUrl must be a base64 PNG, JPEG, WebP or GIF data URL' }), true;
      }
      const match = /^data:image\/(png|jpeg|webp|gif);base64,(.*)$/.exec(body.dataUrl)!;
      const bytes = Buffer.from(match[2]!, 'base64');
      if (!bytes.length) return json(res, 400, { error: 'the decoded image is empty' }), true;
      const size = imageSize(bytes);
      if (size.format === 'unknown') {
        return json(res, 400, { error: 'that file is not a PNG, JPEG, WebP or GIF (checked the header bytes)' }), true;
      }
      const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', unknown: 'bin' }[size.format];
      const base = slugify((body.name ?? 'upload').replace(/\.[a-z0-9]+$/i, '')) || 'upload';
      const dir = path.join(OUT_DIR, 'uploads');
      await mkdir(dir, { recursive: true });
      const name = `${base}-${randomUUID().slice(0, 8)}.${ext}`;
      await writeFile(path.join(dir, name), bytes);
      json(res, 201, {
        path: `uploads/${name}`,
        root: OUT_DIR,
        bytes: bytes.length,
        width: size.width,
        height: size.height,
        format: size.format,
        alt: typeof body.alt === 'string' ? body.alt : '',
        credit: typeof body.credit === 'string' ? body.credit : '',
        license: typeof body.license === 'string' ? body.license : '',
        note: 'assign this path to a slot when finalizing — slots this layout renders are listed on each direction card',
      });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'upload failed' });
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
         /preview/<id>/ finds its fonts at /preview/<id>/fonts/.
         Batch paths are explicit — `/preview/<sid>/b2/1` is the SECOND batch's
         second direction and keeps resolving after later regenerations, so a
         saved preview link never breaks. A document at /preview/<sid>/b2/1
         resolves its relative fonts/ against /preview/<sid>/b2/, so the batch
         prefix must be stripped BEFORE matching fonts/ and assets/ —
         otherwise archived pages render with fallback faces. */
      const preview = /^\/preview\/([a-z0-9_-]+)\/(.*)$/.exec(p);
      if (preview) {
        const id = preview[1]!;
        const full = preview[2] ?? '';
        /* Relative refs resolve against the document's DIRECTORY: a page at
           /preview/<sid>/b2/1 asks for /preview/<sid>/b2/fonts/… — so the
           batch prefix is stripped only when matching fonts/assets, never
           when resolving the batch's own file. */
        const rest = full.replace(/^b\d+\//, '');

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
        if (full === '' || full === 'index.html') {
          if (await serveFile(res, path.join(OUT_DIR, `${id}.html`))) return;
          const s = await loadSession(OUT_DIR, id);
          if (s && (await serveFile(res, path.join(OUT_DIR, s.previewDir, '0.html')))) return;
          // Legacy sessions predate batch directories.
          if (await serveFile(res, path.join(OUT_DIR, 'previews', id, '0.html'))) return;
          text(res, 404, 'not found');
          return;
        }
        // An explicit batch: /preview/<sessionId>/b<n>/<k>
        const batched = /^b(\d+)\/(\d+)$/.exec(full);
        if (batched) {
          const file = path.join(OUT_DIR, 'previews', id, `b${batched[1]}`, `${batched[2]}.html`);
          if (await serveFile(res, file)) return;
          text(res, 404, 'not found');
          return;
        }
        // The current batch: /preview/<sessionId>/<k>
        if (/^\d+$/.test(full)) {
          const s = await loadSession(OUT_DIR, id);
          const dir = s?.previewDir ?? path.posix.join('previews', id);
          if (await serveFile(res, path.join(OUT_DIR, dir, `${full}.html`))) return;
          if (await serveFile(res, path.join(OUT_DIR, 'previews', id, `${full}.html`))) return;
          text(res, 404, 'not found');
          return;
        }
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
