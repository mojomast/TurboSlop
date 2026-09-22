/**
 * turboslop — image service tests.
 *
 * Entirely offline: `fetch` is mocked, so this runs in CI with no tailnet and
 * no GPU. What we are protecting here is the boundary logic — payload
 * validation, path safety, and above all the rule that we never surface a job
 * we did not submit (the status endpoint returns every user's history).
 *
 * Run: npm run test:images
 */
import assert from 'node:assert/strict';
import {
  IMAGE_PRESETS,
  ImageServiceError,
  PROMPT_CHAR_BUDGET,
  assertPromptsWithinBudget,
  buildAssetPrompts,
  describeImageService,
  fetchImage,
  pollJobs,
  promptBudgetWarning,
  resolveImageService,
  resolveImageSettings,
  resolveImageUrl,
  submitGenerate,
  validateGenerate,
  waitForJobs,
  type ImageServiceConfig,
} from '../src/images.js';
import { decideWithFallback } from '../src/decider.js';
import { compose } from '../src/compose.js';
import { renderHtml } from '../src/render.js';
import type { DesignSpec } from '../src/types.js';

let passed = 0;
let failed = 0;
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

/* ------------------------------------------------------------------ *
 * fetch mocking
 * ------------------------------------------------------------------ */
const realFetch = globalThis.fetch;
type Route = (url: string, init?: RequestInit) => { status: number; body?: unknown; bytes?: Buffer };
let routes: Route[] = [];
function mockFetch(...r: Route[]): void {
  routes = r;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      const res = route(url, init);
      if (res.status !== 0 || res.body !== undefined || res.bytes !== undefined) {
        return new Response(
          (res.bytes ?? JSON.stringify(res.body ?? {})) as unknown as BodyInit,
          { status: res.status || 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
    throw new Error(`unmocked fetch: ${url}`);
  }) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
/** A deliberately generic fixture: the tests must not depend on any one host. */
const SERVICE: ImageServiceConfig = {
  baseUrl: 'https://host.test:4363',
  timeoutMs: 5000,
  pollTimeoutMs: 20_000,
  origin: 'https://host.test:4363',
};

console.log('\n=== turboslop / images ===\n');

/* ---- payload validation ---- */
await test('validateGenerate enforces the documented bounds', () => {
  assert.doesNotThrow(() => validateGenerate('a hall', 1, 20, 3));
  assert.throws(() => validateGenerate('', 1, 20, 3), ImageServiceError, 'empty prompt');
  assert.throws(() => validateGenerate('x'.repeat(1001), 1, 20, 3), ImageServiceError, 'prompt too long');
  assert.throws(() => validateGenerate('ok', -1, 20, 3), ImageServiceError, 'seed < 0');
  assert.throws(() => validateGenerate('ok', 2147483648, 20, 3), ImageServiceError, 'seed too large');
  assert.throws(() => validateGenerate('ok', 1.5 as unknown as number, 20, 3), ImageServiceError, 'non-integer seed');
  assert.throws(() => validateGenerate('ok', 1, 0, 3), ImageServiceError, 'steps < 1');
  assert.throws(() => validateGenerate('ok', 1, 101, 3), ImageServiceError, 'steps > 100');
  assert.throws(() => validateGenerate('ok', 1, 20, 0.5), ImageServiceError, 'cfg < 1');
  assert.throws(() => validateGenerate('ok', 1, 20, 11), ImageServiceError, 'cfg > 10');
});

await test('prompt is trimmed before the 1000-character check', () => {
  // 1000 characters is the inclusive maximum, so padding is what decides.
  assert.doesNotThrow(() => validateGenerate('   ok   ', 1, 20, 3), 'trimmed short prompt must pass');
  assert.doesNotThrow(() => validateGenerate(' ' + 'x'.repeat(1000) + ' ', 1, 20, 3), 'trims to exactly 1000');
  assert.throws(() => validateGenerate(' ' + 'x'.repeat(1001) + ' ', 1, 20, 3), ImageServiceError, 'trims to 1001');
});

/* ---- service configuration: generic, allowlisted, no assumed host ---- */
const cleanEnv = () => {
  for (const k of [
    'FORGE_IMAGE_BASE_URL', 'FORGE_IMAGE_ALLOW_HOSTS', 'FORGE_IMAGE_ALLOW_ANY_HOST',
    'FORGE_IMAGE_TOKEN', 'FORGE_IMAGE_TOKEN_HEADER', 'FORGE_IMAGE_ORIGIN',
  ]) delete process.env[k];
};

await test('images are OFF unless a base URL is configured', () => {
  cleanEnv();
  assert.equal(resolveImageService(), null, 'no URL must mean no image backend');
  assert.match(describeImageService(null), /FORGE_IMAGE_BASE_URL/);
});

await test('localhost is always allowed; other hosts must be allowlisted', () => {
  cleanEnv();
  process.env.FORGE_IMAGE_BASE_URL = 'http://127.0.0.1:8000';
  assert.ok(resolveImageService(), 'localhost must be usable with no allowlist entry');

  process.env.FORGE_IMAGE_BASE_URL = 'https://evil.example.com';
  assert.equal(resolveImageService(), null, 'an unlisted public host must be refused');

  process.env.FORGE_IMAGE_ALLOW_HOSTS = 'images.internal.example.com, ev.example.com';
  process.env.FORGE_IMAGE_BASE_URL = 'https://images.internal.example.com';
  assert.ok(resolveImageService(), 'a named host must be permitted');
  assert.ok(/images\.internal\.example\.com/.test(describeImageService(resolveImageService())));
  cleanEnv();
});

await test('any host works when the allowlist is explicitly disabled', () => {
  cleanEnv();
  process.env.FORGE_IMAGE_BASE_URL = 'https://box.lan:9000';
  assert.equal(resolveImageService(), null);
  process.env.FORGE_IMAGE_ALLOW_ANY_HOST = '1';
  assert.ok(resolveImageService(), 'explicit opt-out must permit it');
  cleanEnv();
});

await test('non-HTTP schemes and malformed URLs are refused', () => {
  cleanEnv();
  for (const bad of ['file:///etc/passwd', 'ftp://host/x', 'not a url', '']) {
    process.env.FORGE_IMAGE_BASE_URL = bad;
    assert.equal(resolveImageService(), null, `should refuse ${JSON.stringify(bad)}`);
  }
  cleanEnv();
});

await test('optional auth header is built, bearer-prefixed only for Authorization', () => {
  cleanEnv();
  process.env.FORGE_IMAGE_BASE_URL = 'http://127.0.0.1:8000';

  process.env.FORGE_IMAGE_TOKEN = 'abc123';
  let cfg = resolveImageService();
  assert.ok(cfg, 'expected a resolved config');
  assert.deepEqual(cfg.authHeader, { name: 'Authorization', value: 'Bearer abc123' });

  process.env.FORGE_IMAGE_TOKEN = 'Bearer already';
  cfg = resolveImageService();
  assert.ok(cfg);
  assert.equal(cfg.authHeader?.value, 'Bearer already', 'must not double-prefix');

  process.env.FORGE_IMAGE_TOKEN_HEADER = 'X-Api-Key';
  process.env.FORGE_IMAGE_TOKEN = 'raw-key';
  cfg = resolveImageService();
  assert.ok(cfg);
  assert.deepEqual(cfg.authHeader, { name: 'X-Api-Key', value: 'raw-key' }, 'custom header is verbatim');
  cleanEnv();
});

await test('Origin defaults to the base URL and can be overridden', () => {
  cleanEnv();
  // localhost needs no allowlist entry, so this test stays self-contained
  process.env.FORGE_IMAGE_BASE_URL = 'http://127.0.0.1:4363';
  const a = resolveImageService();
  assert.ok(a);
  assert.equal(a.origin, 'http://127.0.0.1:4363');

  process.env.FORGE_IMAGE_ORIGIN = 'https://other.example.com';
  const b = resolveImageService();
  assert.ok(b);
  assert.equal(b.origin, 'https://other.example.com');
  cleanEnv();
});

/* ---- path safety: no arbitrary fetch proxy ---- */
await test('image paths are constrained to /images/*.png on the service origin', () => {
  assert.equal(
    resolveImageUrl(SERVICE, '/images/abc123.png'),
    'https://host.test:4363/images/abc123.png',
  );
  for (const bad of [
    'https://evil.example.com/x.png',
    '/images/../../etc/passwd',
    '/api/status',
    '/images/abc.png?x=1',
    '/images/abc.jpg',
    '//evil.example.com/x.png',
    '/images/a b.png',
  ]) {
    assert.throws(() => resolveImageUrl(SERVICE, bad), ImageServiceError, `should refuse ${bad}`);
  }
});

/* ---- privacy: only our jobs ---- */
await test('pollJobs returns ONLY the ids we submitted', async () => {
  mockFetch((url) =>
    url.endsWith('/api/status')
      ? {
          status: 200,
          body: {
            jobs: [
              { id: 'ours-1', status: 'done', placeholder: true, prompt: 'our prompt', seed: 1, steps: 20, cfg: 3, image: '/images/x.png', seconds: 2 },
              { id: 'ours-2', status: 'running', prompt: 'our prompt', seed: 2, steps: 20, cfg: 3 },
              { id: 'SOMEONE-ELSES', status: 'done', prompt: 'a private prompt from another user', image: '/images/y.png' },
              { id: 'ANOTHER-STRANGER', status: 'queued', prompt: 'private' },
            ],
          },
        }
      : { status: 404 },
  );
  const jobs = await pollJobs(SERVICE, new Set(['ours-1', 'ours-2']));
  assert.equal(jobs.length, 2, 'must not surface foreign jobs');
  assert.deepEqual(jobs.map((j) => j.id).sort(), ['ours-1', 'ours-2']);
  const blob = JSON.stringify(jobs);
  assert.ok(!blob.includes('private prompt'), 'foreign prompt text leaked');
  assert.ok(!blob.includes('STRANGER'), 'foreign id leaked');
  restoreFetch();
});

/* ---- submission ---- */
await test('submitGenerate parses a 202 and surfaces busy as retryable', async () => {
  mockFetch((url) =>
    url.endsWith('/api/generate') ? { status: 202, body: { id: 'job-1', batch: 'b1', ids: ['job-1'] } } : { status: 404 },
  );
  const ok = await submitGenerate(SERVICE, 'a hall', 42, 20, 3);
  assert.deepEqual(ok.ids, ['job-1']);

  mockFetch(() => ({ status: 429, body: { error: 'busy' } }));
  await assert.rejects(
    () => submitGenerate(SERVICE, 'a hall', 42, 20, 3),
    (e: unknown) => e instanceof ImageServiceError && e.status === 429 && e.retryable === true,
  );

  mockFetch(() => ({ status: 422, body: { detail: 'bad' } }));
  await assert.rejects(() => submitGenerate(SERVICE, 'a hall', 42, 20, 3), ImageServiceError);
  restoreFetch();
});

await test('the POST carries the Origin header the service requires', async () => {
  let seen: HeadersInit | undefined;
  mockFetch((url, init) => {
    seen = init?.headers;
    return { status: 202, body: { id: 'j', ids: ['j'] } };
  });
  await submitGenerate(SERVICE, 'a hall', 1, 20, 3);
  const h = new Headers(seen);
  assert.equal(h.get('Origin'), SERVICE.baseUrl, 'Origin header missing');
  assert.equal(h.get('Content-Type'), 'application/json');
  restoreFetch();
});

/* ---- image download validation ---- */
await test('fetchImage rejects non-PNG payloads and oversized responses', async () => {
  mockFetch(() => ({ status: 200, bytes: Buffer.from('not a png at all') }));
  await assert.rejects(() => fetchImage(SERVICE, '/images/a.png'), /not a PNG/);

  mockFetch(() => ({ status: 200, bytes: Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]) }));
  await assert.rejects(() => fetchImage(SERVICE, '/images/a.png'), /size cap/);

  mockFetch(() => ({ status: 200, bytes: PNG }));
  const buf = await fetchImage(SERVICE, '/images/a.png');
  assert.ok(buf.subarray(0, 8).equals(PNG.subarray(0, 8)));
  restoreFetch();
});

