/**
 * TurboSlop — core tests.
 *
 * Runs entirely offline against the local decider and the specimen content, so
 * it is deterministic and needs no keys. Live tests auto-skip when the relevant
 * credentials are absent. Run: npm test
 */
import assert from 'node:assert/strict';
import { decideWithFallback } from '../src/decider.js';
import { compose, ComposeError } from '../src/compose.js';
import { Content, fallbackContent, emphasize, stripEmphasis, balanceEmphasis, repairContent } from '../src/content.js';
import { COMPOSITION_IDS } from '../src/compositions.js';
import { EFFECT_KIT_IDS } from '../src/styles.js';
import { writeContent } from '../src/writer.js';
import { resolveLlm, describeLlm, extractJson, salvageTruncatedJson, complete } from '../src/llm.js';
import { renderHtml } from '../src/render.js';
import { DesignSpec } from '../src/types.js';
import { AXIS_CANDIDATE_IDS } from '../src/questions.js';

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

console.log('\n=== TurboSlop ===\n');

const BRIEFS = [
  'A calm, spa-like landing page for a wellness studio. Soft edges, lots of whitespace, slow gentle motion.',
  'A brutal technical control panel for satellite operators. Dense data, mono type, no decoration.',
  'A joyful, playful storefront for a candy brand aimed at kids. Bright, bouncy, rewarding to touch.',
];

/** Compose a spec and attach the specimen content, exactly as the pipeline does. */
async function composed(brief: string, offline = true): Promise<DesignSpec> {
  const r = await decideWithFallback(brief, { offline });
  const { spec } = compose(brief, r);
  const axes = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const w = await writeContent(brief, spec, { offline: true, fallback: fallbackContent(brief, axes) });
  spec.content = w.content;
  spec.meta.writer = w.source;
  spec.meta.writerModel = w.model;
  return spec;
}

/* ================================================================== *
 * Decisions
 * ================================================================== */
await test('local decider runs offline and returns Jev-shaped answers', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  assert.equal(r.kind, 'local');
  for (const id of ['emotion', 'palette', 'typography', 'layout', 'motion', 'density']) {
    assert.ok(r.response.answers[id], `missing answer for ${id}`);
  }
  const emotion = r.response.answers.emotion!;
  assert.equal(emotion.type, 'choice');
  assert.ok(emotion.confidence >= 0 && emotion.confidence <= 1);
});

await test('every composed pick exists in the catalog (no schema drift)', async () => {
  for (const brief of BRIEFS) {
    const spec = await composed(brief);
    for (const d of spec.decisions) {
      assert.ok(AXIS_CANDIDATE_IDS[d.axis].includes(d.picked), `${d.axis} picked "${d.picked}" off-catalog`);
    }
  }
});

await test('spec validates against the DesignSpec schema', async () => {
  const spec = await composed(BRIEFS[1]!);
  assert.equal(DesignSpec.parse(spec).version, 1);
});

await test('composite score is a weighted mean of axis confidences', async () => {
  const spec = await composed(BRIEFS[2]!);
  const totalW = spec.decisions.reduce((s, d) => s + (spec.composite.weights[d.axis] ?? 0), 0);
  const expected =
    spec.decisions.reduce((s, d) => s + (spec.composite.weights[d.axis] ?? 0) * d.confidence, 0) / totalW;
  assert.ok(Math.abs(expected - spec.composite.normalized) < 1e-9);
});

await test('low confidence is flagged for review rather than hidden', async () => {
  const r = await decideWithFallback('zzzz qqqq', { offline: true });
  const { spec } = compose('zzzz qqqq', r);
  assert.ok(spec.review.length > 0, 'an unmatchable brief should surface review axes');
});

await test('ranking is derived from the probability distribution', async () => {
  const spec = await composed(BRIEFS[0]!);
  const emotion = spec.decisions.find((d) => d.axis === 'emotion')!;
  assert.ok(emotion.ranked.length > 1);
  for (let i = 1; i < emotion.ranked.length; i++) {
    assert.ok(emotion.ranked[i - 1]!.score >= emotion.ranked[i]!.score, 'ranking not sorted');
  }
  assert.equal(emotion.ranked[0]!.id, emotion.picked);
});

await test('compose rejects a catalog/criteria drift', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const tampered = structuredClone(r);
  (tampered.response.answers.emotion as { choice: string }).choice = 'not-a-real-emotion';
  assert.throws(() => compose(BRIEFS[0]!, tampered), ComposeError);
});

/* ================================================================== *
 * Content — the brief decides the content, not a baked-in brand
 * ================================================================== */
