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
import { requiredModules, resolveBlueprint } from './blueprint.js';
import { availableModulesOf, assetAlt, contentDiagnostics, finalizeAssets, verifyAssetPlacement, type AssetSettings } from './assetplan.js';
import { historyFeatures, projectId, recordHistory } from './history.js';
import { writeContent } from './writer.js';
import { IMAGE_PRESETS, resolveImageSettings, type ImagePreset } from './images.js';
import { renderHtml } from './render.js';
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
  userImages?: import('./userassets.js').UserImageRequest[];
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
  /** Each stage measured separately: decide, write, assets, local render, total. */
  timings: { decideMs: number; writerMs: number; imageMs: number; renderMs: number; totalMs: number };
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
 * Alt text for generated artwork — now owned by the shared asset plan, so the
 * CLI, sessions and exports all describe an image the same way.
 */
export { assetAlt };

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
  const project = projectId();
  /* Project history is an INPUT to selection: a single-design run avoids
     repeating what this project recently resolved, from a snapshot taken
     before the search so the run reproduces from (version, inputs, seed,
     snapshot). */
  const snapshot = await historyFeatures(opts.outDir, project);
  const built = buildDirections({
    brief: briefForDecider,
    distributions,
    count: opts.directionCount ?? 6,
    seed,
    wantsDark,
    explore: opts.explore ?? 0.45,
    history: snapshot.features,
    // Offline runs write specimen content: only modules the specimen can
    // honestly fill are eligible. With a writer configured every module is
    // requested and compatibility is checked against the real content below.
    ...(opts.noCopy ? { availableModules: availableModulesOf(fallbackContent(briefForDecider, [])) } : {}),
  });
  const dirs = built.directions;
  opts.onDirections?.(dirs);
  if (built.stats.generated) {
    notes.push(
      `selection: ${built.stats.structures} layouts × bounded styling = ${built.stats.generated} candidates → ` +
        `${built.stats.afterContent} after de-duplication, near-duplicate rejection, history and content filters`,
    );
  }
  if (dirs.length && !built.report.met) {
    notes.push(
      `diversity targets missed: ${built.report.shortfall.map((s) => `${s.target} (${s.got}/${s.wanted} — ${s.reason})`).join('; ')}`,
    );
  }
  if (built.stats.historyRelaxed) {
    notes.push('project history separation was relaxed: the recent-fingerprint filter would have starved this run');
  }

  let idx = Math.max(0, Math.min(dirs.length - 1, opts.directionIndex ?? 0));
  let chosenDir = dirs[idx];
  if (chosenDir) {
    say(
      'decide',
      `Direction ${idx + 1}/${dirs.length}: ${chosenDir.blueprint.id} (${chosenDir.blueprint.lead}-led), fit ${chosenDir.fit.toFixed(3)}, separation ${chosenDir.novelty.toFixed(2)}`,
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
    /* Content compatibility: prefer the best-fitting direction the written
       content CAN fill, rather than rendering empty pricing tables or an
       empty gallery to satisfy a pick. No model call: the set is stored. */
    const available = availableModulesOf(written.content);
    const eligible = dirs.find(
      (d) => d.blueprint.id !== chosenDir?.blueprint.id && requiredModules(d.blueprint).every((m) => available.has(m)),
    );
    if (eligible && chosenDir && !requiredModules(chosenDir.blueprint).every((m) => available.has(m))) {
      notes.push(
        `direction ${chosenDir.blueprint.id} needed ${usable.missing.join(', ')} which the brief did not supply — ` +
          `switched to ${eligible.blueprint.id}, which the written content fills honestly (fit ${eligible.fit.toFixed(3)})`,
      );
      idx = dirs.indexOf(eligible);
      chosenDir = eligible;
      const recompose = compose(briefForDecider, decided, {
        seed: directionSeedForLocal(seed, eligible.id),
        direction: {
          blueprint: eligible.blueprint.id,
          palette: eligible.palette,
          typography: eligible.typography,
          effects: eligible.effects,
          motion: eligible.motion,
          density: eligible.density,
          fit: eligible.fit,
          novelty: eligible.novelty,
          rationale: eligible.rationale,
          alternatives: dirs.filter((_, i) => i !== idx).slice(0, 5).map((d) => ({ blueprint: d.blueprint.id, fit: d.fit })),
        },
      });
      Object.assign(spec, recompose.spec);
    } else {
      notes.push(
        `direction ${spec.blueprint} needed ${usable.missing.join(', ')} which the brief did not supply — rendered the available modules instead`,
      );
    }
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
  const blueprintForAssets = resolveBlueprint(spec.blueprint) ?? undefined;
  if (blueprintForAssets) {
    for (const d of contentDiagnostics(blueprintForAssets, written.content)) notes.push(d);
  }
  say(
    'content',
    written.source === 'llm'
      ? `Content written in ${written.latencyMs}ms — brand "${written.content.brand}"`
      : 'Using specimen content',
  );

  // ---- 3. assets: ONE shared plan (supplied first, generate only what is left)
  const assetSettings: AssetSettings = {
    enabled: opts.images.enabled,
    count: opts.images.count,
    preset: opts.images.preset,
    ...(opts.images.steps !== undefined ? { steps: opts.images.steps } : {}),
    ...(opts.images.cfg !== undefined ? { cfg: opts.images.cfg } : {}),
    ...(opts.images.seed !== undefined ? { seed: opts.images.seed } : {}),
  };
  if (blueprintForAssets && (assetSettings.enabled || opts.userImages?.length)) {
    if (assetSettings.enabled) {
      const { steps, cfg, preset } = resolveImageSettings({
        imagePreset: assetSettings.preset,
        ...(assetSettings.steps !== undefined ? { imageSteps: assetSettings.steps } : {}),
        ...(assetSettings.cfg !== undefined ? { imageCfg: assetSettings.cfg } : {}),
      });
      spec.meta.imageSteps = steps;
      spec.meta.imageCfg = cfg;
      say(
        'images',
        `Shared asset plan for ${blueprintForAssets.id} — ${preset.label}, steps ${steps}, guidance ${cfg}`,
        { index: 0, total: opts.images.count },
      );
    }
    const planned = await finalizeAssets(
      {
        spec,
        blueprint: blueprintForAssets,
        settings: assetSettings,
        ...(opts.userImages?.length
          ? { userImages: opts.userImages, userImageRoot: opts.userImageRoot ?? process.cwd() }
          : {}),
        outDir: opts.outDir,
        slug: opts.slug,
      },
      null,
      (m) => say('images', m),
    );
    spec.assets = planned.assets;
    spec.meta.imageCount = planned.assets.filter((a) => a.source === 'generated').length;
    spec.meta.imageMs = planned.imageMs;
    notes.push(...planned.notes);
    say('images', `${spec.assets.length} asset(s) placed, ${planned.imageMs}ms generating`);
  } else if (assetSettings.enabled && !blueprintForAssets) {
    notes.push('images requested but the blueprint could not be resolved — no requests were made');
  }

  // ---- 4. render + persist ------------------------------------------------
  say('render', 'Rendering…');
  const renderStart = Date.now();
  const html = renderHtml(spec);
  const renderMs = Date.now() - renderStart;

  /* Placement is verified, not assumed: every asset must be in the slot it
     was made for, or the run says so. */
  const placement = verifyAssetPlacement(html, spec.assets);
  if (!placement.ok) {
    for (const issue of placement.issues) {
      notes.push(`asset placement: slot "${issue.slot}" (${issue.file}) — ${issue.reason}`);
    }
  }

  await mkdir(opts.outDir, { recursive: true });
  const htmlFile = path.join(opts.outDir, `${opts.slug}.html`);
  const specFile = path.join(opts.outDir, `${opts.slug}.spec.json`);
  await writeFile(htmlFile, html, 'utf8');
  await writeFile(specFile, JSON.stringify(spec, null, 2), 'utf8');
  say('write', `Wrote ${path.basename(htmlFile)}`);

  /* Record what this run actually resolved, so the next run in this project
     can avoid it (project-scoped history). */
  if (chosenDir) {
    await recordHistory(
      opts.outDir,
      [{ features: chosenDir.features, source: `design:${opts.slug}`, seed: directionSeedForLocal(seed, chosenDir.id) }],
      project,
    );
  }

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
      renderMs,
      totalMs,
    },
  };
}

/** Stable per-direction seed for a single-design run. */
function directionSeedForLocal(seed: number, directionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < directionId.length; i++) {
    h ^= directionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h ^ Math.imul(seed, 0x9e3779b1)) >>> 0) % 2147483647;
}

/** Named presets, for the control surface to display. */
export function imagePresetList(): (ImagePreset & { id: string })[] {
  return Object.entries(IMAGE_PRESETS).map(([id, p]) => ({ id, ...p }));
}