/* ---- polling ---- */
await test('waitForJobs returns once every job is terminal', async () => {
  let calls = 0;
  mockFetch(() => {
    calls++;
    return {
      status: 200,
      body: {
        jobs: [{ id: 'j1', status: calls < 3 ? 'running' : 'done', prompt: 'p', seed: 1, steps: 20, cfg: 3, image: calls < 3 ? undefined : '/images/j1.png' }],
      },
    };
  });
  const jobs = await waitForJobs(SERVICE, new Set(['j1']), { pollMs: 20, timeoutMs: 5000 });
  assert.equal(jobs[0]?.status, 'done');
  assert.ok(calls >= 3, 'should have polled more than once');
  restoreFetch();
});

await test('a failed job terminates polling without cancelling service-wide work', async () => {
  let cancelCalled = false;
  mockFetch((url) => {
    if (url.includes('/api/cancel')) cancelCalled = true;
    return { status: 200, body: { jobs: [{ id: 'j1', status: 'failed', prompt: 'p', seed: 1, steps: 20, cfg: 3 }] } };
  });
  const jobs = await waitForJobs(SERVICE, new Set(['j1']), { pollMs: 20, timeoutMs: 3000 });
  assert.equal(jobs[0]?.status, 'failed');
  assert.equal(cancelCalled, false, 'must never call /api/cancel');
  restoreFetch();
});