await test('no generated page contains the old hardcoded studio', async () => {
  // Regression guard: every design used to be an "ATELIER NULL" page wearing
  // different colours, whatever the brief asked for.
  for (const brief of BRIEFS) {
    const html = renderHtml(await composed(brief));
    for (const stale of ['ATELIER NULL', 'ateliern.ull', 'HALCYON', 'VESPER', 'ORBITAL', 'FERNSIDE', 'behave like objects', 'Rua da Boavista']) {
      assert.ok(!html.includes(stale), `hardcoded content leaked into the output: "${stale}"`);
    }
  }
});

await test('the specimen is derived from the brief, not a fixed brand', async () => {
  const a = await composed('A calm spa landing page');
  const b = await composed('A brutal satellite control panel');
  assert.equal(a.content!.brand, 'SPECIMEN', 'specimen must not pretend to be a company');
  // The lede comes from the brief, so two briefs must not produce identical content.
  assert.notEqual(a.content!.lede, b.content!.lede, 'content did not vary with the brief');
  assert.notEqual(a.content!.title, b.content!.title);
});

await test('the specimen presents the decisions it was built from', async () => {
  const spec = await composed(BRIEFS[1]!);
  const c = spec.content!;
  // axes are surfaced as stats/features so the specimen is useful to evaluate
  for (const d of spec.decisions.slice(0, 4)) {
    const found =
      c.stats.some((s) => s.note === d.picked || s.label.toLowerCase() === d.axis) ||
      c.aboutFacts.some((f) => f.value.toLowerCase().includes(d.picked.split('-')[0]!));
    assert.ok(found, `axis ${d.axis}=${d.picked} not surfaced in the specimen`);
  }
});

await test('fallback content validates against the Content schema', async () => {
  for (const brief of BRIEFS) {
    const spec = await composed(brief);
    Content.parse(spec.content);
  }
});

await test('emphasis convention converts to <em> and strips safely', () => {
  assert.equal(emphasize('Six *problems* worth solving'), 'Six <em>problems</em> worth solving');
  assert.equal(emphasize('a *b* c *d*'), 'a <em>b</em> c <em>d</em>');
  assert.equal(emphasize('<script>*x*</script>'), '&lt;script&gt;<em>x</em>&lt;/script&gt;');
  assert.equal(stripEmphasis('Six *problems* worth solving'), 'Six problems worth solving');
  // unmatched asterisks must survive as literal text, not swallow the line
  assert.equal(emphasize('2 * 3 = 6'), '2 * 3 = 6');
});

await test('the tagline accent renders as an <em>, not literal asterisks', async () => {
  const spec = await composed(BRIEFS[0]!);
  const html = renderHtml(spec);
  assert.ok(html.includes('<h1 class="display">'), 'missing hero headline');
  const h1 = /<h1 class="display">([\s\S]*?)<\/h1>/.exec(html)![1]!;
  assert.ok(!h1.includes('*'), `asterisks leaked into the headline: ${h1}`);
  assert.ok(h1.includes('<em>'), 'expected an emphasised accent phrase in the headline');
  assert.ok(html.includes(stripEmphasis(spec.content!.tagline).slice(0, 20)), 'tagline not in output');
});

await test('content drives every part of the rendered page', async () => {
  const spec = await composed(BRIEFS[0]!);
  const c = spec.content!;
  const html = renderHtml(spec);
  assert.ok(html.includes(c.brand), 'brand missing');
  assert.ok(html.includes(c.lede.slice(0, 40)), 'lede missing');
  assert.ok(html.includes(c.cta), 'cta missing');
  assert.ok(html.includes(c.contact.email), 'contact email missing');
  assert.ok(html.includes(c.items[0]!.name), 'first item missing');
  assert.ok(html.includes(c.stats[0]!.value), 'first stat missing');
  assert.ok(html.includes(c.features[0]!.name), 'first feature missing');
  assert.ok(html.includes(c.aboutBody[0]!.slice(0, 40)), 'about body missing');
  assert.ok(html.includes(c.sections.contact.eyebrow), 'contact eyebrow missing');
  assert.ok(!html.includes('undefined'), 'undefined leaked into the output');
});

await test('nav anchors always resolve to real section ids', async () => {
  const spec = await composed(BRIEFS[1]!);
  const html = renderHtml(spec);
  const anchors = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) => m[1]!);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  for (const a of anchors) {
    if (a === 'top') continue;
    assert.ok(ids.has(a), `nav anchor #${a} has no target`);
  }
});

