#!/usr/bin/env node
/**
 * turboslop — curation harness
 *
 * Reads the design variations and produces a technique inventory, then diffs it
 * against what the layout engine already emits. Two questions it answers:
 *
 *   1. Which techniques did the variations actually use? (evidence, not vibes)
 *   2. Which of those does the engine NOT yet emit? → candidate additions
 *
 * Read-only by design: it never writes into variations/. Run:
 *   npx tsx scripts/curate.ts [variationsDir] [--json]
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { INTEROP_2026_FEATURES, MODERN_CSS_FEATURES } from '../src/layout.js';

/* ------------------------------------------------------------------ *
 * The technique probes. Each is a claim about what the variation does,
 * with a regex that can only match if the claim is true.
 * ------------------------------------------------------------------ */
interface Probe {
  id: string;
  label: string;
  re: RegExp;
  /** Grouped for reporting. */
  group: 'css-modern' | 'css-core' | 'motion' | 'a11y' | 'js' | 'craft';
  /** Does the layout engine already emit this? */
  inEngine: boolean;
}

const PROBES: Probe[] = [
  // ---- modern CSS ----
  { id: 'layer', label: '@layer cascade layers', re: /@layer\b/g, group: 'css-modern', inEngine: true },
  { id: 'container', label: '@container queries', re: /@container\b/g, group: 'css-modern', inEngine: true },
  { id: 'scroll-driven', label: 'Scroll-driven animations', re: /animation-timeline\s*:/g, group: 'css-modern', inEngine: true },
  { id: 'view-transition', label: 'View transitions', re: /view-transition|@view-transition/g, group: 'css-modern', inEngine: false },
  { id: 'anchor-pos', label: 'Anchor positioning', re: /anchor-name|position-anchor|anchor\(/g, group: 'css-modern', inEngine: true },
  { id: 'position-try', label: '@position-try fallbacks', re: /@position-try|position-try-fallbacks/g, group: 'css-modern', inEngine: true },
  { id: 'starting-style', label: '@starting-style', re: /@starting-style/g, group: 'css-modern', inEngine: true },
  { id: 'allow-discrete', label: 'allow-discrete transitions', re: /allow-discrete/g, group: 'css-modern', inEngine: true },
  { id: 'popover', label: 'popover / dialog', re: /popover|popovertarget|<dialog/g, group: 'css-modern', inEngine: true },
  { id: 'subgrid', label: 'subgrid', re: /subgrid/g, group: 'css-modern', inEngine: true },
  { id: 'oks', label: 'oklch() / relative colour', re: /oklch\(|from\s+#|light-dark\(/g, group: 'css-modern', inEngine: true },
  { id: 'color-mix', label: 'color-mix()', re: /color-mix\(/g, group: 'css-modern', inEngine: false },
  { id: 'contrast-color', label: 'contrast-color()', re: /contrast-color\(/g, group: 'css-modern', inEngine: true },
  { id: 'sibling-fn', label: 'sibling-index() / sibling-count()', re: /sibling-index\(|sibling-count\(/g, group: 'css-modern', inEngine: true },
  { id: 'scroll-state', label: 'scroll-state() queries', re: /scroll-state\(/g, group: 'css-modern', inEngine: true },
  { id: 'carousel', label: '::scroll-button / ::scroll-marker', re: /::scroll-button|::scroll-marker|scroll-marker-group/g, group: 'css-modern', inEngine: true },
  { id: 'base-select', label: 'appearance: base-select', re: /appearance:\s*base-select|::picker\(/g, group: 'css-modern', inEngine: true },
  { id: 'corner-shape', label: 'corner-shape', re: /corner-shape/g, group: 'css-modern', inEngine: true },
  { id: 'shape-fn', label: 'shape() clip paths', re: /clip-path:\s*shape\(|shape\(\s*from/g, group: 'css-modern', inEngine: true },
  { id: 'cvas', label: 'content-visibility / container units', re: /content-visibility|cqw|cqi|cqmin|cqmax/g, group: 'css-modern', inEngine: true },
  { id: 'field-sizing', label: 'field-sizing', re: /field-sizing/g, group: 'css-modern', inEngine: true },
  { id: 'text-box', label: 'text-box-trim', re: /text-box-trim|text-box-edge/g, group: 'css-modern', inEngine: true },
  { id: 'reading-flow', label: 'reading-flow', re: /reading-flow|reading-order/g, group: 'css-modern', inEngine: true },
  { id: 'attr-typed', label: 'attr() with type()', re: /attr\([^)]*type\(/g, group: 'css-modern', inEngine: false },
  { id: 'scroll-snap', label: 'scroll-snap', re: /scroll-snap-type|scroll-snap-align/g, group: 'css-modern', inEngine: true },
  { id: 'function-rule', label: '@function', re: /@function\b/g, group: 'css-modern', inEngine: true },
  { id: 'if-fn', label: 'if() inline conditionals', re: /:\s*if\(|,\s*if\(/g, group: 'css-modern', inEngine: false },
  { id: 'scope', label: '@scope', re: /@scope\b/g, group: 'css-modern', inEngine: false },

  // ---- core CSS craft ----
  { id: 'has', label: ':has()', re: /:has\(/g, group: 'css-core', inEngine: true },
  { id: 'clamp', label: 'clamp() fluid type', re: /clamp\(/g, group: 'css-core', inEngine: true },
  { id: 'custom-props', label: 'Custom properties', re: /--[a-z][\w-]*\s*:/g, group: 'css-core', inEngine: true },
  { id: 'grid', label: 'CSS grid', re: /display:\s*grid/g, group: 'css-core', inEngine: true },
  { id: 'minmax-zero', label: 'minmax(0,1fr) overflow safety', re: /minmax\(0\s*,\s*1fr\)/g, group: 'css-core', inEngine: true },
  { id: 'auto-fit-min', label: 'auto-fit min() responsive cells', re: /auto-fit[^;]*min\(/g, group: 'css-core', inEngine: true },
  { id: 'text-wrap', label: 'text-wrap: balance/pretty', re: /text-wrap\s*:/g, group: 'css-core', inEngine: true },
  { id: 'overflow-clip', label: 'overflow-x: clip guard', re: /overflow(-x)?:\s*clip/g, group: 'css-core', inEngine: true },
  { id: 'aspect', label: 'aspect-ratio', re: /aspect-ratio\s*:/g, group: 'css-core', inEngine: false },
  { id: 'mask', label: 'mask / mask-image', re: /mask(-image|-composite)?\s*:/g, group: 'css-core', inEngine: false },
  { id: 'conic', label: 'conic-gradient', re: /conic-gradient\(/g, group: 'css-core', inEngine: false },
  { id: 'radial', label: 'radial-gradient', re: /radial-gradient\(/g, group: 'css-core', inEngine: false },
  { id: 'backdrop', label: 'backdrop-filter', re: /backdrop-filter/g, group: 'css-core', inEngine: true },
  { id: 'sticky', label: 'position: sticky', re: /position:\s*sticky/g, group: 'css-core', inEngine: true },
  { id: 'tabular', label: 'tabular-nums', re: /tabular-nums/g, group: 'css-core', inEngine: true },
  { id: 'counter', label: 'CSS counters', re: /counter\(|counter-reset|counter-increment/g, group: 'css-core', inEngine: true },
  { id: 'svh', label: 'svh/dvh units', re: /\d+(svh|dvh|dvw|cqw)/g, group: 'css-core', inEngine: false },
  { id: 'scroll-gutter', label: 'scrollbar-gutter', re: /scrollbar-gutter/g, group: 'css-core', inEngine: true },

  // ---- motion ----
  { id: 'keyframes', label: '@keyframes', re: /@keyframes/g, group: 'motion', inEngine: true },
  { id: 'steps', label: 'steps() timing', re: /steps\(/g, group: 'motion', inEngine: false },
  { id: 'cubic', label: 'Custom cubic-bezier', re: /cubic-bezier\(/g, group: 'motion', inEngine: true },
  { id: 'spring', label: 'Overshoot / spring easing', re: /cubic-bezier\(0?\.\d+,\s*1\.[456]/g, group: 'motion', inEngine: false },
  { id: 'grain', label: 'SVG grain / feTurbulence', re: /feTurbulence|fractalNoise/g, group: 'motion', inEngine: false },
  { id: 'scramble', label: 'Text scramble / decode', re: /scramble|decode|\[data-scramble\]/gi, group: 'motion', inEngine: false },

  // ---- accessibility ----
  { id: 'reduced-motion', label: 'prefers-reduced-motion', re: /prefers-reduced-motion/g, group: 'a11y', inEngine: true },
  { id: 'prefers-contrast', label: 'prefers-contrast', re: /prefers-contrast/g, group: 'a11y', inEngine: false },
  { id: 'forced-colors', label: 'forced-colors', re: /forced-colors/g, group: 'a11y', inEngine: false },
  { id: 'print', label: 'print stylesheet', re: /@media\s+print/g, group: 'a11y', inEngine: false },
  { id: 'aria-expanded', label: 'aria-expanded/controls', re: /aria-expanded|aria-controls/g, group: 'a11y', inEngine: false },
  { id: 'aria-live', label: 'aria-live regions', re: /aria-live/g, group: 'a11y', inEngine: false },
  { id: 'focus-visible', label: ':focus-visible', re: /:focus-visible/g, group: 'a11y', inEngine: true },
  { id: 'skip-link', label: 'skip link', re: /skip[- ]link/g, group: 'a11y', inEngine: false },

  // ---- js ----
  { id: 'io', label: 'IntersectionObserver', re: /IntersectionObserver/g, group: 'js', inEngine: false },
  { id: 'raf', label: 'requestAnimationFrame', re: /requestAnimationFrame/g, group: 'js', inEngine: false },
  { id: 'clipboard', label: 'Clipboard API', re: /navigator\.clipboard/g, group: 'js', inEngine: false },
  { id: 'intl', label: 'Intl.DateTimeFormat', re: /Intl\.DateTimeFormat/g, group: 'js', inEngine: false },
  { id: 'matchmedia', label: 'matchMedia guards', re: /matchMedia\(/g, group: 'js', inEngine: false },

  // ---- craft ----
  { id: 'inline-svg', label: 'Inline SVG artwork', re: /<svg\b/g, group: 'craft', inEngine: false },
  { id: 'grain-tex', label: 'Texture / grain layer', re: /grain|noise|letterpress/gi, group: 'craft', inEngine: false },
  { id: 'hand-drawn', label: 'Hand-drawn marks', re: /stroke-dashoffset|pathLength/g, group: 'craft', inEngine: false },
];

export interface VariationReport {
  file: string;
  id: string;
  emotion: string;
  bytes: number;
  complete: boolean;
  sections: number;
  h1: number;
  /** probe id -> match count */
  hits: Record<string, number>;
  customProps: number;
  keyframes: number;
  fonts: string[];
  palette: Record<string, string>;
}

export function analyse(file: string, html: string): VariationReport {
  const hits: Record<string, number> = {};
  for (const p of PROBES) {
    const m = html.match(p.re);
    if (m && m.length) hits[p.id] = m.length;
  }

  const idm = /data-variation="([^"]+)"/.exec(html);
  const emo = /<meta\s+name="emotion"\s+content="([^"]+)"/i.exec(html)
    ?? /content="([^"]+)"\s+name="emotion"/i.exec(html);

  const fonts = [
    ...new Set(
      [...html.matchAll(/font-family:\s*([^;}"']+)/g)]
        .map((m) => m[1]!.trim().split(',')[0]!.replace(/['"]/g, '').trim())
        .filter((f) => f && !f.startsWith('var(') && f.length < 40),
    ),
  ].slice(0, 8);

  const palette: Record<string, string> = {};
  for (const m of html.matchAll(/(--[\w-]*(?:bg|fg|ink|accent|ground|paper|surface)[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    if (Object.keys(palette).length < 10) palette[m[1]!] = m[2]!;
  }

  return {
    file: path.basename(file),
    id: idm?.[1] ?? '?',
    emotion: emo?.[1] ?? '?',
    bytes: html.length,
    complete: /<\/html>\s*$/i.test(html),
    sections: (html.match(/<section\b/g) ?? []).length,
    h1: (html.match(/<h1\b/g) ?? []).length,
    hits,
    customProps: new Set((html.match(/--[a-z][\w-]*\s*:/g) ?? [])).size,
    keyframes: (html.match(/@keyframes\s+([\w-]+)/g) ?? []).length,
    fonts,
    palette,
  };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '../variations');
  const asJson = args.includes('--json');

  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.html')).sort();
  } catch {
    console.error(`curate: cannot read ${dir}`);
    process.exit(1);
  }

  const reports: VariationReport[] = [];
  for (const f of files) {
    const html = await readFile(path.join(dir, f), 'utf8');
    reports.push(analyse(f, html));
  }

  const complete = reports.filter((r) => r.complete);
  const probeById = Object.fromEntries(PROBES.map((p) => [p.id, p]));

  // Which techniques appear in at least one complete variation?
  const used = new Set<string>();
  for (const r of complete) for (const id of Object.keys(r.hits)) used.add(id);

  const groups = ['css-modern', 'css-core', 'motion', 'a11y', 'js', 'craft'] as const;

  const lines: string[] = [];
  lines.push('# Variation curation report');
  lines.push('');
  lines.push(`Source: \`${dir}\``);
  lines.push(`Variations analysed: **${complete.length}** of ${reports.length}${reports.length !== complete.length ? ' (some still being written)' : ''}`);
  lines.push('');
  lines.push('## Per-variation summary');
  lines.push('');
  lines.push('| # | emotion | sections | h1 | custom props | keyframes | CSS bytes |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of complete) {
    lines.push(`| ${r.id} | ${r.emotion} | ${r.sections} | ${r.h1} | ${r.customProps} | ${r.keyframes} | ${(r.bytes / 1024).toFixed(0)}k |`);
  }
  lines.push('');
  lines.push('## Technique coverage');
  lines.push('');
  for (const g of groups) {
    const inGroup = PROBES.filter((p) => p.group === g);
    const rows = inGroup.map((p) => {
      const count = complete.filter((r) => r.hits[p.id]).length;
      return { p, count };
    }).sort((a, b) => b.count - a.count);
    lines.push(`### ${g}`);
    lines.push('');
    lines.push('| technique | variations using it | in engine? |');
    lines.push('|---|---|---|');
    for (const { p, count } of rows) {
      const bar = count ? `${count}/${complete.length}` : '—';
      lines.push(`| ${p.label} | ${bar} | ${p.inEngine ? 'yes' : '**no**'} |`);
    }
    lines.push('');
  }

  // The actionable output: techniques the variations prove are worth having
  // that the engine does not yet emit.
  const gaps = PROBES.filter((p) => used.has(p.id) && !p.inEngine);
  lines.push('## Curation targets — proven useful, missing from the engine');
  lines.push('');
  if (!gaps.length) {
    lines.push('None: the engine already covers every technique the variations used.');
  } else {
    for (const g of groups) {
      const inGroup = gaps.filter((p) => p.group === g);
      if (!inGroup.length) continue;
      lines.push(`**${g}**`);
      for (const p of inGroup) {
        const count = complete.filter((r) => r.hits[p.id]).length;
        lines.push(`- ${p.label} — used by ${count}/${complete.length} (${(p.re.source).slice(0, 46)}…)`);
      }
      lines.push('');
    }
  }

  lines.push('## Engine inventory (for reference)');
  lines.push('');
  lines.push(`- Interop 2026 features declared: ${INTEROP_2026_FEATURES.length}`);
  lines.push(`- Additional modern CSS declared: ${MODERN_CSS_FEATURES.length}`);
  lines.push('');

  const report = lines.join('\n');
  await mkdir(path.join(path.dirname(dir), 'curation'), { recursive: true });
  const outDir = path.join(path.dirname(dir), 'curation');
  await writeFile(path.join(outDir, 'REPORT.md'), report, 'utf8');
  await writeFile(
    path.join(outDir, 'techniques.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), probes: PROBES.map(({ re, ...p }) => p), reports }, null, 2),
    'utf8',
  );

  if (asJson) console.log(JSON.stringify({ reports, gaps: gaps.map((g) => g.id) }, null, 2));
  else console.log(report);

  console.log(`\nwrote ${path.join(outDir, 'REPORT.md')} and techniques.json`);
}

main().catch((e) => {
  console.error('curate failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
