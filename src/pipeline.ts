/**
 * TurboSlop — the pipeline, in one place.
 *
 * Both the CLI and the control-surface server drive this, so there is exactly
 * one definition of what "generate a design" means:
 *
 *   brief ──► Jev decides ──► copywriter writes ──► [images] ──► render ──► files
 *
 * Each stage is optional and fails soft. Nothing downstream is allowed to
 * become a hard dependency of anything upstream.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decideWithFallback, type DeciderPreference } from './decider.js';
import { compose } from './compose.js';
import { fallbackContent, validateContentForBlueprint } from './content.js';
import { buildDirections, type Direction, type Distributions } from './directions.js';
import { imageSlotsFor, requiredModules } from './blueprint.js';
import { writeContent } from './writer.js';
import {
  IMAGE_PRESETS,
  generateAssets,
  resolveImageService,
  resolveImageSettings,
  promptBudgetWarning,
  type ImagePreset,
} from './images.js';
import { renderHtml } from './render.js';
import { ingestUserImages, type UserImageRequest } from './userassets.js';
import { jevCost, writerCost } from './pricing.js';
import type { DesignSpec } from './types.js';
export type ProgressPhase = 'decide' | 'content' | 'images' | 'render' | 'write' | 'done' | 'error';

export interface ProgressEvent {
  phase: ProgressPhase;
  message: string;
  /** Populated during image generation. */
  index?: number;
  total?: number;
}

export interface ImageOptions {
  enabled: boolean;
  count: number;
  preset: string;
  steps?: number;
  cfg?: number;
  seed?: number;
}

export interface RunOptions {
  brief: string;
  /** When set, this is an iteration: the previous design is fed back in. */
  parent?: { spec: DesignSpec; instructions?: string } | null;
  decider: DeciderPreference;
  /**
   * Which direction to build. Omitted means "the best fit". Set by the control
   * surface when a human picks from the contact sheet.
   */
  directionIndex?: number;
  /** How many directions to generate before choosing. */
  directionCount?: number;
  /** Fit-first (0) <-> explore (1) dial. */
  explore?: number;
  /** Rendered direction set, when a caller wants the whole contact sheet. */
  onDirections?: (dirs: Direction[]) => void;
  noCopy: boolean;
  /** Real brand/product images. Preferred over anything generated. */
  userImages?: UserImageRequest[];
  /** Directory the user image paths resolve against. */
  userImageRoot?: string;
  images: ImageOptions;
  outDir: string;
  slug: string;
  /** Direction-selection seed, so a batch is reproducible. */
  seed?: number;
  onProgress?: (e: ProgressEvent) => void;
}

export interface RunResult {
  spec: DesignSpec;
  html: string;
  notes: string[];
  files: { html: string; spec: string; assets: string[] };
  timings: { decideMs: number; writerMs: number; imageMs: number; totalMs: number };
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'design'
  );
}

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

/**
 * Compose the brief actually sent to the decider.
 *
 * On an iteration we keep the original brief as the anchor and append the
 * change request, so the design's identity survives while the direction moves.
 * The parent's chosen axes are stated explicitly so Jev treats them as the
 * current position rather than re-deciding from nothing.
 */