await test('every decided axis reaches the spec tokens', async () => {
  // A hardcoded token map once silently dropped newly-added axes, so they were
  // decided, paid for, and then never rendered.
  const spec = await composed(BRIEFS[0]!);
  for (const d of spec.decisions) {
    assert.ok(spec.tokens[d.axis], `axis "${d.axis}" missing from spec.tokens`);
    assert.equal(spec.tokens[d.axis], d.picked);
  }
});

await test('spec carries writer metadata even without an LLM', async () => {
  const spec = await composed(BRIEFS[0]!);
  const parsed = DesignSpec.parse(spec);
  assert.equal(parsed.meta.writer, 'fallback');
  assert.equal(parsed.meta.writerLatencyMs, 0);
  assert.ok(parsed.content, 'content must always be present');
});

/* ================================================================== *
 * Renderer
 * ================================================================== */
await test('renderer emits a complete, self-contained document', async () => {
  const html = renderHtml(await composed(BRIEFS[0]!));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
  assert.ok(/<h1[ >]/.test(html));
  assert.ok(!/href="#"/.test(html), 'dead link emitted');
  assert.ok(!html.includes('undefined'));
});

await test('renderer uses the modern CSS feature set', async () => {
  const html = renderHtml(await composed(BRIEFS[1]!));
  for (const feature of [
    '@layer', '@supports', 'animation-timeline: view()', 'scroll-state(', 'sibling-index()',
    'sibling-count()', 'contrast-color(', 'oklch(from', '@container', 'subgrid', 'text-box-trim',
    '@starting-style', 'allow-discrete', 'anchor-name', '@position-try', 'shape(', 'corner-shape',
    'appearance: base-select', '::scroll-marker', '::scroll-button', 'content-visibility',
    'scrollbar-gutter', 'prefers-reduced-transparency', 'field-sizing', 'aspect-ratio',
    '@media print', 'prefers-contrast', 'forced-colors', '.atmosphere',
  ]) {
    assert.ok(html.includes(feature), `stylesheet is missing ${feature}`);
  }
});

await test('every emotion yields a non-empty atmosphere layer', async () => {
  for (const brief of BRIEFS) {
    const html = renderHtml(await composed(brief));
    assert.ok(/\.atmosphere\s*\{[^}]*background:/.test(html), 'no atmosphere background');
  }
});

await test('reduced-motion is honoured', async () => {
  const html = renderHtml(await composed(BRIEFS[0]!));
  assert.ok(html.includes('prefers-reduced-motion'));
});

/* ================================================================== *
 * Variety — compositions and effect kits
 * ================================================================== */
/** A composed spec with overridden tokens, for exercising every option. */
async function specWith(overrides: Record<string, string>, brief = 'A general business site'): Promise<DesignSpec> {
  const spec = await composed(brief);
  Object.assign(spec.tokens, overrides);
  return spec;
}

await test('every composition renders and all its nav anchors resolve', async () => {
  for (const comp of COMPOSITION_IDS) {
    const html = renderHtml(await specWith({ composition: comp }));
    const anchors = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) => m[1]!);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    for (const a of anchors) {
      if (a === 'top') continue;
      assert.ok(ids.has(a), `composition "${comp}": anchor #${a} has no target`);
    }
    assert.ok(ids.has('contact'), `composition "${comp}" must always emit a #contact target`);
    assert.ok(html.includes(`data-composition="${comp}"`), `composition "${comp}" not marked`);
    assert.ok(!html.includes('undefined'), `composition "${comp}" leaked undefined`);
  }
});

await test('compositions are structurally different, not one skeleton recoloured', async () => {
  // Signature = the sorted set of structural class names used. Two compositions
  // sharing a hallmark class are allowed; identical signatures are not.
  const sig = (html: string) =>
    [...new Set([...html.matchAll(/class="([a-z][\w-]*)"/g)].map((m) => m[1]!))].sort().join('|');
  const signatures = new Map<string, string>();
  for (const comp of COMPOSITION_IDS) {
    signatures.set(comp, sig(renderHtml(await specWith({ composition: comp }))));
  }
  const unique = new Set(signatures.values());
  assert.equal(unique.size, COMPOSITION_IDS.length, `expected ${COMPOSITION_IDS.length} distinct structures, got ${unique.size}`);

  // And at least a few genuinely distinctive hallmarks must be present.
  const all = [...signatures.entries()].map(([, v]) => v).join(' ');
  for (const hallmark of ['split__panel', 'erow', 'bento', 'gallery', 'spectable', 'steps']) {
    assert.ok(all.includes(hallmark), `no composition uses the "${hallmark}" element`);
  }
});

