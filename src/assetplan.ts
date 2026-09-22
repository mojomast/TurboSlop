/**
 * TurboSlop — the shared asset plan.
 *
 * There is exactly ONE path that decides what artwork a design gets, and it is
 * used by the control surface, direction sessions, the CLI and exports. The
 * rules, in order:
 *
 *   1. A slot is a PLACE. Only slots this layout actually renders — given the
 *      chosen block variant and the content that exists — can receive an
 *      image. A gallery with no items renders no figures, so it requests no
 *      pictures; an `items:table` renders no plates, so catalogue slots do not
 *      exist on it.
 *   2. Supplied images resolve FIRST. A slot the owner filled is never
 *      generated for — one filled slot means one fewer request.
 *   3. Generation is opt-in AND capped by what is left. Zero renderable slots
 *      produce ZERO requests to the image service: this is the fix for the
 *      baseline's "2 generated, 0 rendered" and for the contact sheet's
 *      finalization silently skipping or over-requesting art.
 *   4. After render, `verifyAssetPlacement` checks each requested asset in its
 *      INTENDED slot — a URL appearing somewhere in the HTML is not evidence.
 *
 * Failures are notes, never throws: a bad supplied path must not cost a design.
 * Every note is returned so the control surface can show it.
 */
import path from 'node:path';
import { imageSlotsFor, type Blueprint, type BlueprintImageSlot, type ModuleId } from './blueprint.js';
import { fallbackContent, validateContentForBlueprint, type Content } from './content.js';
import {
  IMAGE_PRESETS,
  generateAssets,
  resolveImageService,
  resolveImageSettings,
  type GeneratedAsset,
  type ImageServiceConfig,
} from './images.js';
import { ingestUserImages, type UserImageRequest } from './userassets.js';
import type { Asset, DesignSpec } from './types.js';

/**
 * Alt text for generated artwork.
 *
 * It says what the image IS — including calling an enlarged 256px asset a
 * texture rather than letting it pass as a photograph — because alt text is
 * where that honesty actually reaches a reader.
 */
export function assetAlt(kind: string, spec: DesignSpec, slot?: { role?: string; scale?: string }): string {
  const emotion = spec.tokens.emotion ?? 'studio';
  const texture = slot?.scale === 'texture' ? 'enlarged texture' : 'study';
  const map: Record<string, string> = {
    backdrop: `Abstract atmospheric ${texture} in a ${emotion} register`,
    surface: `Surface ${texture} in a ${emotion} register`,
    motif: `Geometric motif suggesting ${emotion}`,
  };
  return map[kind] ?? 'Generated decorative artwork';
}

export interface AssetSettings {
  enabled: boolean;
  count: number;
  preset: string;
  steps?: number;
  cfg?: number;
  seed?: number;
}

export const NO_IMAGES: AssetSettings = { enabled: false, count: 0, preset: 'balanced' };

/**
 * Which items variants actually render a plate.
 *
 * Mirrors `blocks.ts`: `rail`, `grid`, `bento` and `gallery` draw a plate per
 * item; `table`, `list` and `editorial-index` are typographic and draw none.
 */
const PLATE_ITEMS_VARIANTS = new Set(['rail', 'grid', 'bento', 'gallery']);

/**
 * The slots this page will visibly render, given its layout AND content.
 *
 * This is "validate slot ownership against the actual rendered module variant
 * and available content" in one function: variant ownership (does this shape
 * draw plates at all?) is checked without content, and figure COUNT is checked
 * against the content that exists.
 */
export function renderableSlots(bp: Blueprint, content?: Content): BlueprintImageSlot[] {
  const slots = imageSlotsFor(bp);
  return slots.filter((slot) => {
    /* Hero slots belong to heroes that draw a plate — imageSlotsFor only
       emits them for those, so the hero is always renderable. */
    if (slot.id === 'hero') return true;
    const m = /^([a-z]+)-(\d+)$/.exec(slot.id);
    if (!m) return false;
    const module = m[1] as ModuleId;
    const n = Number(m[2]);
    const sec = bp.sections.find((s) => s.module === module);
    if (!sec) return false;
    /* Variant ownership first: an `items:table` draws no plates even before we
       know how many items exist. */
    if (module === 'items' && !PLATE_ITEMS_VARIANTS.has(sec.variant)) return false;
    if (!content) return true; // no content yet: count unknown, layout owns the slot
    return n <= (module === 'gallery' || module === 'items' ? content.items.length : Infinity);
  });
}

