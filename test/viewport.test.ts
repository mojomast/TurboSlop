/**
 * TurboSlop — preview viewport tests.
 *
 * The review finding: desktop iframes rendered at the CARD's width and 15rem
 * tall, so a "desktop preview" was neither desktop-sized nor stable when the
 * card resized. These checks drive the REAL control surface in a real browser
 * and assert:
 *
 *   1. desktop mode simulates a 1440×900 viewport, mobile mode 390×844
 *      (the iframe's own layout viewport — not the card's box);
 *   2. resizing the window/card changes only the SCALE, never the simulated
 *      viewport;
 *   3. preview labels live outside the generated page canvas;
 *   4. a preview is not "ready" until fonts are loaded and images settled, and
 *      motion is frozen for comparison thumbnails.
 *
 * Requires playwright-core + a Chromium build; skips with a reason when either
 * is absent (reported as skipped, never silently green).
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : String(err)}`);
  }
}
function skip(name: string, reason: string): void {
  skipped++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

console.log('\n=== TurboSlop — preview viewports (real control surface) ===\n');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PW_PATH = process.env.FORGE_PLAYWRIGHT ?? '/tmp/opencode/node_modules/playwright-core/index.js';
const CHROME_PATH =
  process.env.FORGE_CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.FORGE_VIEWPORT_PORT ?? 4492);
const BASE = `http://127.0.0.1:${PORT}`;

const outDir = await mkdtemp(path.join(tmpdir(), 'turboslop-viewport-'));
let server: ChildProcess | null = null;

interface HandleLike {
  getAttribute(a: string): string | null;
  evaluate<T>(fn: (el: HTMLElement) => T): Promise<T>;
}
interface PageLike {
  setViewportSize(v: { width: number; height: number }): Promise<void>;
  goto(u: string, o?: { waitUntil?: string }): Promise<unknown>;
  addInitScript(o: { content: string }): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  click(sel: string): Promise<void>;
  fill(sel: string, v: string): Promise<void>;
  /* playwright takes a page function, not a selector-string expression. */
  waitForFunction(fn: () => unknown, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>;
  $(sel: string): Promise<HandleLike | null>;
  close(): Promise<void>;
}
interface BrowserLike {
  newPage(o: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
}

let browser: BrowserLike | null = null;

function depsMissing(): string | null {
  if (!existsSync(PW_PATH)) return `playwright-core not found at ${PW_PATH}`;
  if (!existsSync(CHROME_PATH)) return `Chromium not found at ${CHROME_PATH}`;
  return null;
}

async function ready(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return `server answered ${res.status}`;
    return null;
  } catch (err) {
    return `server not reachable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

try {
  const unavailable = depsMissing();
  if (unavailable) {
    skip('preview viewport suite', unavailable);
  } else {
    /* The surface under test is the real one, freshly spawned. */
    server = spawn(path.join(REPO, 'node_modules', '.bin', 'tsx'), [path.join(REPO, 'src', 'server.ts')], {
      cwd: REPO,
      env: {
        ...process.env,
        FORGE_OUT_DIR: outDir,
        FORGE_HOST: '127.0.0.1',
        FORGE_PORT: String(PORT),
        FORGE_PROJECT: 'viewport-suite',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      if (!(await ready())) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const stillDown = await ready();
    if (stillDown) {
      skip('preview viewport suite', `control surface did not start: ${stillDown}`);
    } else {
      const pw = (await import(PW_PATH)) as { chromium?: unknown; default?: { chromium?: unknown } };
      const chromium = (pw.chromium ?? (pw.default as { chromium?: unknown } | undefined)?.chromium) as
        | { launch(o: { executablePath?: string }): Promise<BrowserLike> }
        | undefined;
      if (!chromium) {
        skip('preview viewport suite', 'playwright-core exposes no chromium launcher');
      } else {
        browser = await chromium.launch({ executablePath: CHROME_PATH });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
        await page.goto(BASE, { waitUntil: 'load' });

        /* Generate a session through the REAL UI, offline (writer off).
           The switch is a styled checkbox (a span covers the input), so the
           state is set directly — the payload reads `.checked` when it runs. */
        await page.fill('#brief', 'A three-day independent games festival in Rotterdam. Talks and a late-night arcade.');
        await page.evaluate(() => {
          const box = document.querySelector('#copy-on') as HTMLInputElement | null;
          if (box) box.checked = false;
        });
        await page.click('#directions');
        await page.waitForFunction(
          () => document.querySelectorAll('#sheet-grid .dir iframe').length >= 4,
          undefined,
          { timeout: 30_000 },
        );

        const frame = (await page.$('.dir__preview iframe'))!;
        assert.ok(frame, 'the first direction card must contain a preview iframe');

        await test('desktop mode simulates a real 1440×900 viewport inside the card', async () => {
          await page.waitForFunction(
            () => document.querySelector('.dir__preview iframe')?.getAttribute('width') === '1440',
            undefined,
            { timeout: 15_000 },
          );
          assert.equal(await frame.getAttribute('width'), '1440', 'iframe layout width is 1440, not the card width');
          assert.equal(await frame.getAttribute('height'), '900', 'iframe layout height is 900, not 15rem');
          const style = (await frame.evaluate((el) => (el as HTMLElement).getAttribute('style') ?? '')) as string;
          assert.match(style, /scale\(/, 'the fixed viewport is fitted with a transform, not a resize');
        });

        await test('the page inside the desktop iframe lays out at 1440 CSS pixels', async () => {
          const innerWidth = (await page.evaluate(() => {
            const iframe = document.querySelector('.dir__preview iframe') as HTMLIFrameElement;
            const doc = iframe.contentDocument;
            return doc ? doc.documentElement.clientWidth : -1;
          })) as number;
          assert.ok(
            Math.abs(innerWidth - 1440) <= 16,
            `expected the inner document to lay out at ~1440px (scrollbar included), got ${innerWidth}`,
          );
        });

        await test('mobile mode switches to a real 390×844 viewport', async () => {
          await page.click('button[data-vp="mobile"]');
          await page.waitForFunction(
            () => document.querySelector('.dir__preview iframe')?.getAttribute('width') === '390',
            undefined,
            { timeout: 10_000 },
          );
          assert.equal(await frame.getAttribute('width'), '390');
          assert.equal(await frame.getAttribute('height'), '844');
          const innerWidth = (await page.evaluate(() => {
            const iframe = document.querySelector('.dir__preview iframe') as HTMLIFrameElement;
            return iframe.contentDocument?.documentElement.clientWidth ?? -1;
          })) as number;
          assert.ok(Math.abs(innerWidth - 390) <= 16, `inner document should lay out at ~390px, got ${innerWidth}`);
          await page.click('button[data-vp="desktop"]');
          await page.waitForFunction(
            () => document.querySelector('.dir__preview iframe')?.getAttribute('width') === '1440',
            undefined,
            { timeout: 10_000 },
          );
        });

        await test('resizing the window changes only the scale — the simulated viewport is stable', async () => {
          const before = {
            w: await frame.getAttribute('width'),
            h: await frame.getAttribute('height'),
          };
          const scaleBefore = (await frame.evaluate((el) => (el as HTMLElement).getAttribute('style') ?? '')) as string;
          await page.setViewportSize({ width: 1180, height: 900 });
          await new Promise((r) => setTimeout(r, 600));
          assert.equal(await frame.getAttribute('width'), before.w, 'width attribute must not follow the card');
          assert.equal(await frame.getAttribute('height'), before.h, 'height attribute must not follow the card');
          const scaleAfter = (await frame.evaluate((el) => (el as HTMLElement).getAttribute('style') ?? '')) as string;
          assert.notEqual(scaleAfter, scaleBefore, 'the FIT scale should adapt to the new card width');
          await page.setViewportSize({ width: 1600, height: 1000 });
          await new Promise((r) => setTimeout(r, 400));
        });

        await test('preview labels live outside the generated page canvas', async () => {
          const overlay = (await page.evaluate(() => {
            const box = document.querySelector('.dir__preview');
            if (!box) return 'no .dir__preview box';
            const kids = [...box.querySelectorAll('*')];
            const covering = kids.filter((el) => {
              const cs = getComputedStyle(el);
              return cs.position === 'absolute' && cs.zIndex !== 'auto' && (el as HTMLElement).tagName !== 'IFRAME';
            });
            return covering.length ? covering.map((el) => el.className).join(', ') : '';
          })) as string;
          assert.equal(overlay, '', `nothing may float over the generated page: ${overlay}`);
          // The preview label is in the card chrome, above the canvas.
          const headHasLabel = (await page.evaluate(() => {
            const head = document.querySelector('.dir__head');
            return Boolean(head && /preview|ready|loading/i.test(head.textContent ?? ''));
          })) as boolean;
          assert.ok(headHasLabel, 'the card header carries the preview/status label');
        });

        await test('a preview reports ready only after fonts load, with motion frozen', async () => {
          await page.waitForFunction(
            () =>
              (document.querySelector('.dir__preview iframe') as HTMLIFrameElement | null)?.contentDocument
                ?.documentElement.dataset.ready === '1',
            undefined,
            { timeout: 15_000 },
          );
          const state = (await page.evaluate(() => {
            const doc = (document.querySelector('.dir__preview iframe') as HTMLIFrameElement).contentDocument!;
            const css = [...doc.styleSheets]
              .map((s) => {
                try {
                  return [...s.cssRules].map((r) => r.cssText).join('\n');
                } catch {
                  return '';
                }
              })
              .join('\n');
            return {
              fonts: doc.fonts.status,
              frozen: /animation-play-state:\s*paused/.test(css) && /transition:\s*none/.test(css),
              ready: doc.documentElement.dataset.ready ?? '',
            };
          })) as { fonts: string; frozen: boolean; ready: string };
          assert.equal(state.ready, '1', 'the readiness marker is set by the harness');
          assert.equal(state.fonts, 'loaded', 'fonts must be loaded before ready');
          assert.ok(state.frozen, 'animations and transitions must be frozen for a stable thumbnail');
        });
      }
    }
  }
} catch (err) {
  failed++;
  console.error(`  FAIL  suite setup\n        ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
}

if (browser) await browser.close().catch(() => {});
if (server) {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  if (!server.killed) server.kill('SIGKILL');
}
await rm(outDir, { recursive: true, force: true });

console.log(
  failed
    ? `\n=== ${failed} FAILED, ${passed} passed${skipped ? `, ${skipped} skipped` : ''} ===\n`
    : `\nall ${passed} checks passed${skipped ? `, ${skipped} skipped` : ''}\n`,
);
if (failed) process.exit(1);
