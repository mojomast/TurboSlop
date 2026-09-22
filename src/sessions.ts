/**
 * TurboSlop — direction sessions.
 *
 * A session is what happens between "here is one brief" and "here is the design
 * I want": one decision call, one shared content inventory, and a set of
 * preview directions a human picks from.
 *
 * ## Why sessions exist
 *
 * The old flow was one brief → one page. Measured against the baseline, the
 * same brief produced the *same* page every time, because only the top-ranked
 * choice per axis was ever used. Producing several directions is only useful
 * if they can be compared, so a session owns:
 *
 *   - the decision response (persisted), so re-rendering or re-selecting NEVER
 *     triggers a second Jev call that could change what you are looking at;
 *   - ONE shared content inventory, so previewing six directions costs one
 *     writer call rather than six;
 *   - the preview HTML itself, rendered locally from the decision — no model is
 *     involved in turning a direction into a page;
 *   - the RESOLVED spec, visual recipes, content and slot list that produced
 *     each preview, so finalizing a direction can never revert to the model's
 *     original top-ranked choices;
 *   - immutable previous batches, so a regenerated set never breaks a preview
 *     link you already saved.
 *
 * ## Cost model
 *
 *   previewing N directions   1 Jev call + 1 writer call + N local renders
 *   selection / locks / regen 0 model calls (stored decision + inventory)
 *   finalizing one direction  1 writer call (+ optional image requests)
 *   revising the chosen design 0 or 1 writer call, never a re-decision
 *
 * The second writer call exists because final copy is written FOR the chosen
 * blueprint and only for the modules it renders. Preview copy is a brief-level
 * inventory and the preview says so on its face.
 */
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BLUEPRINTS,
  MODULES,
  imageSlotsFor,
  requiredModules,
  resolveBlueprint,
  type Blueprint,
  type ModuleId,
} from './blueprint.js';
import {
  NO_IMAGES,
  availableModulesOf,
  contentDiagnostics,
  finalizeAssets,
  renderableSlots,
  verifyAssetPlacement,
  type AssetSettings,
} from './assetplan.js';
import { compose } from './compose.js';
import { fallbackContent, type Content } from './content.js';
import { decideWithFallback, type DeciderPreference, type DecideResult } from './decider.js';
import {
  LOCK_NAMES,
  LockError,
  SELECTION_VERSION,
  buildDirections,
  baseOf,
  validateLocks,
  type BuildStats,
  type Direction,
  type Distributions,
  type LockName,
  type SelectionLock,
} from './directions.js';
import type { DesignFeatures, DiversityReport } from './fingerprint.js';
import { historyFeatures, projectId, recordHistory } from './history.js';
import { resolveLlm } from './llm.js';
import { jevCost, writerCost } from './pricing.js';
import { getDesign, nextIterationSlug, uniqueSlug } from './registry.js';
import { navTargetsFor, sectionInstanceIds } from './render.js';
import { renderHtml, visualForSpec } from './render.js';
import { applyVisualEdit, classifyRevision } from './revise.js';
import { ingestUserImages, type UserImageRequest } from './userassets.js';
import { reviseContent, writeContent } from './writer.js';
import { JevResponse, type DesignSpec } from './types.js';
import type { VisualBlueprint } from './visual.js';

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

/** A lock bound to an explicit value AND the card it came from. */
export interface SessionLock {
  name: LockName;
  /** The exact resolved value pinned (not "whichever card is selected"). */
  value: string;
  /** Which direction the value was taken from. */
  fromIndex: number;
}

export interface SessionImageSlot {
  id: string;
  role: string;
  aspect: string;
  scale: string;
  placement: string;
}

