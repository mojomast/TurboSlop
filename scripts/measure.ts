#!/usr/bin/env node
/**
 * TurboSlop — rendered-geometry measurement.
 *
 * Fingerprints and class names are not evidence. This loads a generated page in
 * a real browser and measures what a person actually sees:
 *
 *   - the document's real width at desktop and mobile, and any horizontal overflow
 *   - first-screen geometry: which blocks share the opening viewport, the h1's
 *     rendered size and line count, and how much of the first screen each takes
 *   - every section's measured height and position
 *   - image placement, intrinsic size, and whether an asset was enlarged past
 *     its native resolution
 *   - id uniqueness, and whether every in-page anchor resolves
 *
 * Usage:
 *   npx tsx scripts/measure.ts out/*.html
 *   npx tsx scripts/measure.ts --dir out --out measurements.json --shots shots/
 *   npx tsx scripts/measure.ts page.html --json
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PW_PATH = process.env.FORGE_PLAYWRIGHT ?? '/tmp/opencode/node_modules/playwright-core/index.js';
const CHROME_PATH =
  process.env.FORGE_CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

interface Cli {
  targets: string[];
  dir?: string;
  out?: string;
  shots?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { targets: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') cli.dir = argv[++i];
    else if (a === '--out') cli.out = argv[++i];
    else if (a === '--shots') cli.shots = argv[++i];
    else if (a === '--json') cli.json = true;
    else if (a && !a.startsWith('--')) cli.targets.push(a);
  }
  return cli;
}

/* ------------------------------------------------------------------ *
 * In-page measurement. Everything here runs INSIDE the browser, so it
 * must be self-contained — no imports, no closures over Node values.
 * ------------------------------------------------------------------ */

