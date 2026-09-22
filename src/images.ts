/**
 * TurboSlop — image generation (Supra2 hosted inference).
 *
 * Generates visual assets for a composed design. Enabled explicitly; every
 * parameter the service exposes is surfaced rather than hidden.
 *
 * ## Service facts this module is built around
 *  - Private Tailscale-only service. Requests are made server-side; the URL is
 *    allowlisted and never taken from user input.
 *  - `POST /api/generate` takes EXACTLY {prompt, seed, steps, cfg}.
 *  - POSTs additionally require an `Origin` header matching the service. It is a
 *    request check, not a credential.
 *  - Native output is 256x256 PNG. No other resolution, no negative prompt,
 *    no img2img, no upscaling.
 *  - Submission returns HTTP 202 with a job id; results arrive via `/api/status`.
 *  - Only one batch runs at a time, so HTTP 429 means "busy" — back off, never
 *    hammer it, and never cancel service-wide work.
 *  - `/api/cancel` cancels EVERY queued image service-wide. It is deliberately
 *    NOT exposed by this module. Discarding a result is done locally.
 *  - History retention is 256 entries, so completed art is persisted
 *    immediately rather than referenced in place.
 *
 * ## The mistake this module is written to avoid
 * `/api/status` returns the whole service history — every user's prompts and
 * job ids. We therefore track ONLY the ids we submitted ourselves, and never
 * surface an unknown job. Filtering happens at the boundary, not at the display
 * layer, so private prompts cannot leak through a later refactor.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paletteVisual } from './catalog.js';
import type { DesignSpec } from './types.js';

/** Response cap for a 256x256 PNG. Anything larger is not our image. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class ImageServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ImageServiceError';
  }
}

/* ------------------------------------------------------------------ *
 * Configuration
 *
 * Deliberately transport-agnostic. Any reachable HTTP endpoint that speaks this
 * API works — a service on localhost, one on your LAN, one behind Tailscale, or
 * one behind a VPN/reverse proxy. Tailscale is a convenient way to reach a
 * private box, not a requirement, and nothing here assumes it.
 *
 * Images are OFF unless FORGE_IMAGE_BASE_URL is set.
 * ------------------------------------------------------------------ */