export interface SessionDirection {
  index: number;
  /** Stable identity: does not change when siblings are added or reordered. */
  id: string;
  /** Resolved layout id — a catalog id or a bounded variant of one. */
  blueprint: string;
  baseBlueprint: string;
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
  /** Direction-specific seed: motifs, frames and section recipes derive from it. */
  seed: number;
  /** Composition identity, for composition locks and reporting. */
  composition: string;
  /** Resolved design fingerprint — what the set's diversity is measured on. */
  features: DesignFeatures;
  structure: DirectionStructure;
  /** The image places this direction can actually render. */
  imageSlots: SessionImageSlot[];
  /** Missing-content diagnostics for THIS direction (never silently filled). */
  diagnostics: string[];
  /** Path of the preview HTML, relative to the output directory. */
  preview: string;
  /** The exact resolved spec that produced the preview — finalize reuses it. */
  resolvedSpec: DesignSpec;
  /** The visual recipes (hero/typo/section/motif/treatment) that drew it. */
  visual: VisualBlueprint;
}

export interface SessionMetrics {
  decideMs: number;
  inventoryMs: number;
  renderMs: number;
  /** Image generation time for this step (0 for preview sets — no images). */
  assetsMs: number;
  totalMs: number;
  /** Model calls made to produce the preview set. 1 decision + at most 1 inventory. */
  modelCalls: number;
  estimateUsd: number;
}

/** One immutable previous batch: its previews and their metadata survive. */
export interface SessionVersion {
  batch: number;
  at: string;
  seed: number;
  /** Directory of this batch's preview files — never rewritten. */
  previewDir: string;
  locks: SessionLock[];
  diversity: DiversityReport;
  stats: BuildStats;
  directions: SessionDirection[];
}

