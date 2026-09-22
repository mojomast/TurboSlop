#!/usr/bin/env node
/**
 * TurboSlop — capture the contact sheet.
 *
 * Drives the real control surface in a browser (typing a brief, setting a seed,
 * pressing "Generate directions") and screenshots what a person would see: the
 * sheet at desktop and mobile widths, plus each direction's own preview.
 *
 * Assumes the server is already running:
 *   FORGE_OUT_DIR=... npm run serve
 *
 * Usage: npx tsx scripts/sheet-shot.ts --url http://127.0.0.1:4477 --out shots/sheet
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PW_PATH = process.env.FORGE_PLAYWRIGHT ?? '/tmp/opencode/node_modules/playwright-core/index.js';
const CHROME = process.env.FORGE_CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;

interface Args {
  url: string;
  out: string;
  brief: string;
  seed: number;
  count: number;
  explore: number;
}

function parse(argv: string[]): Args {
  const a: Args = {
    url: 'http://127.0.0.1:4477',
    out: 'after/shots/sheet',
    brief: 'A three-day independent games festival in Rotterdam. Talks, a tournament, and a late-night arcade.',
    seed: 4242,
    count: 6,
    explore: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i] ?? a.url;
    else if (k === '--out') a.out = argv[++i] ?? a.out;
    else if (k === '--brief') a.brief = argv[++i] ?? a.brief;
    else if (k === '--seed') a.seed = Number(argv[++i] ?? a.seed);
    else if (k === '--count') a.count = Number(argv[++i] ?? a.count);
    else if (k === '--explore') a.explore = Number(argv[++i] ?? a.explore);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });

  const pw = (await import(PW_PATH)) as { chromium?: any; default?: { chromium?: any } };
  const chromium = pw.chromium ?? pw.default?.chromium;
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---- 1. drive the control surface ---------------------------------- */
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
  await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
  await page.goto(`${args.url}/`, { waitUntil: 'load' });

  await page.fill('#brief', args.brief);
  await page.fill('#dir-seed', String(args.seed));
  await page.fill('#dir-count', String(args.count));
  await page.evaluate((v: string) => {
    const el = document.querySelector('#dir-explore') as HTMLInputElement | null;
    if (el) el.value = v;
  }, String(args.explore));

  await page.click('#directions');
  // The set takes one decision call plus one writer call; wait for the cards.
  await page.waitForSelector('.sheet__grid .dir', { timeout: 180_000 });
  // Let every preview iframe finish loading before the screenshot.
  await page.waitForFunction(
    () => {
      const frames = [...document.querySelectorAll<HTMLIFrameElement>('.dir__preview iframe')];
      return frames.length > 0 && frames.every((f) => f.contentDocument?.readyState === 'complete');
    },
    { timeout: 60_000 },
  );
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await new Promise((r) => setTimeout(r, 700));

  await page.screenshot({ path: path.join(args.out, 'contact-sheet-desktop.png') });
  await page.setViewportSize({ width: 860, height: 1100 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(args.out, 'contact-sheet-narrow.png') });

  // Mobile preview width for the same sheet.
  await page.click('[data-vp="mobile"]');
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(args.out, 'contact-sheet-mobile.png') });

  // The sheet's own numbers, so the doc quotes measurements rather than vibes.
  const summary = await page.evaluate(() => {
    const label = (document.querySelector('#sheet-label') as HTMLElement | null)?.textContent ?? '';
    const metrics = [...document.querySelectorAll('#sheet-metrics .metric')].map((m) => ({
      k: (m.querySelector('.metric__k') as HTMLElement | null)?.textContent ?? '',
      v: (m.querySelector('.metric__v') as HTMLElement | null)?.textContent ?? '',
      sub: (m.querySelector('.metric__sub') as HTMLElement | null)?.textContent ?? '',
    }));
    const cards = [...document.querySelectorAll('.dir')].map((c) => ({
      head: (c.querySelector('.eyebrow') as HTMLElement | null)?.textContent ?? '',
      title: (c.querySelector('h3') as HTMLElement | null)?.textContent ?? '',
      hint: (c.querySelector('.hint') as HTMLElement | null)?.textContent ?? '',
      blocks: [...c.querySelectorAll('.dir__struct span')].map((s) => s.textContent ?? ''),
      iframe: (c.querySelector('iframe') as HTMLIFrameElement | null)?.getAttribute('src') ?? '',
    }));
    return { label, metrics, cards };
  });
  await writeFile(path.join(args.out, 'sheet.json'), JSON.stringify(summary, null, 1), 'utf8');
  await page.close();

  /* ---- 2. each direction's own preview, desktop and mobile ----------- */
  const sid = summary.cards[0]?.iframe?.split('/')[2] ?? '';
  if (sid) {
    for (const [i, card] of summary.cards.entries()) {
      for (const [label, vp] of [
        ['desktop', { width: 1440, height: 900 }],
        ['mobile', { width: 390, height: 844 }],
      ] as const) {
        const p = await browser.newPage({ viewport: vp, deviceScaleFactor: label === 'mobile' ? 2 : 1 });
        await p.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
        await p.emulateMedia({ reducedMotion: 'reduce' });
        await p.goto(`${args.url}/preview/${sid}/${i}`, { waitUntil: 'load' });
        await p.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
        await p.screenshot({ path: path.join(args.out, `dir-${i + 1}-${label}.png`) });
        if (label === 'desktop') {
          await p.screenshot({ path: path.join(args.out, `dir-${i + 1}-full.png`), fullPage: true });
        }
        await p.close();
      }
    }
  }

  await browser.close();

  console.log(`\n  session ${sid}`);
  console.log(`  ${summary.label}`);
  for (const m of summary.metrics) console.log(`    ${m.k.padEnd(13)} ${m.v.padEnd(10)} ${m.sub}`);
  console.log('');
  for (const c of summary.cards) {
    console.log(`    ${c.head.padEnd(34)} ${c.title}`);
    console.log(`      ${c.hint}`);
    console.log(`      ${c.blocks.join(' > ')}`);
  }
  console.log(`\n  screenshots in ${args.out}\n`);
}

main().catch((err) => {
  console.error(`sheet-shot failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