export function briefForRun(opts: RunOptions): string {
  if (!opts.parent) return opts.brief;
  const p = opts.parent.spec;
  const current = p.decisions.map((d) => `${d.axis}: ${d.picked}`).join(', ');
  const parts = [
    `ORIGINAL BRIEF: ${opts.brief}`,
    `CURRENT DESIGN (already built): ${current}.`,
  ];
  if (opts.parent.instructions?.trim()) {
    parts.push(`REQUESTED CHANGE: ${opts.parent.instructions.trim()}`);
  }
  parts.push(
    'Keep what still works. Change what the request asks for, and adjust anything that no longer fits the change.',
  );
  return parts.join('\n');
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const say = (phase: ProgressPhase, message: string, extra?: Partial<ProgressEvent>) =>
    opts.onProgress?.({ phase, message, ...extra });

  const started = Date.now();
  const notes: string[] = [];

  // ---- 1. decisions (Jev) -------------------------------------------------
  const briefForDecider = briefForRun(opts);
  say('decide', 'Asking Jev for design decisions…');
  const decided = await decideWithFallback(briefForDecider, { preference: opts.decider });
  /* ---- 1b. turn the ranked alternatives into a set of directions ---------
     One decision call already contains a full distribution per axis. Using only
     the argmax is what made every page a member of one family. */
  const distributions: Distributions = {};
  for (const [id, ans] of Object.entries(decided.response.answers)) {
    if (ans.type === 'choice') distributions[id as keyof Distributions] = ans.probabilities;
  }
  const wantsDark =
    ((decided.response.answers.wants_dark_ground as { noul?: number } | undefined)?.noul ?? 0) > 0.6;

  const seed = opts.seed ?? Date.now() % 1_000_000;
  const dirs = buildDirections({
    brief: briefForDecider,
    distributions,
    count: opts.directionCount ?? 6,
    seed,
    wantsDark,
    explore: opts.explore ?? 0.45,
  });
  opts.onDirections?.(dirs);

  const idx = Math.max(0, Math.min(dirs.length - 1, opts.directionIndex ?? 0));
  const chosenDir = dirs[idx];
  if (chosenDir) {
    say(
      'decide',
      `Direction ${idx + 1}/${dirs.length}: ${chosenDir.blueprint.id} (${chosenDir.blueprint.lead}-led), fit ${chosenDir.fit.toFixed(3)}, novelty ${chosenDir.novelty.toFixed(2)}`,
    );
  }

  const { spec, notes: composeNotes } = compose(briefForDecider, decided, {
    seed,
    ...(chosenDir
      ? {
          direction: {
            blueprint: chosenDir.blueprint.id,
            palette: chosenDir.palette,
            typography: chosenDir.typography,
            effects: chosenDir.effects,
            motion: chosenDir.motion,
            density: chosenDir.density,
            fit: chosenDir.fit,
            novelty: chosenDir.novelty,
            rationale: chosenDir.rationale,
            alternatives: dirs
              .filter((_, i) => i !== idx)
              .slice(0, 5)
              .map((d) => ({ blueprint: d.blueprint.id, fit: d.fit })),
          },
        }
      : {}),
  });
  notes.push(...composeNotes);
  if (decided.fallbackReason) {
    notes.push(`Jev unavailable, used the local stand-in — ${decided.fallbackReason}`);
  }
  say(
    'decide',
    `${decided.kind === 'live' ? 'Jev' : 'Local'} decided in ${decided.latencyMs}ms` +
      ` (${spec.decisions.map((d) => d.picked).join(' · ')})`,
  );

  // ---- 2. content (LLM) ---------------------------------------------------
  // The design is decided; now write everything the page SAYS, in that register.
  const axes = spec.decisions.map((d) => ({
    axis: d.axis,
    picked: d.picked,
    confidence: d.confidence,
  }));
  const fallback = fallbackContent(briefForDecider, axes);

  const required = chosenDir ? requiredModules(chosenDir.blueprint) : undefined;
  say(
    'content',
    opts.noCopy
      ? 'Skipping the writer — using specimen content'
      : `Writing content for ${required?.length ?? 0} module(s)…`,
  );
  const written = await writeContent(briefForDecider, spec, {
    offline: opts.noCopy,
    fallback,
    ...(required ? { required } : {}),
  });

  // A blueprint that cannot be filled honestly is rejected, not faked.
  const usable = validateContentForBlueprint(written.content, required ?? []);
  if (!usable.ok) {
    notes.push(
      `direction ${spec.blueprint} needed ${usable.missing.join(', ')} which the brief did not supply — rendered the available modules instead`,
    );
  }
  // Always present: either written or the honest specimen.
  spec.content = written.content;
  spec.meta.writer = written.source;
  spec.meta.writerModel = written.model;
  spec.meta.writerLatencyMs = written.latencyMs;
  spec.meta.writerInputTokens = written.inputTokens;
  spec.meta.writerOutputTokens = written.outputTokens;
  spec.meta.writerReasoningTokens = written.reasoningTokens;
  spec.meta.writerEstimatedUsd = writerCost(written.inputTokens, written.outputTokens);
  if (written.fallbackReason) {
    notes.push(`writer fell back to the specimen — ${written.fallbackReason}`);
  }
  say(
    'content',
    written.source === 'llm'
      ? `Content written in ${written.latencyMs}ms — brand "${written.content.brand}"`
      : 'Using specimen content',
  );

  // ---- 3. images (optional, never fatal) ----------------------------------
  if (opts.images.enabled) {
    const service = resolveImageService();
    if (!service) {
      notes.push('images requested but no allowlisted image service is configured');
      say('images', 'No image service configured — skipping');
    } else {
      const { steps, cfg, preset } = resolveImageSettings({
        imagePreset: opts.images.preset,
        ...(opts.images.steps !== undefined ? { imageSteps: opts.images.steps } : {}),
        ...(opts.images.cfg !== undefined ? { imageCfg: opts.images.cfg } : {}),
      });
      /* Only the places this direction actually renders. Asking for six images
         for a page with two slots is how the baseline ended up with artwork on
         disk and 0 <img> elements in the page. */
      const slots = chosenDir ? imageSlotsFor(chosenDir.blueprint) : [];
      const wanted = slots.length ? Math.min(opts.images.count, slots.length) : opts.images.count;
      say(
        'images',
        slots.length
          ? `Filling ${wanted} of ${slots.length} slot(s): ${slots.slice(0, wanted).map((x) => x.id).join(', ')} — ${preset.label}`
          : `Generating ${opts.images.count} image(s) — ${preset.label} (steps ${steps}, guidance ${cfg})`,
        { index: 0, total: wanted },
      );
      try {
        const run = await generateAssets(spec, {
          count: wanted,
          steps,
          cfg,
          ...(slots.length ? { slots } : {}),
          ...(opts.images.seed !== undefined ? { seed: opts.images.seed } : {}),
          outDir: opts.outDir,
          slug: opts.slug,
          service,
          onProgress: (m) => say('images', m),
        });
        spec.assets = run.assets.map((a) => {
          const warn = promptBudgetWarning(a.prompt);
          if (warn) notes.push(warn);
          const slot = slots.find((x) => x.id === a.slot);
          return {
            kind: a.kind,
            slot: a.slot,
            source: 'generated' as const,
            file: path.relative(opts.outDir, a.file).split(path.sep).join('/'),
            alt: assetAlt(a.kind, spec, slot),
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
          };
        });
        spec.meta.imageSteps = steps;
        spec.meta.imageCfg = cfg;
        spec.meta.imageCount = spec.assets.length;
        spec.meta.imageMs = run.totalMs;
        notes.push(
          `images: ${spec.assets.length} filled of ${slots.length || opts.images.count} slot(s) at ${preset.label} ` +
            `(steps ${steps}, guidance ${cfg}) in ${run.totalMs}ms`,
        );
        say('images', `${spec.assets.length} image(s) in ${run.totalMs}ms`);
      } catch (err) {
        notes.push(
          `image generation failed — continuing without art: ${err instanceof Error ? err.message : String(err)}`,
        );
        say('images', 'Image generation failed — continuing without art');
      }
    }
  }

  // ---- 3b. user-supplied images (always preferred over generated ones) ----
  if (opts.userImages?.length) {
    const slotIds = chosenDir ? imageSlotsFor(chosenDir.blueprint).map((x) => x.id) : [];
    const ingested = await ingestUserImages({
      outDir: opts.outDir,
      slug: opts.slug,
      root: opts.userImageRoot ?? process.cwd(),
      requests: opts.userImages,
      allowedSlots: slotIds,
    });
    notes.push(...ingested.notes);
    if (ingested.assets.length) {
      // A supplied image replaces whatever was generated for the same slot.
      const taken = new Set(ingested.assets.map((a) => a.slot));
      spec.assets = [...ingested.assets, ...spec.assets.filter((a) => !taken.has(a.slot))];
      notes.push(`user images: ${ingested.assets.length} supplied (preferred over generated art)`);
    }
  }

  // ---- 4. render + persist ------------------------------------------------
  say('render', 'Rendering…');
  const html = renderHtml(spec);

  await mkdir(opts.outDir, { recursive: true });
  const htmlFile = path.join(opts.outDir, `${opts.slug}.html`);
  const specFile = path.join(opts.outDir, `${opts.slug}.spec.json`);
  await writeFile(htmlFile, html, 'utf8');
  await writeFile(specFile, JSON.stringify(spec, null, 2), 'utf8');
  say('write', `Wrote ${path.basename(htmlFile)}`);

  const totalMs = Date.now() - started;
  say('done', `Done in ${totalMs}ms`);

  return {
    spec,
    html,
    notes,
    files: { html: htmlFile, spec: specFile, assets: spec.assets.map((a) => a.file) },
    timings: {
      decideMs: decided.latencyMs,
      writerMs: written.latencyMs,
      imageMs: spec.meta.imageMs,
      totalMs,
    },
  };
}

/** Named presets, for the control surface to display. */
export function imagePresetList(): (ImagePreset & { id: string })[] {
  return Object.entries(IMAGE_PRESETS).map(([id, p]) => ({ id, ...p }));
}