function measureInPage(viewportHeight: number) {
  /** Classify an element into a coarse "block type" a human would recognise. */
  const classify = (el: Element): string => {
    const cls = `${el.className ?? ''}`.toLowerCase();
    const tag = el.tagName.toLowerCase();
    const has = (...names: string[]) => names.some((n) => cls.includes(n));
    if (tag === 'h1') return 'h1';
    if (tag === 'h2') return 'h2';
    if (tag === 'h3') return 'h3';
    if (has('eyebrow')) return 'eyebrow';
    if (has('lede')) return 'lede';
    if (tag === 'button' || has('btn')) return 'button';
    if (tag === 'img' || has('plate', 'tile__plate', 'hero-art', 'hero-media__plate')) return 'image';
    if (tag === 'figure') return 'figure';
    if (has('stat')) return 'stat';
    if (has('dateline')) return 'dateline';
    if (tag === 'table') return 'table';
    if (tag === 'form') return 'form';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'field';
    if (has('quote')) return 'quote';
    if (has('tier')) return 'tier';
    if (has('agenda', 'steps', 'editorial-list', 'frows')) return 'list';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (has('card', 'tile', 'work-card', 'frow', 'erow')) return 'card';
    if (tag === 'section') return 'section';
    if (tag === 'header') return 'masthead';
    if (tag === 'footer') return 'footer';
    if (tag === 'main') return 'main';
    return '';
  };

  const doc = document.documentElement;
  const body = document.body;

  /* --- ids + anchors ------------------------------------------------- */
  const allIds = [...document.querySelectorAll('[id]')].map((e) => e.id);
  const idCounts = new Map<string, number>();
  for (const id of allIds) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const duplicateIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const anchors = [...document.querySelectorAll('a[href^="#"]')].map(
    (a) => (a.getAttribute('href') ?? '').slice(1),
  );
  const idSet = new Set(allIds);
  const brokenAnchors = [...new Set(anchors.filter((a) => a && a !== '' && !idSet.has(a)))];

  /* --- first screen -------------------------------------------------- */
  const firstScreen = new Set<string>();
  const inFirstScreen: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.top < viewportHeight && r.bottom > 0) {
      const kind = classify(el);
      if (!kind) continue;
      if (!firstScreen.has(kind)) {
        firstScreen.add(kind);
        inFirstScreen.push(kind);
      }
    }
  }

  const h1 = document.querySelector('h1');
  let h1FontSizePx = 0;
  let h1Lines = 0;
  let h1TextLength = 0;
  if (h1) {
    h1FontSizePx = Number.parseFloat(getComputedStyle(h1).fontSize);
    h1TextLength = (h1.textContent ?? '').trim().length;
    const range = document.createRange();
    range.selectNodeContents(h1);
    const tops = new Set<number>();
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) tops.add(Math.round(rect.top));
    }
    h1Lines = tops.size;
  }

  /* --- what else is in the first screen, with areas ------------------ */
  const firstScreenArea = (() => {
    const el = document.querySelector('.hero, section:first-of-type');
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.round(r.height);
  })();

  /* --- sections ------------------------------------------------------ */
  const sections = [...document.querySelectorAll('section[id]')].map((s) => {
    const r = s.getBoundingClientRect();
    return {
      id: s.id,
      block: s.getAttribute('data-block') ?? '',
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height),
    };
  });

  /* --- images -------------------------------------------------------- */
  const images = [...document.querySelectorAll('img')].map((img) => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    const rendered = Math.round(r.width);
    return {
      src: img.getAttribute('src') ?? '',
      alt: img.getAttribute('alt') ?? '',
      naturalWidth: nw,
      naturalHeight: nh,
      renderedWidth: rendered,
      renderedHeight: Math.round(r.height),
      /* A 256px asset blown up to fill a hero is the failure this flags. */
      upscaleFactor: nw > 0 ? Number((rendered / nw).toFixed(2)) : 0,
      inFirstScreen: r.top < viewportHeight && r.bottom > 0,
    };
  });

  /* --- nav ----------------------------------------------------------- */
  const header = document.querySelector('header');
  const navLinks = header ? [...header.querySelectorAll('a')].map((a) => (a.textContent ?? '').trim()) : [];
  const headerStyle = header ? getComputedStyle(header) : null;

  /* --- overflow ------------------------------------------------------ */
  const scrollWidth = doc.scrollWidth;
  const clientWidth = doc.clientWidth;
  // scrollWidth > clientWidth does not prove the page scrolls; let us scroll.
  const before = window.scrollX;
  window.scrollTo(9999, 0);
  const scrolledTo = window.scrollX;
  window.scrollTo(before, window.scrollY);

  return {
    viewport: { width: window.innerWidth, height: viewportHeight },
    scrollWidth,
    clientWidth,
    overflowsHorizontally: scrollWidth > clientWidth + 1,
    maxScrollX: scrolledTo,
    bodyOverflowX: getComputedStyle(body).overflowX,
    htmlOverflowX: getComputedStyle(doc).overflowX,
    idCount: allIds.length,
    duplicateIds,
    brokenAnchors,
    firstScreenBlocks: inFirstScreen,
    h1FontSizePx,
    h1Lines,
    h1TextLength,
    heroHeight: firstScreenArea,
    sections,
    sectionOrder: sections.map((s) => s.id),
    sectionBlocks: sections.map((s) => s.block),
    images,
    imageCount: images.length,
    nav: {
      position: headerStyle?.position ?? 'none',
      sticky: (headerStyle?.position ?? '') === 'sticky' || (headerStyle?.position ?? '') === 'fixed',
      linkCount: navLinks.length,
      links: navLinks.slice(0, 8),
    },
    headingOrder: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName.toLowerCase()),
  };
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  let targets = cli.targets;
  if (cli.dir) {
    const entries = await readdir(cli.dir);
    targets = entries
      .filter((f) => f.endsWith('.html') && !f.includes('selfcontained'))
      .map((f) => path.join(cli.dir!, f));
  }
  if (!targets.length) {
    console.error('usage: tsx scripts/measure.ts <page.html ...> | --dir <out> [--out json] [--shots dir]');
    process.exit(1);
  }
  targets.sort();

  const pw = (await import(PW_PATH)) as { chromium?: unknown; default?: { chromium?: unknown } };
  interface AnyPage {
    addInitScript: (o: { content: string }) => Promise<void>;
    goto: (u: string, o?: { waitUntil?: string }) => Promise<unknown>;
    emulateMedia: (o: { reducedMotion?: string }) => Promise<void>;
    evaluate: (fn: unknown, arg?: unknown) => Promise<unknown>;
    screenshot: (o: { path: string; fullPage?: boolean }) => Promise<unknown>;
    close: () => Promise<void>;
  }
  const chromium = (pw.chromium ?? pw.default?.chromium) as {
    launch: (o: { executablePath?: string; args?: string[] }) => Promise<{
      newPage: (o: { viewport: { width: number; height: number }; deviceScaleFactor: number }) => Promise<AnyPage>;
      close: () => Promise<void>;
    }>;
  };
  if (!chromium) throw new Error(`could not load playwright-core from ${PW_PATH}`);

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const results: Record<string, unknown>[] = [];
  if (cli.shots) await mkdir(cli.shots, { recursive: true });

  for (const file of targets) {
    const slug = path.basename(file, '.html');
    const url = `file://${path.resolve(file)}`;
    const entry: Record<string, unknown> = { slug, file: path.resolve(file) };

    for (const [label, vp] of [
      ['desktop', DESKTOP],
      ['mobile', MOBILE],
    ] as const) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: label === 'mobile' ? 2 : 1 });
      // tsx/esbuild injects `__name` for named function expressions. The page
      // needs the shim before any of our evaluated code runs.
      await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url, { waitUntil: 'load' });
      // Let fonts settle so type metrics are the real ones.
      await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
      const m = await page.evaluate(measureInPage as unknown as (v: number) => unknown, vp.height);
      entry[label] = m;

      if (cli.shots) {
        await page.screenshot({ path: path.join(cli.shots, `${slug}-${label}.png`) });
        if (label === 'desktop') {
          await page.screenshot({ path: path.join(cli.shots, `${slug}-full.png`), fullPage: true });
        }
      }
      await page.close();
    }
    results.push(entry);
    console.log(`  measured ${slug}`);
  }

  await browser.close();

  const payload = { generatedAt: new Date().toISOString(), viewports: { DESKTOP, MOBILE }, pages: results };
  if (cli.out) {
    await writeFile(cli.out, JSON.stringify(payload, null, 1), 'utf8');
    console.log(`\n  wrote ${cli.out}`);
  }

  if (cli.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printTable(results);
  }
}