/** Modules whose content the inventory can honestly fill right now. */
export function availableModulesOf(content: Content): Set<ModuleId> {
  const all = new Set<ModuleId>([
    'items', 'features', 'stats', 'about', 'process', 'quote',
    'gallery', 'schedule', 'pricing', 'faq', 'contact',
  ]);
  const check = validateContentForBlueprint(content, [...all]);
  const missing = new Set(check.missing);
  for (const m of missing) all.delete(m as ModuleId);
  return all;
}

/** Missing-content diagnostics for the control surface, one line per module. */
export function contentDiagnostics(bp: Blueprint, content: Content | undefined): string[] {
  if (!content) return [`no content supplied for ${bp.id}`];
  const check = validateContentForBlueprint(content, [...new Set(bp.sections.map((s) => s.module))]);
  return check.missing.map(
    (m) => `${m}: the inventory supplied nothing this ${bp.id} section can render — the page shows an honest "not supplied" note instead of inventing one`,
  );
}

/* ------------------------------------------------------------------ *
 * Placement verification
 * ------------------------------------------------------------------ */
export interface PlacementIssue {
  slot: string;
  file: string;
  reason: string;
}

export interface PlacementReport {
  ok: boolean;
  checked: number;
  issues: PlacementIssue[];
}

/**
 * Is each asset in the slot it was made for?
 *
 * The renderer marks every plate `data-slot="…"`, so this looks for the asset's
 * own file inside ITS slot's element. Finding the URL anywhere in the HTML is
 * explicitly not enough — a borrowed neighbour's picture is the failure this
 * exists to catch.
 */
export function verifyAssetPlacement(html: string, assets: Asset[]): PlacementReport {
  const issues: PlacementIssue[] = [];
  let checked = 0;

  const marks = [...html.matchAll(/data-slot="([^"]*)"/g)].map((m) => ({
    slot: m[1]!,
    at: m.index!,
  }));

  for (const a of assets) {
    if (!a.slot) continue; // legacy assets with no recorded slot are not slot-addressable
    checked++;
    const start = marks.find((mk) => mk.slot === a.slot);
    if (!start) {
      issues.push({ slot: a.slot, file: a.file, reason: 'the rendered page has no element for this slot' });
      continue;
    }
    const next = marks.find((mk) => mk.at > start.at);
    const region = html.slice(start.at, next ? next.at : start.at + 4000);
    if (!region.includes(`src="${a.file}"`) && !region.includes(`url("${a.file}")`)) {
      issues.push({ slot: a.slot, file: a.file, reason: 'this slot renders, but not with this asset' });
    }
  }
  return { ok: issues.length === 0, checked, issues };
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */
export interface PlanInput {
  spec: DesignSpec;
  blueprint: Blueprint;
  settings: AssetSettings;
  userImages?: UserImageRequest[];
  userImageRoot?: string;
  outDir: string;
  slug: string;
}

export interface AssetPlan {
  /** Every slot this layout declares. */
  slots: BlueprintImageSlot[];
  /** Slots that will visibly render, given the content. */
  renderable: BlueprintImageSlot[];
  /** Slots already filled by supplied images. */
  filledByUser: string[];
  /** Slots left to generate (empty when images are off or nothing is unfilled). */
  toGenerate: BlueprintImageSlot[];
  /** Everything the plan learned, including refusals. Surfaced verbatim. */
  notes: string[];
}

/** Resolve supplied images first, then decide what (if anything) to generate. */
export async function planAssets(input: PlanInput): Promise<{ plan: AssetPlan; supplied: Asset[] }> {
  const notes: string[] = [];
  const slots = imageSlotsFor(input.blueprint);
  const renderable = renderableSlots(input.blueprint, input.spec.content);

  const dropped = slots.filter((s) => !renderable.some((r) => r.id === s.id));
  if (dropped.length) {
    notes.push(
      `${dropped.length} slot(s) not rendered by this layout/content and ignored: ${dropped.map((s) => s.id).join(', ')}`,
    );
  }

  let supplied: Asset[] = [];
  if (input.userImages?.length) {
    const ingested = await ingestUserImages({
      outDir: input.outDir,
      slug: input.slug,
      root: input.userImageRoot ?? process.cwd(),
      requests: input.userImages,
      allowedSlots: renderable.map((s) => s.id),
    });
    notes.push(...ingested.notes);
    supplied = ingested.assets;
  }

  const filledByUser = supplied.map((a) => a.slot);
  let toGenerate: BlueprintImageSlot[] = [];
  if (input.settings.enabled) {
    const unfilled = renderable.filter((s) => !filledByUser.includes(s.id));
    const want = Math.max(0, input.settings.count);
    toGenerate = unfilled.slice(0, Math.min(want, unfilled.length));
    if (!renderable.length) {
      notes.push('image setting is on, but this layout renders 0 image slots — 0 image requests were made');
    } else if (!toGenerate.length && unfilled.length === 0) {
      notes.push('every renderable slot is already filled by a supplied image — 0 image requests were made');
    }
  } else if (renderable.length) {
    notes.push(`images off: ${renderable.length} renderable slot(s) keep their CSS gradient plates`);
  }

  return {
    plan: { slots, renderable, filledByUser, toGenerate, notes },
    supplied,
  };
}