/* ---- prompts ---- */
await test('buildAssetPrompts returns the requested count within API limits', async () => {
  const r = await decideWithFallback('A calm spa landing page', { offline: true });
  const { spec } = compose('A calm spa landing page', r);

  for (const n of [1, 2, 3, 5]) {
    const prompts = buildAssetPrompts(spec, n);
    assert.equal(prompts.length, n);
    for (const p of prompts) {
      assert.ok(p.prompt.trim().length >= 1 && p.prompt.trim().length <= 1000, 'prompt outside 1-1000 chars');
      // The real constraint: the encoder truncates well before the API limit.
      assert.equal(promptBudgetWarning(p.prompt), null, `prompt exceeds the encoder budget: ${p.prompt.length} chars`);
    }
  }
  // kinds cycle so a multi-image run covers backdrop + surface + motif
  const kinds = buildAssetPrompts(spec, 3).map((p) => p.kind);
  assert.deepEqual(kinds, ['backdrop', 'surface', 'motif']);
});

await test('prompts stay inside the budget for every emotion', async () => {
  const briefs = [
    'A calm spa landing page', 'A brutal control panel for satellite operators',
    'A joyful candy storefront for kids', 'An opulent old-world perfume maison',
    'A public sector health portal', 'An esports tournament site',
    'A small independent ceramics studio', 'A climate technology startup',
    'A planetarium and space museum', 'A heritage letterpress print shop',
  ];
  for (const b of briefs) {
    const r = await decideWithFallback(b, { offline: true });
    const { spec } = compose(b, r);
    assertPromptsWithinBudget(buildAssetPrompts(spec, 3));
  }
});