function printTable(results: Record<string, unknown>[]): void {
  console.log('\n  OVERFLOW & IDENTITY (desktop 1440 / mobile 390)');
  console.log(
    `  ${'slug'.padEnd(30)} ${'docW'.padStart(6)} ${'over'.padStart(5)} ${'docW'.padStart(6)} ${'over'.padStart(5)} ${'dupIds'.padStart(7)} ${'broken'.padStart(7)}`,
  );
  for (const r of results) {
    const d = r.desktop as Record<string, unknown>;
    const m = r.mobile as Record<string, unknown>;
    console.log(
      `  ${String(r.slug).slice(0, 30).padEnd(30)} ${String(d.scrollWidth).padStart(6)} ` +
        `${(d.overflowsHorizontally ? 'YES' : '-').padStart(5)} ${String(m.scrollWidth).padStart(6)} ` +
        `${(m.overflowsHorizontally ? 'YES' : '-').padStart(5)} ` +
        `${String((d.duplicateIds as string[]).length).padStart(7)} ` +
        `${String((d.brokenAnchors as string[]).length).padStart(7)}`,
    );
  }

  console.log('\n  FIRST SCREEN');
  for (const r of results) {
    const d = r.desktop as Record<string, unknown>;
    console.log(
      `  ${String(r.slug).slice(0, 30).padEnd(30)} hero ${String(d.heroHeight).padStart(5)}px  ` +
        `h1 ${String(d.h1FontSizePx).padStart(6)}px / ${String(d.h1Lines).padStart(2)} lines  ` +
        `imgs ${String(d.imageCount).padStart(2)}  ` +
        `nav ${String((d.nav as Record<string, unknown>).position).padEnd(7)}  ` +
        `| ${(d.firstScreenBlocks as string[]).join(',')}`,
    );
  }

  console.log('\n  SECTION ORDER');
  for (const r of results) {
    const d = r.desktop as Record<string, unknown>;
    console.log(`  ${String(r.slug).slice(0, 30).padEnd(30)} ${(d.sectionOrder as string[]).join(' > ')}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n  measure failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