export interface ImageServiceConfig {
  baseUrl: string;
  timeoutMs: number;
  pollTimeoutMs: number;
  /** Optional auth, for services that need more than network reachability. */
  authHeader?: { name: string; value: string };
  /** Value sent as `Origin`. Some services check it; it is not a credential. */
  origin: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the image service from the environment.
 *
 * Security posture: the endpoint is allowlisted so a crafted request can never
 * turn this into an arbitrary fetch proxy. localhost is always permitted;
 * anything else must be named in FORGE_IMAGE_ALLOW_HOSTS, or the allowlist must
 * be explicitly disabled with FORGE_IMAGE_ALLOW_ANY_HOST=1 for a trusted
 * private network.
 */
export function resolveImageService(): ImageServiceConfig | null {
  const raw = process.env.FORGE_IMAGE_BASE_URL?.trim();
  if (!raw) return null; // not configured -> image generation is simply off

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const allowAny = process.env.FORGE_IMAGE_ALLOW_ANY_HOST === '1';
  const allowed = new Set([...LOCAL_HOSTS, ...splitList(process.env.FORGE_IMAGE_ALLOW_HOSTS)]);
  if (!allowAny && !allowed.has(url.hostname)) return null;

  const token = process.env.FORGE_IMAGE_TOKEN?.trim();
  const headerName = process.env.FORGE_IMAGE_TOKEN_HEADER?.trim() || 'Authorization';
  let value: string | undefined;
  if (token) {
    const isAuth = headerName.toLowerCase() === 'authorization';
    value = isAuth && !/^bearer\s/i.test(token) ? `Bearer ${token}` : token;
  }

  const origin = process.env.FORGE_IMAGE_ORIGIN?.trim() || `${url.protocol}//${url.host}`;

  return {
    baseUrl: `${url.protocol}//${url.host}`,
    timeoutMs: Number(process.env.FORGE_IMAGE_TIMEOUT_MS ?? 20_000),
    pollTimeoutMs: Number(process.env.FORGE_IMAGE_POLL_TIMEOUT_MS ?? 180_000),
    ...(value ? { authHeader: { name: headerName, value } } : {}),
    origin,
  };
}

/** Human description of the configured backend, for logs and the control surface. */
export function describeImageService(cfg: ImageServiceConfig | null): string {
  if (!cfg) return 'off (set FORGE_IMAGE_BASE_URL to enable)';
  const tls = cfg.baseUrl.startsWith('https:') ? 'https' : 'http';
  const auth = cfg.authHeader ? ` + ${cfg.authHeader.name}` : '';
  return `${cfg.baseUrl} (${tls}${auth})`;
}

/** Headers for a request to the service. */
function serviceHeaders(cfg: ImageServiceConfig, json = false): Record<string, string> {
  const h: Record<string, string> = { Origin: cfg.origin };
  if (json) h['Content-Type'] = 'application/json';
  if (cfg.authHeader) h[cfg.authHeader.name] = cfg.authHeader.value;
  return h;
}

/* ------------------------------------------------------------------ *
 * Presets — workflow defaults, NOT claims of equivalent quality.
 * ------------------------------------------------------------------ */
export interface ImagePreset {
  steps: number;
  cfg: number;
  label: string;
  note: string;
}

export const IMAGE_PRESETS: Record<string, ImagePreset> = {
  turbo: {
    steps: 4, cfg: 2, label: 'Turbo',
    note: 'Draft only. ~1.2 s measured. Use to explore compositions, not to ship.',
  },
  preview: {
    steps: 10, cfg: 3, label: 'Preview',
    note: '~3.4 s measured. Enough to judge composition and palette.',
  },
  balanced: {
    steps: 20, cfg: 3, label: 'Balanced',
    note: 'The default working setting. ~6.0 s measured.',
  },
  reference: {
    steps: 50, cfg: 3, label: 'Reference',
    note: 'The vendor quality baseline. ~12.7 s measured; use for final art.',
  },
  fast: {
    steps: 20, cfg: 1, label: 'Fast (guidance 1)',
    note: 'Experimental. At guidance 1 the sampler skips the unconditional prediction, so it is cheaper (~4.3 s measured vs ~6.0 s). Prompt adherence may weaken — not equivalent to guidance 3.',
  },
};

/**
 * Practical character ceiling per prompt.
 *
 * Measured with the model's real text encoder: 128 tokens is roughly 85-105
 * English words, or ~430-500 characters. The API accepts 1000 characters, which
 * is about twice the encoder budget — anything past the limit is silently
 * truncated, so the tail of a long prompt is simply lost. We keep well inside it
 * and put the subject first so truncation would cost the least important clause.
 */
export const PROMPT_CHAR_BUDGET = 430;

/** Returns a warning when a prompt is long enough to be silently truncated. */
export function promptBudgetWarning(prompt: string): string | null {
  const n = prompt.trim().length;
  if (n <= PROMPT_CHAR_BUDGET) return null;
  return (
    `prompt is ${n} characters; the encoder truncates around ${PROMPT_CHAR_BUDGET}. ` +
    `Put the subject and composition first — the tail will be dropped.`
  );
}

/** Resolve steps/cfg from an explicit override or a named preset. */
export function resolveImageSettings(args: {
  imagePreset: string;
  imageSteps?: number;
  imageCfg?: number;
}): { steps: number; cfg: number; preset: ImagePreset } {
  const preset = IMAGE_PRESETS[args.imagePreset] ?? IMAGE_PRESETS.balanced!;
  return {
    steps: args.imageSteps ?? preset.steps,
    cfg: args.imageCfg ?? preset.cfg,
    preset,
  };
}

/* ------------------------------------------------------------------ *
 * Prompting
 *
 * Written to the model's real constraints: a ~128-token encoder (so a
 * 1000-character prompt is not automatically safe), 256x256 output (so tiny
 * detail, crowds and lettering are wasted), and no negative-prompt parameter
 * (so "no text" is a request, not a guarantee).
 *
 * Order: subject and focal feature -> composition -> light -> material -> style.
 * ------------------------------------------------------------------ */
export interface AssetPrompt {
  kind: 'surface' | 'motif' | 'backdrop';
  prompt: string;
}

const SURFACE_BY_EMOTION: Record<string, string> = {
  awe: 'a vast dim chamber wall, faint cold light grazing rough stone, deep shadow',
  serenity: 'a soft mineral surface, pale sage and warm clay tones, gentle diffused light',
  delight: 'a bright confectionery surface, glossy candy colours, soft rounded shapes',
  tension: 'a bare machined metal panel, hard edge lighting, high contrast, utilitarian',
  nostalgia: 'aged laid paper, warm cream tone, faint foxing and ink absorption',
  mystery: 'a dark plaster wall lit by a single candle, deep violet shadow',
  trust: 'a clean matte white surface, even institutional light, no texture noise',
  energy: 'a scratched lacquered panel catching acid-green light, hard diagonal highlight',
  intimacy: 'a warm linen cloth, oatmeal weave, quiet daylight from the side',
  optimism: 'a pearlescent glass surface, soft violet to peach iridescence, bright air',
  other: 'a calm abstract surface, soft gradient light, restrained colour',
};

/**
 * The style clause appended to every asset prompt.
 *
 * Built from the palette's VISIBLE characteristics, never its id — see
 * PALETTE_VISUAL for why. The emotion contributes a material/lighting word so
 * the image reads in the same register as the page.
 */
const TEXTURE_BY_EMOTION: Record<string, string> = {
  awe: 'vast, dim, atmospheric',
  serenity: 'soft, calm, diffused',
  delight: 'bright, glossy, playful',
  tension: 'hard-edged, industrial, high-contrast',
  nostalgia: 'printed, grainy, warm',
  mystery: 'shadowed, candlelit, secretive',
  trust: 'clean, even, clinical',
  energy: 'fast, saturated, aggressive',
  intimacy: 'warm, handmade, close',
  optimism: 'airy, luminous, buoyant',
  other: 'restrained, neutral',
};

function styleFor(spec: DesignSpec): string {
  const visual = paletteVisual(spec.tokens.palette ?? '');
  const texture = TEXTURE_BY_EMOTION[spec.tokens.emotion ?? 'other'] ?? 'restrained, neutral';
  return `painterly digital illustration, clear silhouettes, ${texture} mood, ${visual}`;
}

/**
 * Build prompts for the number of images requested.
 *
 * Deliberately concrete and unoccupied: at 256x256 a clear silhouette survives
 * and clutter does not. Each prompt stays short so it is not silently truncated
 * by the encoder.
 */
export function buildAssetPrompts(spec: DesignSpec, count: number): AssetPrompt[] {
  const emotion = spec.tokens.emotion ?? 'other';
  const surface = SURFACE_BY_EMOTION[emotion] ?? SURFACE_BY_EMOTION.other!;
  const style = styleFor(spec);

  const templates: AssetPrompt[] = [
    {
      kind: 'backdrop',
      prompt: `Wide abstract backdrop of ${surface}. Simple composed view, one clear focal plane, generous negative space, unoccupied. Soft directional light and drifting haze. ${style}.`,
    },
    {
      kind: 'surface',
      prompt: `Flat texture study of ${surface}. Straight-on view filling the frame, even lighting, plain continuous surface, minimal contrast variation. ${style}.`,
    },
    {
      kind: 'motif',
      prompt: `A single simple geometric form suggesting ${emotion}, centred on a plain undecorated ground. Strong silhouette, viewed slightly from above. Soft rim light, faint shadow. ${style}.`,
    },
  ];

  return Array.from({ length: Math.max(1, count) }, (_, i) => templates[i % templates.length]!);
}

/**
 * Assert our own templates stay inside the encoder budget. Our prompts are
 * generated, so an over-long one is a bug in this file, not user error.
 */
export function assertPromptsWithinBudget(prompts: AssetPrompt[]): void {
  for (const p of prompts) {
    const w = promptBudgetWarning(p.prompt);
    if (w) throw new ImageServiceError(`built prompt exceeds the encoder budget: ${w}`);
  }
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */
async function post(cfg: ImageServiceConfig, route: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await fetch(`${cfg.baseUrl}${route}`, {
      method: 'POST',
      headers: serviceHeaders(cfg, true),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface SubmitResult {
  ids: string[];
  batch: string;
}

/** Validate the exact payload shape the service accepts. */
export function validateGenerate(prompt: string, seed: number, steps: number, cfg: number): void {
  const p = prompt.trim();
  if (p.length < 1 || p.length > 1000) {
    throw new ImageServiceError(`prompt must be 1-1000 characters after trimming (got ${p.length})`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    throw new ImageServiceError(`seed must be an integer 0-2147483647 (got ${seed})`);
  }
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) {
    throw new ImageServiceError(`steps must be an integer 1-100 (got ${steps})`);
  }
  if (!Number.isFinite(cfg) || cfg < 1 || cfg > 10) {
    throw new ImageServiceError(`cfg must be a finite number 1-10 (got ${cfg})`);
  }
}

export async function submitGenerate(
  cfgService: ImageServiceConfig,
  prompt: string,
  seed: number,
  steps: number,
  cfg: number,
): Promise<SubmitResult> {
  validateGenerate(prompt, seed, steps, cfg);
  const res = await post(cfgService, '/api/generate', {
    prompt: prompt.trim(),
    seed,
    steps,
    cfg,
  });
  if (res.status === 429) {
    throw new ImageServiceError('Image service is busy (429); another batch is running', 429, true);
  }
  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    throw new ImageServiceError(`submit failed: HTTP ${res.status} ${body.slice(0, 200)}`, res.status, res.status >= 500);
  }
  const json = (await res.json()) as { id?: string; batch?: string; ids?: string[] };
  const ids = json.ids ?? (json.id ? [json.id] : []);
  if (!ids.length) throw new ImageServiceError('submit returned no job id');
  return { ids, batch: json.batch ?? '' };
}

/** Batch: one prompt, N random seeds, swept across steps/guidance combos. */
export async function submitBatch(
  cfgService: ImageServiceConfig,
  prompt: string,
  count: number,
  steps: number[],
  guidance: number[],
): Promise<SubmitResult> {
  const total = count * steps.length * guidance.length;
  if (count < 1 || count > 32) throw new ImageServiceError(`count must be 1-32 (got ${count})`);
  if (steps.length < 1 || steps.length > 8) throw new ImageServiceError('steps array must have 1-8 values');
  if (guidance.length < 1 || guidance.length > 8) throw new ImageServiceError('guidance array must have 1-8 values');
  if (total > 128) throw new ImageServiceError(`batch would queue ${total} images; the limit is 128`);

  const res = await post(cfgService, '/api/batch', {
    prompt: prompt.trim(),
    count,
    steps,
    guidance,
  });
  if (res.status === 429) {
    throw new ImageServiceError('Image service is busy (429); another batch is running', 429, true);
  }
  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    throw new ImageServiceError(`batch failed: HTTP ${res.status} ${body.slice(0, 200)}`, res.status, res.status >= 500);
  }
  const json = (await res.json()) as { id?: string; batch?: string; ids?: string[] };
  const ids = json.ids ?? (json.id ? [json.id] : []);
  if (!ids.length) throw new ImageServiceError('batch returned no job ids');
  return { ids, batch: json.batch ?? '' };
}

/* ------------------------------------------------------------------ *
 * Status polling — filtered to OUR ids only.
 * ------------------------------------------------------------------ */
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobStatus {
  id: string;
  status: JobState;
  prompt: string;
  seed: number;
  steps: number;
  cfg: number;
  image?: string;
  seconds?: number;
}

interface RawJob {
  id?: string;
  status?: string;
  prompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  image?: string;
  seconds?: number;
}

const STATES = new Set(['queued', 'running', 'done', 'failed', 'cancelled']);

/**
 * Read status and return ONLY the jobs we asked about.
 *
 * The endpoint returns the entire service history, including other users'
 * prompts. Restricting to `wanted` here — at the boundary — means a private
 * prompt cannot reach our output even if a caller later logs the result.
 */
export async function pollJobs(
  cfgService: ImageServiceConfig,
  wanted: Set<string>,
): Promise<JobStatus[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfgService.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfgService.baseUrl}/api/status`, {
      headers: serviceHeaders(cfgService),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ImageServiceError(`status failed: HTTP ${res.status}`, res.status, res.status >= 500);

  const json = (await res.json()) as { jobs?: RawJob[] };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];

  const out: JobStatus[] = [];
  for (const j of jobs) {
    if (!j.id || !wanted.has(j.id)) continue; // never surface an unknown job
    const status = (j.status ?? 'queued') as JobState;
    if (!STATES.has(status)) continue;
    out.push({
      id: j.id,
      status,
      prompt: j.prompt ?? '',
      seed: j.seed ?? 0,
      steps: j.steps ?? 0,
      cfg: j.cfg ?? 0,
      image: j.image,
      seconds: j.seconds,
    });
  }
  return out;
}

/** Poll until every wanted job reaches a terminal state, or we time out. */
export async function waitForJobs(
  cfgService: ImageServiceConfig,
  wanted: Set<string>,
  opts: { pollMs?: number; timeoutMs?: number; onTick?: (jobs: JobStatus[]) => void } = {},
): Promise<JobStatus[]> {
  const pollMs = opts.pollMs ?? 800;
  const deadline = Date.now() + (opts.timeoutMs ?? cfgService.pollTimeoutMs);
  let backoff = pollMs;
  let last: JobStatus[] = [];

  while (Date.now() < deadline) {
    try {
      last = await pollJobs(cfgService, wanted);
      backoff = pollMs;
    } catch (err) {
      // Busy or transient: widen the interval rather than hammering.
      backoff = Math.min(backoff * 2, 5000);
      if (Date.now() >= deadline) throw err;
    }
    opts.onTick?.(last);
    const settled = last.filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled');
    if (last.length > 0 && settled.length === last.length) return last;
    await new Promise((r) => setTimeout(r, backoff));
  }
  return last;
}

/* ------------------------------------------------------------------ *
 * Download + persist
 * ------------------------------------------------------------------ */
/** Resolve a returned image path against the configured origin, safely. */
export function resolveImageUrl(cfgService: ImageServiceConfig, imagePath: string): string {
  if (!/^\/images\/[A-Za-z0-9._-]+\.png$/.test(imagePath)) {
    throw new ImageServiceError(`refusing unexpected image path: ${imagePath.slice(0, 120)}`);
  }
  return `${cfgService.baseUrl}${imagePath}`;
}

export async function fetchImage(cfgService: ImageServiceConfig, imagePath: string): Promise<Buffer> {
  const url = resolveImageUrl(cfgService, imagePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfgService.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { headers: serviceHeaders(cfgService), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ImageServiceError(`image fetch failed: HTTP ${res.status}`, res.status, res.status >= 500);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageServiceError(`image exceeds size cap (${buf.byteLength} bytes)`);
  }
  // Validate it really is a PNG rather than trusting Content-Type.
  if (buf.byteLength < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new ImageServiceError('response is not a PNG');
  }
  return buf;
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */
export interface GeneratedAsset {
  kind: AssetPrompt['kind'];
  prompt: string;
  seed: number;
  steps: number;
  cfg: number;
  file: string;
  bytes: number;
  seconds: number;
}

export interface ImageRunOptions {
  count: number;
  steps: number;
  cfg: number;
  /** Fixed seed for reproducibility; omit for a random one. */
  seed?: number;
  outDir: string;
  slug: string;
  service?: ImageServiceConfig;
  onProgress?: (msg: string) => void;
}

export interface ImageRunResult {
  assets: GeneratedAsset[];
  totalMs: number;
  service: ImageServiceConfig;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

/**
 * Generate `count` assets for a spec and persist them.
 *
 * One submission per image (not `/api/batch`) because we want explicit seed
 * control — a batch picks its own seeds. Submissions run sequentially: the
 * service processes one batch at a time, so parallel submits would only create
 * queue pressure for everyone else.
 */
export async function generateAssets(spec: DesignSpec, opts: ImageRunOptions): Promise<ImageRunResult> {
  const service = opts.service ?? resolveImageService();
  if (!service) throw new ImageServiceError('no image service configured (FORGE_IMAGE_BASE_URL not allowlisted)');

  const started = Date.now();
  const prompts = buildAssetPrompts(spec, opts.count);
  assertPromptsWithinBudget(prompts);
  const assets: GeneratedAsset[] = [];
  const dir = path.join(opts.outDir, 'assets', opts.slug);
  await mkdir(dir, { recursive: true });

  for (const [i, p] of prompts.entries()) {
    const seed = opts.seed !== undefined ? opts.seed + i : randomSeed();
    opts.onProgress?.(`[${i + 1}/${prompts.length}] ${p.kind} — steps ${opts.steps}, guidance ${opts.cfg}`);

    const sub = await submitGenerateWithBusyRetry(service, p.prompt, seed, opts.steps, opts.cfg);
    const wanted = new Set(sub.ids);
    const jobs = await waitForJobs(service, wanted, {
      timeoutMs: service.pollTimeoutMs,
      onTick: (js) => {
        const j = js[0];
        if (j && j.status === 'running') opts.onProgress?.(`    ${j.id.slice(0, 8)} running…`);
      },
    });

    const done = jobs.find((j) => j.status === 'done' && j.image);
    if (!done) {
      const bad = jobs.find((j) => j.status === 'failed' || j.status === 'cancelled');
      opts.onProgress?.(`    skipped (${bad?.status ?? 'timed out'}) — discarding locally, no service-wide cancel`);
      continue;
    }

    const buf = await fetchImage(service, done.image!);
    const file = path.join(dir, `${String(i).padStart(2, '0')}-${p.kind}-${done.seed}.png`);
    await writeFile(file, buf);
    assets.push({
      kind: p.kind,
      prompt: p.prompt,
      seed: done.seed,
      steps: done.steps,
      cfg: done.cfg,
      file,
      bytes: buf.byteLength,
      seconds: done.seconds ?? 0,
    });
  }

  return { assets, totalMs: Date.now() - started, service };
}

/**
 * Submit, backing off on 429 (service busy).
 *
 * A TIMEOUT is deliberately NOT retried: the service has no idempotency key, so
 * a request that timed out may already have been accepted. Retrying could
 * duplicate work and waste the shared GPU. The caller is told the submission is
 * ambiguous instead.
 */
async function submitGenerateWithBusyRetry(
  service: ImageServiceConfig,
  prompt: string,
  seed: number,
  steps: number,
  cfg: number,
  attempts = 4,
): Promise<SubmitResult> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await submitGenerate(service, prompt, seed, steps, cfg);
    } catch (err) {
      last = err;
      const busy = err instanceof ImageServiceError && err.status === 429;
      if (!busy || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  const ambiguous = !(last instanceof ImageServiceError) || last.status === undefined;
  if (ambiguous) {
    throw new ImageServiceError(
      `submission outcome is UNKNOWN for seed ${seed}; not retrying automatically because the service has no idempotency key and may already have accepted it. Original: ${String(last)}`,
      undefined,
      false,
    );
  }
  throw last;
}