export interface DirectionSession {
  /** Schema version. 1 = legacy (no resolved specs); 2 = resolved directions. */
  version: 1 | 2;
  id: string;
  createdAt: string;
  brief: string;
  /** The seed the FIRST batch was created with. Batch seeds are recorded per batch. */
  seed: number;
  explore: number;
  directionCount: number;
  decider: 'live' | 'local';
  /** Project this session belongs to; history is scoped by it. */
  project: string;
  /** Which selection algorithm produced this set — recorded for reproducibility. */
  selectionVersion: string;
  /** History snapshot keys used at creation time (the run's other input). */
  historyKeys: string[];
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
  previewLabel: string;
  /** Current batch number. 0 at creation. */
  batch: number;
  /** Preview directory of the CURRENT batch. */
  previewDir: string;
  /** Previous batches — immutable, so old preview links keep working. */
  versions: SessionVersion[];
  /** Diversity report for the CURRENT batch. */
  diversity: DiversityReport;
  stats: BuildStats;
  directions: SessionDirection[];
  locks: SessionLock[];
  selectedIndex: number | null;
  selectedDirectionId: string | null;
  metrics: SessionMetrics;
  finalSlug?: string;
  /** Count of revisions applied to the finalized design. */
  revisions: number;
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
  /** Stage progress, so the surface can show life during the inventory write. */
  onProgress?: (e: { phase: 'decide' | 'content' | 'render'; message: string }) => void;
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
    if ((raw.version !== 1 && raw.version !== 2) || raw.id !== id) return null;
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

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The direction-specific seed.
 *
 * Motifs, frames and section recipes must differ WITHIN a batch — six
 * directions inheriting one decoration is one design wearing six colours —
 * while staying reproducible from (session seed, direction id).
 */
export function directionSeedFor(sessionSeed: number, directionId: string): number {
  return ((fnv(directionId) ^ Math.imul(sessionSeed, 0x9e3779b1)) >>> 0) % 2147483647;
}

/** Build the spec for a direction, using the shared inventory as its content. */
export function specForDirection(
  session: Pick<DirectionSession, 'brief' | 'seed'>,
  dir: Direction,
  decided: DecideResult,
  inventory: Content,
  directionSeed?: number,
): DesignSpec {
  const { spec } = compose(session.brief, decided, {
    seed: directionSeed ?? session.seed,
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
  const bp = resolveBlueprint(spec.blueprint) ?? BLUEPRINTS[0]!;
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

/** Render one direction to its preview file, storing everything that made it. */
async function renderDirection(args: {
  outDir: string;
  previewDir: string;
  index: number;
  dir: Direction;
  sessionSeed: number;
  brief: string;
  decided: DecideResult;
  inventory: Content;
  copySource: 'shared-inventory' | 'specimen';
}): Promise<SessionDirection> {
  const { dir } = args;
  const seed = directionSeedFor(args.sessionSeed, dir.id);
  const spec = specForDirection({ brief: args.brief, seed: args.sessionSeed }, dir, args.decided, args.inventory, seed);
  const bp = resolveBlueprint(dir.blueprint.id) ?? dir.blueprint;
  const visual = visualForSpec(spec);
  const html = renderHtml(spec, {
    preview: true,
    copySource: args.copySource,
    fontBasePath: 'fonts/',
  });
  await mkdir(path.join(args.outDir, args.previewDir), { recursive: true });
  await writeFile(path.join(args.outDir, args.previewDir, `${args.index}.html`), html, 'utf8');

  const slots = imageSlotsFor(bp)
    .filter((s) => renderableSlots(bp, args.inventory).some((r) => r.id === s.id))
    .map((s) => ({ id: s.id, role: s.role, aspect: s.aspect, scale: s.scale, placement: s.placement }));

  return {
    index: args.index,
    id: dir.id,
    blueprint: dir.blueprint.id,
    baseBlueprint: dir.baseBlueprint,
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
    seed,
    composition: dir.composition,
    features: dir.features,
    structure: structureOf(spec),
    imageSlots: slots,
    diagnostics: contentDiagnostics(bp, args.inventory),
    preview: path.posix.join(args.previewDir, `${args.index}.html`),
    resolvedSpec: spec,
    visual,
  };
}

/* ------------------------------------------------------------------ *
 * Locks — explicit values, explicit sources
 * ------------------------------------------------------------------ */
export type LockInput = string | { name: string; value?: string; fromIndex?: number };

const dirValue = (d: SessionDirection | undefined, name: LockName): string | null => {
  if (!d) return null;
  switch (name) {
    case 'blueprint':
      /* The CATALOG blueprint the card descends from — locking it pins the
         family while bounded variation may still re-roll the variant. */
      return d.baseBlueprint ?? d.blueprint;
    case 'composition':
      /* The exact resolved layout: base plus its bounded variant. */
      return d.blueprint;
    case 'palette':
      return d.palette;
    case 'typography':
      return d.typography;
    case 'effects':
      return d.effects;
    case 'motion':
      return d.motion;
    case 'density':
      return d.density;
    default:
      return null;
  }
};

/**
 * Bind incoming locks to explicit values and source directions.
 *
 * A bare axis name is resolved against ONE source direction (the card it came
 * from), never "whatever is selected". A lock that names a value must match
 * the value that direction actually has — otherwise the surface and the
 * session disagree about what is pinned, which is how "I locked the palette of
 * card 3 and card 1's palette came back" happens.
 */
export function normalizeLocks(
  session: DirectionSession,
  input: LockInput[],
  fallbackIndex: number | null,
): SessionLock[] {
  const out: SessionLock[] = [];
  for (const raw of input) {
    const spec =
      typeof raw === 'string'
        ? { name: raw, value: undefined, fromIndex: fallbackIndex ?? undefined }
        : { name: raw.name, value: raw.value, fromIndex: raw.fromIndex ?? fallbackIndex ?? undefined };
    const name = spec.name as LockName;
    if (!LOCK_NAMES.includes(name)) {
      throw new LockError(
        `unknown lock "${spec.name}" — this version can lock: ${LOCK_NAMES.join(', ')} (${SELECTION_VERSION})`,
      );
    }
    const fromIndex = spec.fromIndex;
    if (fromIndex === null || fromIndex === undefined || !session.directions[fromIndex]) {
      throw new LockError(`lock "${name}" has no source direction — locks are bound to the card they came from`);
    }
    const actual = dirValue(session.directions[fromIndex], name)!;
    if (spec.value !== undefined && spec.value !== actual) {
      throw new LockError(
        `lock "${name}" claims value "${spec.value}" but direction #${fromIndex + 1} resolves to "${actual}"`,
      );
    }
    out.push({ name, value: actual, fromIndex });
  }
  return out;
}

/** Validate names/values AND cross-lock compatibility, with explanations. */
export function assertLocksAreCompatible(locks: SessionLock[]): void {
  validateLocks(locks.map((l) => ({ name: l.name, value: l.value })));
  /* A composition lock pins a RESOLVED layout; a blueprint lock pins its
     catalog origin. Both from different families cannot hold at once. */
  const compo = locks.find((l) => l.name === 'composition');
  const blue = locks.find((l) => l.name === 'blueprint');
  if (compo && blue && baseOf(compo.value) !== blue.value) {
    throw new LockError(
      `incompatible locks: composition "${compo.value}" (from #${compo.fromIndex + 1}) belongs to blueprint ` +
        `"${baseOf(compo.value)}", but blueprint "${blue.value}" is locked from #${blue.fromIndex + 1} — ` +
        'lock both from the same card, or drop one',
    );
  }
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
  const project = projectId();
  const say = (phase: 'decide' | 'content' | 'render', message: string) => opts.onProgress?.({ phase, message });

  // ---- 1. ONE decision call ------------------------------------------------
  say('decide', 'One decision call for the whole direction set…');
  const decided = await decideWithFallback(opts.brief, { preference: opts.decider });
  const distributions = distributionsOf(decided);

  // ---- 2. ONE shared content inventory ------------------------------------
  // Written once for the BRIEF, not per direction. Previews are honest about
  // being an inventory rather than final copy; the chosen page gets its own
  // blueprint-specific writing pass on finalize.
  const primary = compose(opts.brief, decided, { seed }).spec;
  const axes = primary.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const inventoryFallback = fallbackContent(opts.brief, axes);

  const inventoryStart = Date.now();
  say('content', 'Writing the shared content inventory — one writer call for the whole set…');
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
        // The inventory is a SUPerset: every module any direction might need.
        required: [...MODULES],
      });
  const inventoryMs = Date.now() - inventoryStart;
  const inventory = written.content;

  // ---- 3. Selection: bounded search, near-duplicate rejection, history ----
  // History is snapshotted BEFORE selection so a run is reproducible from
  // (version, inputs, seed, snapshot); the current session's own directions
  // are excluded so a regeneration is not measured against itself.
  const snapshot = await historyFeatures(outDir, project);
  const own = `session:${id}`;
  const history = snapshot.entries.filter((e) => e.source !== own);
  const availableModules = availableModulesOf(inventory);

  const built = buildDirections({
    brief: opts.brief,
    distributions,
    count,
    seed,
    wantsDark: wantsDarkOf(decided),
    explore,
    history: history.map((e) => e.features),
    availableModules,
  });
  if (!built.directions.length) {
    throw new Error(
      'no directions could be built from the decision — the brief, locks and content constraints left nothing eligible',
    );
  }

  // ---- 4. Render every direction locally. No model is involved here. ------
  say('render', `Rendering ${built.directions.length} directions locally…`);
  const renderStart = Date.now();
  const previewDir = path.posix.join(PREVIEW_DIR, id, 'b0');
  await ensureBundledFonts(outDir, publicDir);

  const directions: SessionDirection[] = [];
  for (const [index, dir] of built.directions.entries()) {
    directions.push(
      await renderDirection({
        outDir,
        previewDir,
        index,
        dir,
        sessionSeed: seed,
        brief: opts.brief,
        decided,
        inventory,
        copySource: written.source === 'llm' ? 'shared-inventory' : 'specimen',
      }),
    );
  }
  const renderMs = Date.now() - renderStart;

  const usage = decided.response.usage ?? { input_tokens: 0, output_tokens: 0 };
  const estimatedUsd = jevCost(usage.input_tokens);
  const writerUsd = writerCost(written.inputTokens, written.outputTokens);

  const session: DirectionSession = {
    version: 2,
    id,
    createdAt: new Date().toISOString(),
    brief: opts.brief,
    seed,
    explore,
    directionCount: directions.length,
    decider: decided.kind,
    project,
    selectionVersion: SELECTION_VERSION,
    historyKeys: history.map((e) => e.key),
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
    batch: 0,
    previewDir,
    versions: [],
    diversity: built.report,
    stats: built.stats,
    directions,
    locks: [],
    selectedIndex: null,
    selectedDirectionId: null,
    metrics: {
      decideMs: decided.latencyMs,
      inventoryMs,
      renderMs,
      assetsMs: 0,
      totalMs: Date.now() - started,
      modelCalls: written.source === 'llm' ? 2 : 1,
      estimateUsd: estimatedUsd + writerUsd,
    },
    revisions: 0,
    history: [
      {
        at: new Date().toISOString(),
        event: 'created',
        detail:
          `${directions.length} directions, ${built.report.achieved.compositions} compositions, ` +
          `${built.report.achieved.constructions} headline constructions, ` +
          `${built.report.achieved.treatments} treatments${built.report.met ? '' : ` — targets missed: ${built.report.shortfall.map((s) => s.target).join(', ')}`}`,
      },
    ],
  };
  await saveSession(outDir, session);

  // Record what was actually resolved, so the NEXT run in this project can
  // avoid it. Deduplicated by fingerprint key.
  await recordHistory(
    outDir,
    directions.map((d) => ({ features: d.features, source: own, seed: d.seed })),
    project,
  );
  return session;
}

/* ------------------------------------------------------------------ *
 * Regenerate
 * ------------------------------------------------------------------ */
export interface RegenerateOptions {
  /**
   * Locks to apply. Each is bound to an explicit value and source direction
   * (or a bare axis name resolved against `fromIndex`).
   */
  locks?: LockInput[];
  /** Which direction locked values come from. Defaults to the selection. */
  fromIndex?: number;
  count?: number;
  /** Batch seed. Omit for the deterministic next seed for this session. */
  seed?: number;
}

/**
 * Re-roll the directions that are not locked.
 *
 * Uses the STORED decision response, the STORED inventory and a FRESH
 * history snapshot: no second Jev call, no second writer call. Locked
 * properties are applied DURING constrained selection (not patched on
 * afterwards), fit and separation are recomputed against the new set, and the
 * previous batch is kept immutable so its preview links still resolve.
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
    ...(session.decision.fallbackReason ? { fallbackReason: session.decision.fallbackReason } : {}),
  };
  const distributions = distributionsOf(decided);
  const inventory = session.inventory as Content;

  const fallbackIndex =
    opts.fromIndex ?? session.selectedIndex ?? session.locks[0]?.fromIndex ?? 0;
  const locks =
    opts.locks !== undefined ? normalizeLocks(session, opts.locks, fallbackIndex) : session.locks;
  assertLocksAreCompatible(locks);

  /* Reproducible batch seed: derived from the session's own inputs, never
     from Math.random — same session + same batch number + same history
     snapshot produces the same set. */
  const batch = session.batch + 1;
  const seed = opts.seed ?? (session.seed + batch * 7919) % 2147483647;
  const count = Math.max(4, Math.min(8, opts.count ?? session.directionCount));

  /* History: the project's recent resolved designs EXCEPT this session's own
     (the set being replaced is the incumbent, not the past). */
  const snapshot = await historyFeatures(outDir, session.project || projectId());
  const own = `session:${session.id}`;
  const history = snapshot.entries.filter((e) => e.source !== own);
  const availableModules = availableModulesOf(inventory);

  const selectionLocks: SelectionLock[] = locks.map((l) => ({ name: l.name, value: l.value }));
  const built = buildDirections({
    brief: session.brief,
    distributions,
    count,
    seed,
    wantsDark: wantsDarkOf(decided),
    explore: session.explore,
    history: history.map((e) => e.features),
    availableModules,
    locks: selectionLocks,
  });
  if (!built.directions.length) {
    throw new LockError(
      `no direction satisfies the locked combination (${locks.map((l) => `${l.name}=${l.value}`).join(', ')}) ` +
        'for this brief — drop a lock or lock from a card whose values combine',
    );
  }

  const previewDir = path.posix.join(PREVIEW_DIR, session.id, `b${batch}`);
  const next: SessionDirection[] = [];
  for (const [index, dir] of built.directions.entries()) {
    next.push(
      await renderDirection({
        outDir,
        previewDir,
        index,
        dir,
        sessionSeed: seed,
        brief: session.brief,
        decided,
        inventory,
        copySource: session.inventorySource === 'llm' ? 'shared-inventory' : 'specimen',
      }),
    );
  }

  /* The outgoing batch becomes an immutable version: its directions, its
     preview directory and its report stay exactly as they were. */
  const previous: SessionVersion = {
    batch: session.batch,
    at: new Date().toISOString(),
    seed: session.seed + session.batch * 7919,
    previewDir: session.previewDir,
    locks: session.locks,
    diversity: session.diversity,
    stats: session.stats,
    directions: session.directions,
  };

  const updated: DirectionSession = {
    ...session,
    batch,
    previewDir,
    versions: [...session.versions, previous],
    directionCount: next.length,
    directions: next,
    locks,
    diversity: built.report,
    stats: built.stats,
    selectedIndex: null,
    selectedDirectionId: null,
    history: [
      ...session.history,
      {
        at: new Date().toISOString(),
        event: 'regenerated',
        detail:
          `${next.length} directions in batch ${batch}, seed ${seed}` +
          (locks.length ? `, locked ${locks.map((l) => `${l.name}=${l.value} (from #${l.fromIndex + 1})`).join('; ')}` : '') +
          `${built.report.met ? '' : ` — targets missed: ${built.report.shortfall.map((s) => s.target).join(', ')}`}`,
      },
    ],
  };
  await saveSession(outDir, updated);
  await recordHistory(
    outDir,
    next.map((d) => ({ features: d.features, source: own, seed: d.seed })),
    session.project || projectId(),
  );
  return updated;
}

/* ------------------------------------------------------------------ *
 * Finalize
 * ------------------------------------------------------------------ */
export interface FinalizeOptions {
  index: number;
  /** Write blueprint-specific final copy (one more writer call). */
  finalCopy?: boolean;
  /** Image setting for the SELECTED direction. Zero slots means zero requests. */
  images?: AssetSettings;
  /** Real brand/product images, preferred over anything generated. */
  userImages?: UserImageRequest[];
  userImageRoot?: string;
  signal?: AbortSignal;
}

export interface FinalizeResult {
  spec: DesignSpec;
  html: string;
  write: Awaited<ReturnType<typeof writeContent>>;
  notes: string[];
  placement: ReturnType<typeof verifyAssetPlacement>;
  assetMs: number;
}

/**
 * Turn a chosen direction into the real thing.
 *
 * The stored `resolvedSpec` IS the direction — finalizing reuses it verbatim
 * (tokens, seed, blueprint, visual recipes), so a selected alternative can
 * never revert to the model's original top-ranked choices. The only model
 * call is the optional final-copy write for THIS blueprint.
 */
export async function finalizeSession(
  outDir: string,
  session: DirectionSession,
  slug: string,
  opts: FinalizeOptions,
): Promise<FinalizeResult> {
  const chosen = session.directions[opts.index];
  if (!chosen) throw new Error(`no direction at index ${opts.index}`);
  const notes: string[] = [];

  /* The resolved spec is authoritative. (Legacy sessions without one fall
     back to re-deriving from the stored decision — flagged, not silent.) */
  let spec: DesignSpec;
  if (chosen.resolvedSpec) {
    spec = JSON.parse(JSON.stringify(chosen.resolvedSpec)) as DesignSpec;
  } else {
    const response = JevResponse.parse(session.decision.response);
    const decided: DecideResult = { kind: session.decision.kind, response, latencyMs: session.decision.latencyMs };
    spec = specForDirection(
      { brief: session.brief, seed: session.seed },
      legacyDirection(chosen),
      decided,
      session.inventory as Content,
      chosen.seed,
    );
    notes.push('this direction predates resolved specs; it was re-derived from the stored decision');
  }

  const bp = resolveBlueprint(spec.blueprint) ?? resolveBlueprint(chosen.blueprint) ?? BLUEPRINTS[0]!;
  const required = requiredModules(bp);
  const inventory = session.inventory as Content;

  const write =
    opts.finalCopy === false
      ? {
          content: spec.content ?? inventory,
          source: 'fallback' as const,
          model: 'none',
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        }
      : await writeContent(session.brief, spec, {
          fallback: spec.content ?? fallbackContent(session.brief, []),
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

  /* ---- the shared asset path: supplied first, generate only what is left --- */
  const assetResult = await finalizeAssets(
    {
      spec,
      blueprint: bp,
      settings: opts.images ?? NO_IMAGES,
      ...(opts.userImages?.length
        ? { userImages: opts.userImages, userImageRoot: opts.userImageRoot ?? process.cwd() }
        : {}),
      outDir,
      slug,
    },
    null,
    undefined,
  );
  notes.push(...assetResult.notes);
  spec.assets = assetResult.assets;
  spec.meta.imageCount = assetResult.assets.filter((a) => a.source === 'generated').length;
  spec.meta.imageMs = assetResult.imageMs;

  const html = renderHtml(spec, { fontBasePath: 'fonts/' });
  const placement = verifyAssetPlacement(html, spec.assets);
  if (!placement.ok) {
    for (const issue of placement.issues) {
      notes.push(`asset placement: slot "${issue.slot}" (${issue.file}) — ${issue.reason}`);
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${slug}.html`), html, 'utf8');
  await writeFile(path.join(outDir, `${slug}.spec.json`), JSON.stringify(spec, null, 2), 'utf8');
  await ensureBundledFonts(outDir, path.resolve(process.cwd(), 'public'));

  session.selectedIndex = opts.index;
  session.selectedDirectionId = chosen.id;
  session.finalSlug = slug;
  session.history.push({
    at: new Date().toISOString(),
    event: 'finalized',
    detail: `${chosen.blueprint} → ${slug}${placement.ok ? '' : ` (${placement.issues.length} placement issue(s))`}`,
  });
  await saveSession(outDir, session);
  await recordHistory(
    outDir,
    [{ features: chosen.features, source: `design:${slug}`, seed: chosen.seed }],
    session.project || projectId(),
  );

  return { spec, html, write, notes, placement, assetMs: assetResult.imageMs };
}

/** A legacy direction reconstructed as a Direction, for pre-v2 sessions. */
function legacyDirection(d: SessionDirection): Direction {
  return {
    id: d.id,
    blueprint: resolveBlueprint(d.blueprint) ?? BLUEPRINTS[0]!,
    baseBlueprint: d.baseBlueprint ?? d.blueprint,
    palette: d.palette,
    typography: d.typography,
    effects: d.effects,
    motion: d.motion,
    density: d.density,
    fit: d.fit,
    novelty: d.novelty,
    rationale: d.rationale,
    features: d.features,
    composition: d.composition ?? d.blueprint,
  };
}

/* ------------------------------------------------------------------ *
 * Revision — a scoped change to the chosen resolved spec
 * ------------------------------------------------------------------ */
export interface ReviseOptions {
  instructions: string;
  /** Attempt the copy rewrite even with no writer (reports honestly). */
  finalCopy?: boolean;
  signal?: AbortSignal;
}

export interface ReviseResult {
  scope: 'copy' | 'visual' | 'mixed';
  spec: DesignSpec;
  html: string;
  slug: string;
  notes: string[];
  /** Model calls spent on this revision (0 or 1 — never a re-decision). */
  modelCalls: number;
  writerMs: number;
}

/**
 * Revise the FINALIZED design — not a re-run of selection.
 *
 * A revision is a scoped change to the chosen resolved spec:
 *
 *   copy    — wording only. Layout, styling, seed and assets are preserved
 *             byte-for-byte; with no writer configured the copy is left alone
 *             and said so, rather than anything being "regenerated".
 *   visual  — only the visual axes the request actually names change;
 *             everything unrelated (blueprint, seed, content, assets, and the
 *             axes not mentioned) is preserved. Selected tokens are the
 *             source of truth — not the decider's original metadata.
 *   mixed   — both, still one writer call at most.
 *
 * It never re-decides, never re-runs selection, and never costs a Jev call.
 */
export async function reviseSession(
  outDir: string,
  session: DirectionSession,
  opts: ReviseOptions,
): Promise<ReviseResult> {
  if (!session.finalSlug) throw new Error('finalize the direction first, then revise it');
  const parent = await getDesign(outDir, session.finalSlug);
  if (!parent) throw new Error('the finalized design could not be reloaded');
  const spec = JSON.parse(JSON.stringify(parent.spec)) as DesignSpec;
  const bp = resolveBlueprint(spec.blueprint) ?? BLUEPRINTS[0]!;
  const notes: string[] = [];

  const scope = classifyRevision(opts.instructions);
  let modelCalls = 0;
  let writerMs = 0;

  /* ---- visual scope: touch only the axes the request names ---------- */
  if (scope !== 'copy') {
    const applied = applyVisualEdit(spec, opts.instructions);
    notes.push(...applied.notes);
    if (!applied.changed.length) {
      notes.push(
        'no supported visual axis matched the request — nothing visual was changed (the catalog is the only vocabulary this tool can speak)',
      );
    }
  }

  /* ---- copy scope: wording only -------------------------------------- */
  let content = spec.content;
  if (scope !== 'visual') {
    if (opts.finalCopy === false) {
      notes.push('copy left unchanged: the copy rewrite was switched off');
    } else if (!resolveLlm()) {
      notes.push('copy left unchanged: no writer is configured (layout, styling, seed and assets are untouched)');
    } else {
      const revised = await reviseContent(spec, opts.instructions, {
        fallback: spec.content ?? fallbackContent(spec.brief, []),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      content = revised.content;
      modelCalls = revised.source === 'llm' ? 1 : 0;
      writerMs = revised.latencyMs;
      spec.meta.writer = revised.source;
      spec.meta.writerModel = revised.model;
      spec.meta.writerLatencyMs = revised.latencyMs;
      spec.meta.writerInputTokens = revised.inputTokens;
      spec.meta.writerOutputTokens = revised.outputTokens;
      spec.meta.writerEstimatedUsd = writerCost(revised.inputTokens, revised.outputTokens);
      if (revised.fallbackReason) notes.push(`copy rewrite fell back to the existing copy — ${revised.fallbackReason}`);
      else notes.push(`copy rewritten in ${revised.latencyMs}ms; layout, seed and assets unchanged`);
    }
  } else {
    notes.push('copy unchanged: this is a visual edit and unrelated choices are preserved');
  }
  if (content) spec.content = content;

  const slug = await nextIterationSlug(outDir, session.finalSlug);
  const html = renderHtml(spec, { fontBasePath: 'fonts/' });
  const placement = verifyAssetPlacement(html, spec.assets);
  if (!placement.ok) {
    for (const issue of placement.issues) notes.push(`asset placement: slot "${issue.slot}" — ${issue.reason}`);
  }

  await writeFile(path.join(outDir, `${slug}.html`), html, 'utf8');
  await writeFile(path.join(outDir, `${slug}.spec.json`), JSON.stringify(spec, null, 2), 'utf8');
  await ensureBundledFonts(outDir, path.resolve(process.cwd(), 'public'));

  session.revisions = (session.revisions ?? 0) + 1;
  session.history.push({
    at: new Date().toISOString(),
    event: 'revised',
    detail: `${scope}: ${opts.instructions.slice(0, 80)} → ${slug}`,
  });
  await saveSession(outDir, session);

  return { scope, spec, html, slug, notes, modelCalls, writerMs };
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */
/** Module ids a session's directions collectively require, for reporting. */
export function sessionModules(session: DirectionSession): ModuleId[] {
  const out = new Set<ModuleId>();
  for (const d of session.directions) {
    const bp = resolveBlueprint(d.blueprint);
    if (bp) for (const m of requiredModules(bp)) out.add(m);
  }
  return [...out];
}

export { ingestUserImages, LockError, SELECTION_VERSION };
export type { Blueprint, UserImageRequest, BuildStats, DiversityReport, LockName };
