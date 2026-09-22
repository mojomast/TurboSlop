/**
 * TurboSlop — direction sessions.
 *
 * A session is what happens between "here is one brief" and "here is the design
 * I want": one decision call, one shared content inventory, and a set of preview
 * directions a human picks from.
 *
 * ## Why sessions exist
 *
 * The old flow was one brief → one page. Measured against the baseline, the same
 * brief produced the *same* page every time, because only the top-ranked choice
 * per axis was ever used. Producing several directions is only useful if they
 * can be compared, so a session owns:
 *
 *   - the decision response (persisted), so re-rendering or re-selecting NEVER
 *     triggers a second Jev call that could change what you are looking at;
 *   - ONE shared content inventory, so previewing six directions costs one
 *     writer call rather than six;
 *   - the preview HTML itself, rendered locally from the decision — no model is
 *     involved in turning a direction into a page.
 *
 * ## Cost model
 *
 *   previewing N directions   1 Jev call + 1 writer call + N local renders
 *   finalizing one direction  1 writer call (+ optional images)
 *
 * The second writer call exists because final copy is written FOR the chosen
 * blueprint and only for the modules it renders. Preview copy is a brief-level
 * inventory and the preview says so on its face.
 */
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BLUEPRINTS, MODULES, imageSlotsFor, requiredModules, type ModuleId } from './blueprint.js';
import { compose } from './compose.js';
import { fallbackContent, type Content } from './content.js';
import { decideWithFallback, type DeciderPreference, type DecideResult } from './decider.js';
import { buildDirections, type Direction, type Distributions } from './directions.js';
import { jevCost, writerCost } from './pricing.js';
import { navTargetsFor, sectionInstanceIds } from './render.js';
import { renderHtml } from './render.js';
import { ingestUserImages, type UserImageRequest } from './userassets.js';
import { writeContent } from './writer.js';
import { JevResponse, type DesignSpec } from './types.js';

export const SESSION_DIR = '.sessions';
export const PREVIEW_DIR = 'previews';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */
export interface DirectionStructure {
  hero: string;
  nav: string;
  footer: string;
  columns: number;
  rhythm: string;
  lead: string;
  /** Ordered rendered section ids, e.g. ['items','about','contact']. */
  sectionOrder: string[];
  /** Ordered `module:variant` pairs — the blueprint's actual block sequence. */
  blocks: string[];
  /** Ordered nav anchors, so the surface can verify they resolve. */
  navAnchors: string[];
}

export interface SessionDirection {
  index: number;
  id: string;
  blueprint: string;
  blueprintLabel: string;
  family: string;
  lead: string;
  fit: number;
  novelty: number;
  rationale: string;
  palette: string;
  typography: string;
  effects: string;
  motion: string;
  density: string;
  structure: DirectionStructure;
  /** Path of the preview HTML, relative to the output directory. */
  preview: string;
}

export interface SessionMetrics {
  decideMs: number;
  inventoryMs: number;
  renderMs: number;
  totalMs: number;
  /** Model calls made to produce the preview set. Should be 1 + 1. */
  modelCalls: number;
  estimateUsd: number;
}

export interface DirectionSession {
  version: 1;
  id: string;
  createdAt: string;
  brief: string;
  seed: number;
  explore: number;
  directionCount: number;
  decider: 'live' | 'local';
  /** The decision, kept so selection never needs another model call. */
  decision: {
    kind: 'live' | 'local';
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    response: unknown;
    fallbackReason?: string;
  };
  /** One shared inventory for every preview. */
  inventory: unknown;
  inventorySource: 'llm' | 'fallback';
  inventoryMeta: {
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    fallbackReason?: string;
  };
  /** The label shown on every preview, so a preview is never mistaken for a final. */
  previewLabel: string;
  directions: SessionDirection[];
  /** Axis names (or 'blueprint') the human has pinned. */
  locks: string[];
  selectedIndex: number | null;
  metrics: SessionMetrics;
  /** Set once finalised, pointing at the real design. */
  finalSlug?: string;
  /** Revision instructions applied to the selected direction, if any. */
  history: { at: string; event: string; detail?: string }[];
}