await test('the budget warning fires past the measured encoder limit', () => {
  assert.equal(promptBudgetWarning('a'.repeat(PROMPT_CHAR_BUDGET)), null);
  const w = promptBudgetWarning('a'.repeat(PROMPT_CHAR_BUDGET + 1));
  assert.ok(w && /truncat/i.test(w), 'must warn about silent truncation');
});

await test('asset prompts describe the palette in visible terms, never by id', async () => {
  const briefs = [
    'A brutal control panel for satellite operators',
    'A calm spa landing page',
    'A joyful candy storefront',
    'An opulent perfume maison',
  ];
  const paletteIds = ['hazard-mono', 'sage-mist', 'candy-pop', 'void-violet', 'aurora-glass', 'noir-lime'];
  for (const b of briefs) {
    const r = await decideWithFallback(b, { offline: true });
    const { spec } = compose(b, r);
    for (const p of buildAssetPrompts(spec, 3)) {
      // A palette id in a prompt is meaningless to the image model.
      for (const id of paletteIds) {
        assert.ok(!p.prompt.includes(id), `prompt leaked the palette id "${id}": ${p.prompt}`);
      }
      assert.ok(
        /black|white|cream|violet|sage|terracotta|orange|lime|blue|peach|bone|grey|golden|cyan/i.test(p.prompt),
        `prompt lacks any visible colour language: ${p.prompt}`,
      );
    }
  }
});

await test('asset prompts avoid the anti-patterns this model ignores', async () => {
  const r = await decideWithFallback('A brutal control panel', { offline: true });
  const { spec } = compose('A brutal control panel', r);
  for (const p of buildAssetPrompts(spec, 3)) {
    assert.ok(!/\b8k\b|\b4k\b|masterpiece|best quality|score_/i.test(p.prompt), 'quality-tag spam');
    assert.ok(!/\bno \w+,\s*no \w+/i.test(p.prompt), 'negative-prompt lists do not work here');
  }
});

