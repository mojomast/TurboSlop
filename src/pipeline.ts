/**
 * turboslop — the pipeline, in one place.
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
import { writeCopy } from './copy.js';
import {
  IMAGE_PRESETS,
  generateAssets,
  resolveImageService,
  resolveImageSettings,
  promptBudgetWarning,
  type ImagePreset,
} from './images.js';
import { renderHtml } from './render.js';
import type { DesignSpec } from './types.js';
export type ProgressPhase = 'decide' | 'copy' | 'images' | 'render' | 'write' | 'done' | 'error';

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
  noCopy: boolean;
  images: ImageOptions;
  outDir: string;
  slug: string;
  onProgress?: (e: ProgressEvent) => void;
}

export interface RunResult {
  spec: DesignSpec;
  html: string;
  notes: string[];
  files: { html: string; spec: string; assets: string[] };
  timings: { decideMs: number; copyMs: number; imageMs: number; totalMs: number };
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

/** Descriptive alt text for generated decoration. */
export function assetAlt(kind: string, spec: DesignSpec): string {
  const emotion = spec.tokens.emotion ?? 'studio';
  const map: Record<string, string> = {
    backdrop: `Abstract atmospheric backdrop in a ${emotion} register`,
    surface: `Surface and texture study in a ${emotion} register`,
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
  const { spec, notes: composeNotes } = compose(briefForDecider, decided);
  notes.push(...composeNotes);
  if (decided.fallbackReason) {
    notes.push(`Jev unavailable, used the local stand-in — ${decided.fallbackReason}`);
  }
  say(
    'decide',
    `${decided.kind === 'live' ? 'Jev' : 'Local'} decided in ${decided.latencyMs}ms` +
      ` (${spec.decisions.map((d) => d.picked).join(' · ')})`,
  );

  // ---- 2. copy (LLM) ------------------------------------------------------
  say('copy', opts.noCopy ? 'Skipping copy (canonical)' : 'Writing copy…');
  const written = await writeCopy(briefForDecider, spec, { offline: opts.noCopy });
  if (written.source === 'llm') spec.copy = written.copy;
  spec.meta.copyWriter = written.source;
  spec.meta.copyModel = written.model;
  spec.meta.copyLatencyMs = written.latencyMs;
  spec.meta.copyInputTokens = written.inputTokens;
  spec.meta.copyOutputTokens = written.outputTokens;
  if (written.fallbackReason) notes.push(`copy fell back to canonical — ${written.fallbackReason}`);
  say('copy', written.source === 'llm' ? `Copy written in ${written.latencyMs}ms` : 'Using canonical copy');

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
      say('images', `Generating ${opts.images.count} image(s) — ${preset.label} (steps ${steps}, guidance ${cfg})`, {
        index: 0,
        total: opts.images.count,
      });
      try {
        const run = await generateAssets(spec, {
          count: opts.images.count,
          steps,
          cfg,
          ...(opts.images.seed !== undefined ? { seed: opts.images.seed } : {}),
          outDir: opts.outDir,
          slug: opts.slug,
          service,
          onProgress: (m) => say('images', m),
        });
        spec.assets = run.assets.map((a) => {
          const warn = promptBudgetWarning(a.prompt);
          if (warn) notes.push(warn);
          return {
            kind: a.kind,
            file: path.relative(opts.outDir, a.file).split(path.sep).join('/'),
            alt: assetAlt(a.kind, spec),
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
          `images: ${spec.assets.length}/${opts.images.count} at ${preset.label} ` +
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
      copyMs: written.latencyMs,
      imageMs: spec.meta.imageMs,
      totalMs,
    },
  };
}

/** Named presets, for the control surface to display. */
export function imagePresetList(): (ImagePreset & { id: string })[] {
  return Object.entries(IMAGE_PRESETS).map(([id, p]) => ({ id, ...p }));
}
