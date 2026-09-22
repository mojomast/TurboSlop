#!/usr/bin/env node
/**
 * turboslop — CLI
 *
 * Brief in, validated design spec + rendered page out.
 *
 *   npm run decide -- --brief "A calm spa landing page"
 *   npm run decide -- --briefs briefs.json --out out
 *   npm run decide -- --brief "..." --images --image-count 3
 *
 * All three stages are optional and fail soft. Orchestration lives in
 * pipeline.ts so the CLI and the control-surface server behave identically.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeciderPreference } from './decider.js';
import { IMAGE_PRESETS } from './images.js';
import { runPipeline, slugify } from './pipeline.js';
import type { DesignSpec } from './types.js';

interface Args {
  brief?: string;
  briefs?: string;
  out: string;
  decider: DeciderPreference;
  json: boolean;
  quiet: boolean;
  noCopy: boolean;
  images: boolean;
  imageCount: number;
  imageSteps?: number;
  imageCfg?: number;
  imagePreset: string;
  imageSeed?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: 'out',
    decider: 'auto',
    json: false,
    quiet: false,
    noCopy: false,
    images: false,
    imageCount: 1,
    imagePreset: 'balanced',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    const num = () => {
      const v = Number(next());
      if (!Number.isFinite(v)) throw new Error(`${a} expects a number`);
      return v;
    };
    switch (a) {
      case '--brief': args.brief = next(); break;
      case '--briefs': args.briefs = next(); break;
      case '--out': args.out = next() ?? 'out'; break;
      case '--decider': args.decider = (next() as DeciderPreference) ?? 'auto'; break;
      case '--json': args.json = true; break;
      case '--quiet': args.quiet = true; break;
      case '--no-copy': args.noCopy = true; break;
      case '--images': args.images = true; break;
      case '--image-count': args.imageCount = num(); break;
      case '--image-steps': args.imageSteps = num(); break;
      case '--image-guidance': args.imageCfg = num(); break;
      case '--image-preset': args.imagePreset = next() ?? 'balanced'; break;
      case '--image-seed': args.imageSeed = num(); break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
turboslop — Jev decides, the LLM writes, the image service illustrates

  --brief "..."            a natural-language design brief
  --briefs <file.json>     batch: [{ "name": "...", "brief": "..." }, ...]
  --out <dir>              output directory (default: out)
  --decider auto|live|local  auto uses Jev when TYPESAFE_API_KEY is set
  --no-copy                skip the LLM and keep the canonical copy
  --json                   print the design spec to stdout
  --quiet                  suppress the human summary

  IMAGE GENERATION (opt-in; off unless --images is given)
  --images                 generate artwork for the design
  --image-count <n>        how many images (default 1)
  --image-preset <name>    ${Object.keys(IMAGE_PRESETS).join(' | ')}
  --image-steps <n>        override steps (1-100)
  --image-guidance <n>     override guidance (1-10)
  --image-seed <n>         fixed seed for reproducibility

  presets:${Object.values(IMAGE_PRESETS)
    .map((p) => `\n    ${p.label.padEnd(18)} steps ${String(p.steps).padStart(3)}, guidance ${p.cfg}`)
    .join('')}

  Run the control surface instead:  npm run serve

Environment:
  TYPESAFE_API_KEY         enables live Jev decisions (never stored in the repo)
  FORGE_DECIDER            default decider preference
  FORGE_LLM_PROVIDER       deepseek | openai | openrouter | groq | together | ollama
  FORGE_LLM_BASE_URL       override the LLM endpoint entirely
  FORGE_LLM_MODEL          override the LLM model id
  FORGE_IMAGE_BASE_URL     image service (allowlisted; server-side only)`);
}

function summarize(spec: DesignSpec, notes: string[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  brief      ${spec.brief.split('\n')[0]}`);
  lines.push(`  decider    ${spec.meta.decider} (${spec.meta.model})`);
  lines.push(`  latency    ${spec.meta.latencyMs} ms`);
  lines.push(`  cost       ~$${spec.meta.estimatedUsd.toFixed(6)} (${spec.meta.inputTokens} in tokens)`);
  lines.push(
    `  copy       ${spec.meta.copyWriter}${spec.meta.copyWriter === 'llm' ? ` (${spec.meta.copyModel}, ${spec.meta.copyLatencyMs} ms)` : ''}`,
  );
  if (spec.meta.imageCount > 0) {
    lines.push(
      `  images     ${spec.meta.imageCount} @ steps ${spec.meta.imageSteps} / guidance ${spec.meta.imageCfg} (${spec.meta.imageMs} ms)`,
    );
  }
  lines.push(`  composite  ${spec.composite.normalized.toFixed(3)} / 1.000`);
  lines.push('');
  lines.push('  decisions');
  for (const d of spec.decisions) {
    const flag = d.review ? '  <- REVIEW' : '';
    const bar = '#'.repeat(Math.max(1, Math.round(d.confidence * 10))).padEnd(10, '.');
    lines.push(`    ${d.axis.padEnd(11)} ${d.picked.padEnd(20)} ${bar} ${d.confidence.toFixed(2)}${flag}`);
  }
  if (spec.review.length) {
    lines.push('');
    lines.push(`  review needed: ${spec.review.join(', ')}`);
  }
  if (notes.length) {
    lines.push('');
    for (const n of notes) lines.push(`  note  ${n}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function runOne(
  name: string,
  brief: string,
  args: Args,
): Promise<{ spec: DesignSpec; html: string; file: string }> {
  const result = await runPipeline({
    brief,
    decider: args.decider,
    noCopy: args.noCopy,
    images: {
      enabled: args.images,
      count: args.imageCount,
      preset: args.imagePreset,
      ...(args.imageSteps !== undefined ? { steps: args.imageSteps } : {}),
      ...(args.imageCfg !== undefined ? { cfg: args.imageCfg } : {}),
      ...(args.imageSeed !== undefined ? { seed: args.imageSeed } : {}),
    },
    outDir: args.out,
    slug: slugify(name),
    onProgress: (e) => {
      if (!args.quiet && e.phase === 'images') console.log(`  img  ${e.message}`);
    },
  });

  if (!args.quiet) console.log(summarize(result.spec, result.notes));
  if (args.json) console.log(JSON.stringify(result.spec, null, 2));

  return { spec: result.spec, html: result.html, file: result.files.html };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.briefs) {
    const raw = JSON.parse(await readFile(args.briefs, 'utf8')) as { name: string; brief: string }[];
    console.log(`\nturboslop — batch of ${raw.length}\n`);
    const t0 = Date.now();
    let totalUsd = 0;
    for (const item of raw) {
      const r = await runOne(item.name, item.brief, { ...args, quiet: true });
      totalUsd += r.spec.meta.estimatedUsd;
      console.log(
        `  ${item.name.padEnd(24)} ${r.spec.meta.decider.padEnd(6)} ${String(r.spec.meta.latencyMs).padStart(5)}ms  -> ${r.file}`,
      );
    }
    const elapsed = Date.now() - t0;
    console.log(
      `\n  ${raw.length} directions in ${elapsed} ms  (~${Math.round(elapsed / raw.length)} ms each), ~$${totalUsd.toFixed(6)} total\n`,
    );
    return;
  }

  if (!args.brief) {
    printHelp();
    process.exit(1);
  }
  await mkdir(args.out, { recursive: true });
  await runOne(args.brief, args.brief, args);
}

main().catch((err) => {
  console.error(`\n  turboslop failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