export interface FinalizeAssetResult {
  assets: Asset[];
  plan: AssetPlan;
  /** Time spent generating, 0 when nothing was requested. */
  imageMs: number;
  notes: string[];
}

/**
 * Materialise the plan: supplied images already resolved, then generate ONLY
 * the unfilled, renderable slots — and never when there are none.
 */
export async function finalizeAssets(
  input: PlanInput,
  service?: ImageServiceConfig | null,
  onProgress?: (msg: string) => void,
): Promise<FinalizeAssetResult> {
  const { plan, supplied } = await planAssets(input);
  const notes = [...plan.notes];
  const assets: Asset[] = [...supplied];
  let imageMs = 0;

  if (plan.toGenerate.length) {
    const cfg = service ?? resolveImageService();
    if (!cfg) {
      notes.push('image setting is on but no image service is configured — no requests were made');
    } else {
      const { steps, cfg: guidance, preset } = resolveImageSettings({
        imagePreset: input.settings.preset,
        ...(input.settings.steps !== undefined ? { imageSteps: input.settings.steps } : {}),
        ...(input.settings.cfg !== undefined ? { imageCfg: input.settings.cfg } : {}),
      });
      try {
        const run = await generateAssets(input.spec, {
          count: plan.toGenerate.length,
          slots: plan.toGenerate,
          steps,
          cfg: guidance,
          ...(input.settings.seed !== undefined ? { seed: input.settings.seed } : {}),
          outDir: input.outDir,
          slug: input.slug,
          service: cfg,
          ...(onProgress ? { onProgress } : {}),
        });
        imageMs = run.totalMs;
        const kept = new Set(plan.renderable.map((s) => s.id));
        assets.push(
          ...run.assets
            .filter((a: GeneratedAsset) => kept.has(a.slot))
            .map((a: GeneratedAsset) => {
              const slot = plan.renderable.find((x) => x.id === a.slot);
              return {
                kind: a.kind,
                slot: a.slot,
                source: 'generated' as const,
                file: path.relative(input.outDir, a.file).split(path.sep).join('/'),
                alt: assetAlt(a.kind, input.spec, slot),
                credit: '',
                license: '',
                nativeWidth: 256,
                nativeHeight: 256,
                prompt: a.prompt,
                seed: a.seed,
                steps: a.steps,
                cfg: a.cfg,
                bytes: a.bytes,
                seconds: a.seconds,
              } satisfies Asset;
            }),
        );
        notes.push(
          `generated ${run.assets.length} image(s) for ${plan.toGenerate.map((s) => s.id).join(', ')} ` +
            `at ${preset.label} (steps ${steps}, guidance ${guidance}) in ${run.totalMs}ms`,
        );
      } catch (err) {
        notes.push(
          `image generation failed — continuing with plates and supplied art: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /* One asset per slot, supplied first: a supplied image always wins its slot,
     whatever ran first. Slot-less legacy assets are kept as-is. */
  const seen = new Set<string>();
  const deduped: Asset[] = [];
  for (const a of assets) {
    if (a.slot) {
      if (seen.has(a.slot)) continue;
      seen.add(a.slot);
    }
    deduped.push(a);
  }

  return { assets: deduped, plan, imageMs, notes };
}

/** Presets for the control surface / CLI help, in one place. */
export function assetPresetList(): { id: string; steps: number; cfg: number; label: string; note: string }[] {
  return Object.entries(IMAGE_PRESETS).map(([id, p]) => ({ id, ...p }));
}

/** Used when a caller has no content yet (preview planning). */
export function placeholderContent(brief: string): Content {
  return fallbackContent(brief, []);
}