await test('every effect kit emits its own scoped CSS', async () => {
  for (const kit of EFFECT_KIT_IDS) {
    const html = renderHtml(await specWith({ effects: kit }));
    assert.ok(html.includes(`data-effects="${kit}"`), `kit "${kit}" not marked on the root`);
    assert.ok(html.includes(`effect kit: ${kit}`), `kit "${kit}" CSS not emitted`);
    // Only the chosen kit ships — the stylesheet must not carry the others.
    for (const other of EFFECT_KIT_IDS) {
      if (other === kit) continue;
      assert.ok(!html.includes(`effect kit: ${other}`), `kit "${kit}" leaked "${other}"`);
    }
  }
});

await test('the same brief with a different composition produces a different page', async () => {
  const a = renderHtml(await specWith({ composition: 'classic-stack', effects: 'flat-plain' }));
  const b = renderHtml(await specWith({ composition: 'bento-grid', effects: 'luminous-glass' }));
  assert.notEqual(a.length, b.length, 'pages are byte-identical in length');
  assert.ok(a.includes('data-composition="classic-stack"'));
  assert.ok(b.includes('data-composition="bento-grid"'));
});

/* ---- tolerant repair ---- */
await test('over-long generated fields are clamped, not rejected', async () => {
  const base = (await composed(BRIEFS[0]!)).content!;
  const raw = {
    ...base,
    brand: 'A'.repeat(60),
    items: base.items.map((it, i) =>
      i === 0 ? { ...it, tags: ['a tag that is definitely longer than the old limit of twenty eight'] } : it,
    ),
    aboutBody: ['x'.repeat(2000)],
  };
  const repaired = repairContent(raw);
  assert.ok(repaired, 'a slightly over-long generation must be repaired, not discarded');
  assert.ok(repaired.brand.length <= 33, 'brand not clamped');
  assert.ok(repaired.items[0]!.tags[0]!.length <= 41, 'tag not clamped');
  assert.ok(repaired.aboutBody[0]!.length <= 701, 'paragraph not clamped');
});

await test('repair returns null only when the content is genuinely unusable', async () => {
  assert.equal(repairContent(null), null);
  assert.equal(repairContent({}), null);
  assert.equal(repairContent({ brand: 'X' }), null, 'a brand alone is not a page');
});

await test('unbalanced emphasis asterisks are repaired, not printed', () => {
  assert.equal(balanceEmphasis('a *b'), 'a b');
  assert.equal(balanceEmphasis('a *b*'), 'a *b*');
  assert.equal(emphasize(balanceEmphasis('Six *problems worth solving')), 'Six problems worth solving');
});

/* ---- truncated JSON recovery ---- */
await test('truncated JSON is salvaged instead of discarding the generation', () => {
  // Exactly what a reasoning model returns when it runs out of output budget:
  // a valid object cut off mid-array.
  const truncated =
    '{"brand":"Versions","items":[{"name":"A","meta":"x"},{"name":"B","meta":"y"},{"name":"C","me';
  const salvaged = salvageTruncatedJson(truncated);
  assert.ok(salvaged, 'should salvage a truncated object');
  const out = JSON.parse(salvaged) as { brand: string; items: unknown[] };
  assert.equal(out.brand, 'Versions');
  assert.equal(out.items.length, 2, 'drops only the incomplete element');
});

await test('salvage returns valid JSON untouched and declines the hopeless', () => {
  const good = '{"a":1,"b":[1,2,3]}';
  assert.deepEqual(JSON.parse(salvageTruncatedJson(good)!), JSON.parse(good));
  assert.equal(salvageTruncatedJson('no json here at all'), null);
  assert.equal(salvageTruncatedJson('{"a":"unterminated'), null);
});

await test('extractJson falls back to salvage when parsing fails', () => {
  const truncated = '{"brand":"Versions","nav":["A","B"],"extra":[{"k":"v"},{"k":';
  const out = extractJson(truncated) as Record<string, unknown>;
  assert.equal(out.brand, 'Versions');
  assert.deepEqual(out.nav, ['A', 'B']);
});

/* ---- reasoning controls: the parameter names are load-bearing ---- */
const TEST_LLM = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'test-key',
  keySource: 'test',
};

/** Call `complete` with fetch mocked, and return the request body it sent. */
async function captureRequestBody(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const realFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ message: { content: '{"brand":"X"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 0 } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    await complete({ system: 's', user: 'u', json: true, config: TEST_LLM, ...extra });
  } finally {
    globalThis.fetch = realFetch;
  }
  return body;
}