/* ---- presets ---- */
await test('presets resolve correctly and overrides win', () => {
  assert.equal(resolveImageSettings({ imagePreset: 'turbo' }).steps, 4);
  assert.equal(resolveImageSettings({ imagePreset: 'preview' }).steps, 10);
  assert.equal(resolveImageSettings({ imagePreset: 'balanced' }).steps, 20);
  assert.equal(resolveImageSettings({ imagePreset: 'reference' }).steps, 50);
  assert.equal(resolveImageSettings({ imagePreset: 'fast' }).cfg, 1, 'guidance 1 fast preset');
  const over = resolveImageSettings({ imagePreset: 'balanced', imageSteps: 12, imageCfg: 5 });
  assert.equal(over.steps, 12);
  assert.equal(over.cfg, 5);
  assert.equal(resolveImageSettings({ imagePreset: 'nonsense' }).steps, IMAGE_PRESETS.balanced!.steps);
});

await test('guidance 1 is labelled as a non-equivalent shortcut', () => {
  const fast = IMAGE_PRESETS.fast!;
  assert.ok(/not equivalent/i.test(fast.note), 'the guidance-1 caveat must be stated');
});

/* ---- rendering with and without art ---- */
await test('pages render identically in structure with or without generated art', async () => {
  const r = await decideWithFallback('A calm spa landing page', { offline: true });
  const { spec } = compose('A calm spa landing page', r);

  const without = renderHtml(spec);
  assert.ok(without.includes('class="plate"'), 'gradient fallback plate missing');
  assert.ok(!without.includes('<img class="plate-img"'), 'no images expected');

  const withArt: DesignSpec = {
    ...spec,
    assets: [
      { kind: 'backdrop', file: 'assets/x/00-backdrop-1.png', alt: 'Abstract backdrop', prompt: 'a backdrop', seed: 1, steps: 20, cfg: 3, bytes: 1024, seconds: 2 },
      { kind: 'motif', file: 'assets/x/01-motif-2.png', alt: 'Motif', prompt: 'a motif', seed: 2, steps: 20, cfg: 3, bytes: 1024, seconds: 2 },
    ],
  };
  const html = renderHtml(withArt);
  assert.ok(html.includes('<img class="plate-img"'), 'generated art not embedded');
  assert.ok(html.includes('width="256" height="256"'), 'explicit dimensions prevent layout shift');
  assert.ok(html.includes('loading="lazy"'), 'plate images should lazy-load');
  assert.ok(html.includes('alt="Motif"'), 'plate alt text missing');
  assert.ok(html.includes('assets/x/01-motif-2.png'), 'motif asset not used in a plate');
  assert.ok(html.includes('assets/x/00-backdrop-1.png'), 'backdrop not used as hero art');
  assert.ok(/hero-art[^>]*aria-hidden="true"/.test(html), 'the decorative backdrop must be hidden from assistive tech');
});

/* ---- end to end with a mocked service ---- */
await test('generateAssets submits, polls, downloads and persists', async () => {
  const tmp = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/forge-img-'));
  let submitted = 0;
  mockFetch((url) => {
    if (url.endsWith('/api/generate')) {
      submitted++;
      return { status: 202, body: { id: `job-${submitted}`, batch: 'b', ids: [`job-${submitted}`] } };
    }
    if (url.endsWith('/api/status')) {
      return {
        status: 200,
        body: {
          jobs: Array.from({ length: submitted }, (_, i) => ({
            id: `job-${i + 1}`, status: 'done', prompt: 'p', seed: 100 + i, steps: 4, cfg: 2,
            image: `/images/job-${i + 1}.png`, seconds: 1.2,
          })),
        },
      };
    }
    if (url.includes('/images/')) return { status: 200, bytes: PNG };
    return { status: 404, body: {} };
  });

  const { generateAssets } = await import('../src/images.js');
  const r = await decideWithFallback('A calm spa landing page', { offline: true });
  const { spec } = compose('A calm spa landing page', r);

  const run = await generateAssets(spec, {
    count: 2, steps: 4, cfg: 2, outDir: tmp, slug: 'test', service: SERVICE,
  });
  assert.equal(run.assets.length, 2, 'expected two persisted assets');
  assert.equal(submitted, 2, 'one submission per image (explicit seed control)');
  for (const a of run.assets) {
    assert.ok(a.file.startsWith(tmp), 'asset written outside the output dir');
    assert.equal(a.bytes, PNG.byteLength);
    assert.ok(a.seed > 0);
  }
  restoreFetch();
});

console.log(`\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