export interface CreateSessionOptions {
  brief: string;
  decider: DeciderPreference;
  seed?: number;
  explore?: number;
  count?: number;
  /** Stops immediately if true (tests / offline). */
  noWriter?: boolean;
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */
const sessionFile = (outDir: string, id: string) => path.join(outDir, SESSION_DIR, `${id}.json`);
/** Sessions are keyed by a strict id; never join a client string blindly. */
export function isSessionId(id: string): boolean {
  return /^ses_[a-z0-9]{8,32}$/.test(id);
}

export async function saveSession(outDir: string, session: DirectionSession): Promise<void> {
  await mkdir(path.join(outDir, SESSION_DIR), { recursive: true });
  await writeFile(sessionFile(outDir, session.id), JSON.stringify(session, null, 1), 'utf8');
}

export async function loadSession(outDir: string, id: string): Promise<DirectionSession | null> {
  if (!isSessionId(id)) return null;
  try {
    const raw = JSON.parse(await readFile(sessionFile(outDir, id), 'utf8')) as DirectionSession;
    if (raw.version !== 1 || raw.id !== id) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function listSessions(outDir: string): Promise<DirectionSession[]> {
  try {
    const files = await readdir(path.join(outDir, SESSION_DIR));
    const out: DirectionSession[] = [];
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const s = await loadSession(outDir, f.replace(/\.json$/, ''));
      if (s) out.push(s);
    }
    return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

/**
 * Copy the bundled fonts into the output directory.
 *
 * Pages reference `fonts/<file>` relatively, so the same HTML works from disk,
 * from the preview route, and inside an export without touching the network.
 */
export async function ensureBundledFonts(outDir: string, publicDir: string): Promise<string[]> {
  const src = path.join(publicDir, 'fonts');
  const dst = path.join(outDir, 'fonts');
  await mkdir(dst, { recursive: true });
  const copied: string[] = [];
  try {
    for (const f of await readdir(src)) {
      if (!f.endsWith('.woff2') && f !== 'LICENSES.md') continue;
      await copyFile(path.join(src, f), path.join(dst, f));
      copied.push(f);
    }
  } catch {
    /* no bundled fonts is not fatal: the page falls back to system faces */
  }
  return copied;
}

/* ------------------------------------------------------------------ *
 * Preview rendering
 * ------------------------------------------------------------------ */
function distributionsOf(result: DecideResult): Distributions {
  const out: Distributions = {};
  for (const [id, ans] of Object.entries(result.response.answers)) {
    if (ans.type === 'choice') out[id as keyof Distributions] = ans.probabilities;
  }
  return out;
}

function wantsDarkOf(result: DecideResult): boolean {
  const a = result.response.answers.wants_dark_ground;
  return a?.type === 'noul' ? a.noul > 0.6 : false;
}

/** Build the spec for a direction, using the shared inventory as its content. */
export function specForDirection(
  session: Pick<DirectionSession, 'brief' | 'seed'>,
  dir: Direction,
  decided: DecideResult,
  inventory: Content,
): DesignSpec {
  const { spec } = compose(session.brief, decided, {
    seed: session.seed,
    direction: {
      blueprint: dir.blueprint.id,
      palette: dir.palette,
      typography: dir.typography,
      effects: dir.effects,
      motion: dir.motion,
      density: dir.density,
      fit: dir.fit,
      novelty: dir.novelty,
      rationale: dir.rationale,
    },
  });
  spec.content = inventory;
  return spec;
}

export function structureOf(spec: DesignSpec): DirectionStructure {
  const bp = BLUEPRINTS.find((b) => b.id === spec.blueprint)!;
  const ids = sectionInstanceIds(bp);
  return {
    hero: bp.hero,
    nav: bp.nav,
    footer: bp.footer,
    columns: bp.grid.columns,
    rhythm: bp.rhythm,
    lead: bp.lead,
    sectionOrder: ids,
    blocks: bp.sections.map((s) => `${s.module}:${s.variant}`),
    navAnchors: navTargetsFor(bp, spec).map((t) => t.id),
  };
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */
export async function createSession(
  outDir: string,
  publicDir: string,
  opts: CreateSessionOptions,
): Promise<DirectionSession> {
  const started = Date.now();
  const seed = opts.seed ?? (Date.now() % 1_000_000);
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.45));
  const count = Math.max(4, Math.min(8, opts.count ?? 6));
  const id = `ses_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  // ---- 1. ONE decision call ------------------------------------------------
  const decided = await decideWithFallback(opts.brief, { preference: opts.decider });
  const distributions = distributionsOf(decided);
  const dirs = buildDirections({
    brief: opts.brief,
    distributions,
    count,
    seed,
    wantsDark: wantsDarkOf(decided),
    explore,
  });
  if (!dirs.length) throw new Error('no directions could be built from the decision — nothing to preview');

  // ---- 2. ONE shared content inventory ------------------------------------
  // Written once for the BRIEF, not per direction. Previews are honest about
  // being an inventory rather than final copy; the chosen page gets its own
  // blueprint-specific writing pass on finalize.
  const primary = specForDirection({ brief: opts.brief, seed }, dirs[0]!, decided, fallbackContent(opts.brief, []));
  const axes = primary.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const inventoryFallback = fallbackContent(opts.brief, axes);

  const inventoryStart = Date.now();
  const written = opts.noWriter
    ? {
        content: inventoryFallback,
        source: 'fallback' as const,
        model: 'none',
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }
    : await writeContent(opts.brief, primary, {
        fallback: inventoryFallback,
        // The inventory is a SUPERSET: every module any direction might need.
        required: [...MODULES],
      });
  const inventoryMs = Date.now() - inventoryStart;
  const inventory = written.content;

  // ---- 3. Render every direction locally. No model is involved here. ------
  const renderStart = Date.now();
  const previewRel = path.posix.join(PREVIEW_DIR, id);
  await mkdir(path.join(outDir, PREVIEW_DIR, id), { recursive: true });
  await ensureBundledFonts(outDir, publicDir);

  const directions: SessionDirection[] = [];
  for (const [index, dir] of dirs.entries()) {
    const spec = specForDirection({ brief: opts.brief, seed }, dir, decided, inventory);
    const html = renderHtml(spec, {
      preview: true,
      copySource: written.source === 'llm' ? 'shared-inventory' : 'specimen',
      fontBasePath: 'fonts/',
    });
    await writeFile(path.join(outDir, previewRel, `${index}.html`), html, 'utf8');
    directions.push({
      index,
      id: dir.id,
      blueprint: dir.blueprint.id,
      blueprintLabel: dir.blueprint.label,
      family: dir.blueprint.family,
      lead: dir.blueprint.lead,
      fit: dir.fit,
      novelty: dir.novelty,
      rationale: dir.rationale,
      palette: dir.palette,
      typography: dir.typography,
      effects: dir.effects,
      motion: dir.motion,
      density: dir.density,
      structure: structureOf(spec),
      preview: path.posix.join(previewRel, `${index}.html`),
    });
  }
  const renderMs = Date.now() - renderStart;

  const usage = decided.response.usage ?? { input_tokens: 0, output_tokens: 0 };
  const estimatedUsd = jevCost(usage.input_tokens);
  const writerUsd = writerCost(written.inputTokens, written.outputTokens);

  const session: DirectionSession = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    brief: opts.brief,
    seed,
    explore,
    directionCount: directions.length,
    decider: decided.kind,
    decision: {
      kind: decided.kind,
      model: decided.response.model,
      latencyMs: decided.latencyMs,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      estimatedUsd,
      response: decided.response,
      ...(decided.fallbackReason ? { fallbackReason: decided.fallbackReason } : {}),
    },
    inventory,
    inventorySource: written.source,
    inventoryMeta: {
      model: written.model,
      latencyMs: written.latencyMs,
      inputTokens: written.inputTokens,
      outputTokens: written.outputTokens,
      estimatedUsd: writerUsd,
      ...(written.fallbackReason ? { fallbackReason: written.fallbackReason } : {}),
    },
    previewLabel:
      written.source === 'llm'
        ? 'shared content inventory — not final copy'
        : 'local specimen copy — no writer configured',
    directions,
    locks: [],
    selectedIndex: null,
    metrics: {
      decideMs: decided.latencyMs,
      inventoryMs,
      renderMs,
      totalMs: Date.now() - started,
      modelCalls: written.source === 'llm' ? 2 : 1,
      estimateUsd: estimatedUsd + writerUsd,
    },
    history: [{ at: new Date().toISOString(), event: 'created', detail: `${directions.length} directions` }],
  };
  await saveSession(outDir, session);
  return session;
}

/* ------------------------------------------------------------------ *
 * Regenerate
 * ------------------------------------------------------------------ */
export interface RegenerateOptions {
  /** Axis names to pin to the selected direction. */
  locks?: string[];
  /** Direction to pin from. Defaults to the current selection. */
  fromIndex?: number;
  count?: number;
  seed?: number;
}

/**
 * Re-roll the directions that are not locked.
 *
 * Uses the STORED decision response and the STORED inventory: no second Jev
 * call, no second writer call, no change to the previews you are comparing.
 */
export async function regenerateSession(
  outDir: string,
  session: DirectionSession,
  opts: RegenerateOptions = {},
): Promise<DirectionSession> {
  const response = JevResponse.parse(session.decision.response);
  const decided: DecideResult = {
    kind: session.decision.kind,
    response,
    latencyMs: session.decision.latencyMs,
    fallbackReason: session.decision.fallbackReason,
  };
  const distributions = distributionsOf(decided);
  const inventory = session.inventory as Content;
  const locks = opts.locks ?? session.locks;
  const fromIndex = opts.fromIndex ?? session.selectedIndex ?? 0;
  const seed = opts.seed ?? (session.seed + 1 + Math.floor(Math.random() * 1000));
  const count = Math.max(4, Math.min(8, opts.count ?? session.directionCount));

  const used = new Set(session.directions.map((d) => d.blueprint));
  const fresh = buildDirections({
    brief: session.brief,
    distributions,
    count,
    seed,
    wantsDark: wantsDarkOf(decided),
    explore: session.explore,
    excludeFingerprints: [...used],
  });

  const base = session.directions[fromIndex];
  const pin = (d: Direction): Direction => {
    if (!base || !locks.length) return d;
    return {
      ...d,
      ...(locks.includes('blueprint') ? {} : {}),
      ...(locks.includes('palette') ? { palette: base.palette } : {}),
      ...(locks.includes('typography') ? { typography: base.typography } : {}),
      ...(locks.includes('effects') ? { effects: base.effects } : {}),
      ...(locks.includes('motion') ? { motion: base.motion } : {}),
      ...(locks.includes('density') ? { density: base.density } : {}),
    };
  };

  const dirs = fresh.map(pin);
  if (!dirs.length) return session;

  const preview = path.join(PREVIEW_DIR, session.id);
  await mkdir(path.join(outDir, preview), { recursive: true });
  const next: SessionDirection[] = [];
  for (const [index, dir] of dirs.entries()) {
    const spec = specForDirection({ brief: session.brief, seed }, dir, decided, inventory);
    const html = renderHtml(spec, {
      preview: true,
      copySource: session.inventorySource === 'llm' ? 'shared-inventory' : 'specimen',
      fontBasePath: 'fonts/',
    });
    await writeFile(path.join(outDir, preview, `${index}.html`), html, 'utf8');
    next.push({
      index,
      id: dir.id,
      blueprint: dir.blueprint.id,
      blueprintLabel: dir.blueprint.label,
      family: dir.blueprint.family,
      lead: dir.blueprint.lead,
      fit: dir.fit,
      novelty: dir.novelty,
      rationale: dir.rationale,
      palette: dir.palette,
      typography: dir.typography,
      effects: dir.effects,
      motion: dir.motion,
      density: dir.density,
      structure: structureOf(spec),
      preview: path.posix.join(PREVIEW_DIR, session.id, `${index}.html`),
    });
  }

  const updated: DirectionSession = {
    ...session,
    seed,
    directionCount: next.length,
    directions: next,
    locks,
    selectedIndex: null,
    finalSlug: undefined,
    history: [
      ...session.history,
      {
        at: new Date().toISOString(),
        event: 'regenerated',
        detail: `${next.length} new directions, seed ${seed}${locks.length ? `, locked ${locks.join('+')}` : ''}`,
      },
    ],
  };
  await saveSession(outDir, updated);
  return updated;
}

/* ------------------------------------------------------------------ *
 * Finalize
 * ------------------------------------------------------------------ */
export interface FinalizeOptions {
  index: number;
  /** Write blueprint-specific final copy (one more writer call). */
  finalCopy?: boolean;
  /** Real brand/product images, preferred over anything generated. */
  userImages?: UserImageRequest[];
  userImageRoot?: string;
  signal?: AbortSignal;
}

/**
 * Turn a chosen direction into the real thing.
 *
 * This is where the second writer call happens — and only here — because final
 * copy is written FOR this blueprint and only for the modules it renders.
 */
export async function finalizeSession(
  outDir: string,
  session: DirectionSession,
  slug: string,
  opts: FinalizeOptions,
): Promise<{ spec: DesignSpec; html: string; write: Awaited<ReturnType<typeof writeContent>> }> {
  const chosen = session.directions[opts.index];
  if (!chosen) throw new Error(`no direction at index ${opts.index}`);

  const response = JevResponse.parse(session.decision.response);
  const decided: DecideResult = { kind: session.decision.kind, response, latencyMs: session.decision.latencyMs };
  const inventory = session.inventory as Content;

  const dir: Direction = {
    id: chosen.id,
    blueprint: BLUEPRINTS.find((b) => b.id === chosen.blueprint)!,
    palette: chosen.palette,
    typography: chosen.typography,
    effects: chosen.effects,
    motion: chosen.motion,
    density: chosen.density,
    fit: chosen.fit,
    novelty: chosen.novelty,
    rationale: chosen.rationale,
  };
  const spec = specForDirection({ brief: session.brief, seed: session.seed }, dir, decided, inventory);

  const required = requiredModules(dir.blueprint);
  const axes = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const fallback = fallbackContent(session.brief, axes);

  const write =
    opts.finalCopy === false
      ? {
          content: inventory,
          source: 'fallback' as const,
          model: 'none',
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        }
      : await writeContent(session.brief, spec, {
          fallback,
          required,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });

  spec.content = write.content;
  spec.meta.writer = write.source;
  spec.meta.writerModel = write.model;
  spec.meta.writerLatencyMs = write.latencyMs;
  spec.meta.writerInputTokens = write.inputTokens;
  spec.meta.writerOutputTokens = write.outputTokens;
  spec.meta.writerReasoningTokens = write.reasoningTokens;
  spec.meta.writerEstimatedUsd = writerCost(write.inputTokens, write.outputTokens);

  if (opts.userImages?.length) {
    const ingested = await ingestUserImages({
      outDir,
      slug,
      root: opts.userImageRoot ?? process.cwd(),
      requests: opts.userImages,
      allowedSlots: imageSlotsFor(dir.blueprint).map((x) => x.id),
    });
    if (ingested.assets.length) {
      const taken = new Set(ingested.assets.map((a) => a.slot));
      spec.assets = [...ingested.assets, ...spec.assets.filter((a) => !taken.has(a.slot))];
    }
  }

  const html = renderHtml(spec, { fontBasePath: 'fonts/' });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${slug}.html`), html, 'utf8');
  await writeFile(path.join(outDir, `${slug}.spec.json`), JSON.stringify(spec, null, 2), 'utf8');
  await ensureBundledFonts(outDir, path.resolve(process.cwd(), 'public'));

  return { spec, html, write };
}

/** Module ids a session's directions collectively require, for reporting. */
export function sessionModules(session: DirectionSession): ModuleId[] {
  const out = new Set<ModuleId>();
  for (const d of session.directions) {
    const bp = BLUEPRINTS.find((b) => b.id === d.blueprint);
    if (bp) for (const m of requiredModules(bp)) out.add(m);
  }
  return [...out];
}