await test('reasoning controls use the documented field names', async () => {
  const body = await captureRequestBody();
  // `reasoning_effort` is the documented field. An earlier version sent
  // `effort`, which the API ignores silently — every effort setting then looked
  // identical because they were all running at the default.
  assert.equal(body.reasoning_effort, 'low', 'must send reasoning_effort');
  assert.ok(!('effort' in body), 'must NOT send "effort" — silently ignored');
  assert.deepEqual(body.thinking, { type: 'disabled' }, 'thinking is off by default');
});

await test('thinking can be turned on, and temperature is only sent when it applies', async () => {
  const off = await captureRequestBody({ temperature: 0.9 });
  assert.equal(off.temperature, 0.9, 'temperature applies in non-thinking mode');

  const on = await captureRequestBody({ thinking: 'enabled', temperature: 0.9 });
  assert.deepEqual(on.thinking, { type: 'enabled' });
  // Documented: thinking mode ignores temperature. Sending it would imply
  // control we do not have.
  assert.ok(!('temperature' in on), 'temperature must be omitted while thinking');
});

await test('reasoning tokens are reported, and are zero when thinking is off', async () => {
  const body = await captureRequestBody();
  assert.deepEqual(body.thinking, { type: 'disabled' });
  // The mock reports 0 reasoning tokens, matching the measured behaviour.
  const res = await (async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'deepseek-flash',
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 0 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      return await complete({ system: 's', user: 'u', config: TEST_LLM });
    } finally {
      globalThis.fetch = realFetch;
    }
  })();
  assert.equal(res.reasoningTokens, 0);
  assert.equal(res.thinking, 'disabled');
});

/* ================================================================== *
 * Live halves — auto-skip without credentials
 * ================================================================== */
const llm = resolveLlm();
await test(`live writing${llm ? ` (${describeLlm(llm)})` : ' (SKIPPED — no LLM configured)'}`, async () => {
  if (!llm) return;
  const brief = 'A neighbourhood bakery in Porto that mills its own flour. Warm, tactile, no-nonsense.';
  const r = await decideWithFallback(brief, { offline: true });
  const { spec } = compose(brief, r);
  const axes = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));

  const w = await writeContent(brief, spec, { config: llm, fallback: fallbackContent(brief, axes) });
  assert.equal(w.source, 'llm', `expected written content: ${w.fallbackReason ?? ''}`);
  Content.parse(w.content);

  // The whole point: the content must fit THIS brief, not a generic studio.
  const blob = JSON.stringify(w.content).toLowerCase();
  assert.ok(!blob.includes('atelier'), 'stale brand leaked in');
  assert.ok(!/lorem ipsum|innovative solutions|we are passionate/i.test(blob), 'filler detected');

  spec.content = w.content;
  const html = renderHtml(spec);
  assert.ok(html.includes(w.content.brand), 'written brand missing from the page');
  console.log(`        -> ${w.model} wrote "${w.content.brand}" — ${stripEmphasis(w.content.tagline)}`);
});

const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
await test(`live Jev decision${hasKey ? '' : ' (SKIPPED — no TYPESAFE_API_KEY)'}`, async () => {
  if (!hasKey) return;
  const brief = 'A mysterious, dark, occult-feeling portfolio for a tattoo artist.';
  const r = await decideWithFallback(brief, { preference: 'live' });
  assert.equal(r.kind, 'live');
  const { spec } = compose(brief, r);
  assert.ok(spec.meta.model.startsWith('jev'));
  console.log(`        -> ${spec.decisions.map((d) => `${d.axis}=${d.picked}(${d.confidence.toFixed(2)})`).join(' ')}`);
});

await test('both halves compose: Jev designs, the writer writes (SKIPPED without both)', async () => {
  if (!hasKey || !llm) return;
  const brief = 'An esports tournament site for a fighting-game league. Loud, fast, competitive.';
  const r = await decideWithFallback(brief, { preference: 'live' });
  const { spec } = compose(brief, r);
  const axes = spec.decisions.map((d) => ({ axis: d.axis, picked: d.picked, confidence: d.confidence }));
  const w = await writeContent(brief, spec, { config: llm, fallback: fallbackContent(brief, axes) });
  spec.content = w.content;

  const html = renderHtml(spec);
  assert.equal(spec.meta.decider, 'live');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('ATELIER NULL'));
  console.log(
    `        -> design by ${spec.meta.model}, content "${w.content.brand}" by ${w.model}, ` +
      `${spec.meta.latencyMs + w.latencyMs}ms total`,
  );
});

console.log(`\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
