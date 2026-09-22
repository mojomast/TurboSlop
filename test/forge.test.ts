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
import { BLUEPRINTS } from '../src/blueprint.js';
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
  assert.ok(/<h1[^>]*>/.test(html), 'missing hero headline');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1]!;
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
  assert.ok(html.includes(c.items[0]!.name), 'first item missing');
  assert.ok(html.includes(c.stats[0]!.value), 'first stat missing');
  assert.ok(html.includes(c.features[0]!.name), 'first feature missing');
  assert.ok(html.includes(c.aboutBody[0]!.slice(0, 40)), 'about body missing');
  if (c.sections.contact?.eyebrow) {
    assert.ok(html.includes(c.sections.contact.eyebrow), 'contact eyebrow missing');
  }
  assert.ok(!html.includes('undefined'), 'undefined leaked into the output');
});

await test('contact details are never invented to fill the section', async () => {
  // The specimen has no contact details, and the page must say so rather than
  // fabricate an address and a phone number.
  const spec = await composed(BRIEFS[0]!);
  assert.equal(spec.content!.contact, undefined, 'the specimen must not carry contact details');
  const html = renderHtml(spec);
  assert.ok(
    /specified no way to get in touch|No contact details supplied/i.test(html),
    'a page with no contact details must say so honestly',
  );
  assert.ok(!/mailto:[^\s"}]+@example\.com/.test(html), 'no placeholder email address');
  assert.ok(!/tel:\+?0/.test(html), 'no placeholder phone number');
});

await test('a form is only rendered when it has a real submission path', async () => {
  // A form must either submit somewhere or be clearly a preview. A dead form
  // that silently does nothing is the failure mode this guards.
  const spec = await composed(BRIEFS[0]!);
  const noContact = renderHtml(spec);
  assert.ok(!/<form/.test(noContact), 'no contact details means no form at all');

  spec.content = Content.parse({
    ...spec.content!,
    contact: { email: 'hello@kilnandquiet.example' },
  });
  const withEmail = renderHtml(spec);
  assert.ok(/<form[^>]+action="mailto:hello@kilnandquiet\.example"/.test(withEmail), 'form needs a real action');
  assert.ok(!/onsubmit="return false"/.test(withEmail), 'the dead no-op handler must be gone');
  assert.ok(/Opens your own email client/.test(withEmail), 'the submission path must be explained');
});

await test('every rendered id is unique, even when a blueprint repeats a module', async () => {
  // `catalogue-rail` renders `items` twice. Both `<main>` and the hero once
  // carried id="top" as well. Duplicate ids make anchors ambiguous and are
  // invalid HTML.
  const repeats = ['catalogue-rail', 'catalogue-market', 'product-spec'];
  for (const bp of repeats) {
    const spec = await composed(BRIEFS[0]!);
    spec.blueprint = bp;
    const html = renderHtml(spec);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual([...new Set(dupes)], [], `blueprint ${bp} emitted duplicate ids: ${dupes.join(', ')}`);
    assert.equal(ids.filter((id) => id === 'top').length, 1, `blueprint ${bp} must have exactly one #top`);
  }
});

await test('nav anchors resolve to the instance the blueprint means', async () => {
  // When a module repeats, the nav must point at the FIRST instance, and every
  // emitted target must exist in the document.
  const spec = await composed(BRIEFS[0]!);
  spec.blueprint = 'catalogue-rail';
  const html = renderHtml(spec);
  const anchors = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) => m[1]!);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  for (const a of anchors) assert.ok(ids.has(a), `nav anchor #${a} has no target`);
  // The rail renders items twice; the nav must name the first one only.
  assert.ok(ids.has('items') && ids.has('items-2'), 'both item instances must be addressable');
  assert.ok(anchors.includes('items'), 'nav should target the first items instance');
  assert.ok(!anchors.includes('items-2'), 'nav should not target the repeated instance');
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
/** A composed spec pinned to a blueprint (and optional token overrides). */
async function specWith(overrides: Record<string, string>, brief = 'A general business site'): Promise<DesignSpec> {
  const spec = await composed(brief);
  if (overrides.blueprint) spec.blueprint = overrides.blueprint;
  Object.assign(spec.tokens, overrides);
  return spec;
}

await test('every blueprint renders and all its nav anchors resolve', async () => {
  for (const bp of BLUEPRINTS) {
    const html = renderHtml(await specWith({ blueprint: bp.id }));
    const anchors = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) => m[1]!);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    for (const a of anchors) {
      if (a === 'top') continue;
      assert.ok(ids.has(a), `blueprint "${bp.id}": anchor #${a} has no target`);
    }
    assert.ok(ids.has('contact'), `blueprint "${bp.id}" must always emit a #contact target`);
    assert.ok(html.includes(`data-blueprint="${bp.id}"`), `blueprint "${bp.id}" not marked`);
    assert.ok(!html.includes('undefined'), `blueprint "${bp.id}" leaked undefined`);
  }
});

await test('blueprints produce distinct section sequences and block variants', async () => {
  // Fingerprint the RENDERED structure: the ordered blocks, the hero, the
  // chrome. Deliberately not class names, copy or colours.
  const sig = (html: string) => {
    const blocks = [...html.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]!);
    const lead = (html.match(/data-lead="([^"]+)"/) ?? [])[1] ?? '?';
    const hero = (html.match(/hero hero--([a-z]+)/) ?? [])[1] ?? 'display';
    const nav = (html.match(/site-head--([a-z-]+)/) ?? [])[1] ?? 'bar';
    const foot = (html.match(/footer--([a-z-]+)/) ?? [])[1] ?? 'masthead';
    return [lead, hero, nav, foot, blocks.join('>')].join('|');
  };
  const seen = new Map<string, string>();
  let distinct = 0;
  for (const bp of BLUEPRINTS) {
    const key = sig(renderHtml(await specWith({ blueprint: bp.id })));
    if (!seen.has(key)) distinct++;
    seen.set(key, bp.id);
  }
  assert.ok(distinct >= 12, `expected many distinct rendered structures, got ${distinct} of ${BLUEPRINTS.length}`);
});

await test('two blueprints render visibly different block sequences', async () => {
  const a = renderHtml(await specWith({ blueprint: 'data-metrics' }));
  const b = renderHtml(await specWith({ blueprint: 'image-mosaic' }));
  const blocksOf = (h: string) => [...h.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]!).join('>');
  assert.notEqual(blocksOf(a), blocksOf(b));
  assert.ok(a.includes('data-lead="data"'));
  assert.ok(b.includes('data-lead="image"'));
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

await test('the same brief with a different blueprint produces a different page', async () => {
  const a = renderHtml(await specWith({ blueprint: 'catalogue-gallery', effects: 'flat-plain' }));
  const b = renderHtml(await specWith({ blueprint: 'data-calculator', effects: 'luminous-glass' }));
  assert.notEqual(a.length, b.length, 'pages are byte-identical in length');
  assert.ok(a.includes('data-blueprint="catalogue-gallery"'));
  assert.ok(b.includes('data-blueprint="data-calculator"'));
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

await test('every design record carries per-generation metrics', async () => {
  // The control surface lists designs without loading each spec, so the metrics
  // have to travel with the record.
  const { listDesigns } = await import('../src/registry.js');
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reg-'));

  // Write a spec + html the way the pipeline does, then read it back.
  const spec = await composed(BRIEFS[0]!);
  spec.meta.latencyMs = 400;
  spec.meta.inputTokens = 2500;
  spec.meta.estimatedUsd = 0.000105;
  spec.meta.writerLatencyMs = 7000;
  spec.meta.writerInputTokens = 900;
  spec.meta.writerOutputTokens = 1300;
  spec.meta.writerEstimatedUsd = 0.000915;
  await fs.writeFile(path.join(tmp, 'demo.spec.json'), JSON.stringify(spec));
  await fs.writeFile(path.join(tmp, 'demo.html'), '<!DOCTYPE html><html></html>');

  const [d] = await listDesigns(tmp);
  assert.ok(d, 'record not listed');
  assert.equal(d.decideMs, 400);
  assert.equal(d.writeMs, 7000);
  assert.equal(d.totalMs, 7400, 'total sums decide + write + images');
  assert.equal(d.jevTokens, 2500);
  assert.equal(d.writerTokensOut, 1300);
  assert.ok(Math.abs(d.costJev - 0.000105) < 1e-9);
  assert.ok(Math.abs(d.costWriter - 0.000915) < 1e-9);
  assert.ok(Math.abs(d.costTotal - 0.00102) < 1e-9, 'costTotal must be the sum of both halves');
});

await test('cost is recomputed for specs that predate the field', async () => {
  const { listDesigns } = await import('../src/registry.js');
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reg2-'));

  const spec = await composed(BRIEFS[0]!);
  // Simulate an older spec: token counts present, cost fields absent/zero.
  spec.meta.writerEstimatedUsd = 0;
  spec.meta.writerInputTokens = 1000;
  spec.meta.writerOutputTokens = 2000;
  await fs.writeFile(path.join(tmp, 'old.spec.json'), JSON.stringify(spec));

  const [d] = await listDesigns(tmp);
  assert.ok(d, 'record not listed');
  // 1000 * $0.15/M + 2000 * $0.60/M
  assert.ok(Math.abs(d.costWriter - (0.00015 + 0.0012)) < 1e-9, `expected recomputed cost, got ${d.costWriter}`);
});

await test('every local-decider affinity id exists in the catalog', async () => {
  // The stand-in decider boosts candidates by affinity. Those ids once pointed
  // at typefaces that were planned but never landed, so the typography boost
  // silently did nothing — a whole axis of variety lost to a typo. This asserts
  // the wiring, and is the check that would have caught it.
  const { EMOTIONS, COMPOSITIONS, EFFECT_KITS, PALETTES, TYPEFACES, LAYOUTS, MOTIONS } = await import('../src/catalog.js');
  const catalog = new Set<string>([
    ...EMOTIONS.map((x) => x.id),
    ...COMPOSITIONS.map((x) => x.id),
    ...EFFECT_KITS.map((x) => x.id),
    ...PALETTES.map((x) => x.id),
    ...TYPEFACES.map((x) => x.id),
    ...LAYOUTS.map((x) => x.id),
    ...MOTIONS.map((x) => x.id),
  ]);

  const src = await (await import('node:fs/promises')).readFile(new URL('../src/decider.ts', import.meta.url), 'utf8');
  const block = /const EMOTION_AFFINITY[\s\S]*?\n\};/.exec(src);
  assert.ok(block, 'could not locate the AFFINITY table');

  const axisKeys = new Set(['composition', 'effects', 'palette', 'typography', 'layout', 'motion', 'density']);
  const emotionIds = new Set(EMOTIONS.map((e) => e.id));
  const referenced = new Set<string>();
  for (const m of block![0].matchAll(/'([a-z0-9-]+)'/g)) {
    const id = m[1]!;
    if (axisKeys.has(id) || emotionIds.has(id)) continue;
    referenced.add(id);
  }

  assert.ok(referenced.size > 20, `expected many affinity ids, found ${referenced.size}`);
  const dead = [...referenced].filter((id) => !catalog.has(id));
  assert.deepEqual(dead, [], `affinity ids not present in the catalog: ${dead.join(', ')}`);
});

await test('the palette guardrail reads lightness from the palette, not a name list', async () => {
  // A hardcoded list of "light" palette names drifted when a palette was
  // renamed, so the dark-ground conflict check stopped firing for it.
  const { PALETTES } = await import('../src/catalog.js');
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/compose.ts', import.meta.url), 'utf8');
  assert.ok(/isLightGround\(/.test(src), 'the guardrail must derive lightness from the palette');
  assert.ok(!/lightPalettes/.test(src), 'the hardcoded palette-name list must be gone');

  // And the helper must actually classify a known light and a known dark palette.
  const paper = PALETTES.find((p) => p.id === 'paper-ink')!;
  const voidp = PALETTES.find((p) => p.id === 'void-violet')!;
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  assert.ok(lum(paper.bg) > 140, 'paper-ink should read as a light ground');
  assert.ok(lum(voidp.bg) < 140, 'void-violet should read as a dark ground');
});

/* ================================================================== *
 * Blueprints — the layout grammar
 * ================================================================== */
await test('every blueprint validates against its own compatibility rules', async () => {
  const { validateAllBlueprints } = await import('../src/blueprint.js');
  const issues = validateAllBlueprints();
  const report = issues.map((i) => `${i.blueprint}: [${i.rule}] ${i.detail}`).join('\n        ');
  assert.deepEqual(issues, [], `blueprint validation failed:\n        ${report}`);
});

await test('blueprints are structurally distinct from one another', async () => {
  const { BLUEPRINTS, fingerprintKey } = await import('../src/blueprint.js');
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const bp of BLUEPRINTS) {
    const key = fingerprintKey(bp);
    const prev = seen.get(key);
    if (prev) clashes.push(`${prev} and ${bp.id} share a fingerprint`);
    seen.set(key, bp.id);
  }
  assert.deepEqual(clashes, [], clashes.join('; '));
});

await test('the blueprint catalog covers every lead', async () => {
  const { BLUEPRINTS, LEADS } = await import('../src/blueprint.js');
  const covered = new Set(BLUEPRINTS.map((b) => b.lead));
  const missing = LEADS.filter((l) => !covered.has(l));
  assert.deepEqual(missing, [], `no blueprint leads with: ${missing.join(', ')}`);
  assert.ok(BLUEPRINTS.length >= 15, `expected a deep catalog, got ${BLUEPRINTS.length}`);
});

await test('no blueprint always demands the same sections in the same order', async () => {
  // The old model produced hero -> items -> features -> stats -> about -> contact
  // for every page. Nothing may reintroduce that as a fixed spine.
  const { BLUEPRINTS } = await import('../src/blueprint.js');
  const spines = new Map<string, number>();
  for (const bp of BLUEPRINTS) {
    const spine = bp.sections.map((x) => x.module).join('>');
    spines.set(spine, (spines.get(spine) ?? 0) + 1);
  }
  const worst = Math.max(...spines.values());
  assert.ok(worst <= 2, `a single section order is used ${worst} times`);
  assert.ok(spines.size >= 12, `expected many distinct orders, got ${spines.size}`);
});

await test('structural distance ignores copy, colour and class names', async () => {
  const { BLUEPRINT_BY_ID, fingerprintDistance } = await import('../src/blueprint.js');
  const a = BLUEPRINT_BY_ID['catalogue-gallery']!;
  const b = BLUEPRINT_BY_ID['data-metrics']!;
  const c = BLUEPRINT_BY_ID['catalogue-gallery']!;
  assert.equal(fingerprintDistance(a, c), 0, 'a blueprint is identical to itself');
  assert.ok(fingerprintDistance(a, b) > 0.6, 'unrelated blueprints should be far apart');

  // Two blueprints differing only in lead/hero are still measurably apart.
  const d = BLUEPRINT_BY_ID['product-demo']!;
  const e = BLUEPRINT_BY_ID['product-spec']!;
  const dist = fingerprintDistance(d, e);
  assert.ok(dist > 0.2 && dist < 1, `same-family blueprints should differ: got ${dist}`);
});

/* ================================================================== *
 * The visual blueprint
 * ================================================================== */
await test('every visual blueprint in the whole space validates', async () => {
  const { visualBlueprintFor, validateVisualBlueprint } = await import('../src/visual.js');
  const { BLUEPRINTS } = await import('../src/blueprint.js');
  const { TYPEFACES, EMOTIONS } = await import('../src/catalog.js');
  const issues: string[] = [];
  let n = 0;
  for (const bp of BLUEPRINTS) {
    for (const t of TYPEFACES) {
      for (const e of EMOTIONS) {
        for (const d of ['quiet', 'balanced', 'dense']) {
          const vb = visualBlueprintFor({
            blueprint: bp, typefaceId: t.id, emotion: e.id, density: d,
            seed: 7, accent: '#7c5cff', ground: '#ffffff',
          });
          n++;
          for (const i of validateVisualBlueprint(vb)) issues.push(`${bp.id}/${t.id}/${e.id}/${d}: ${i.rule} — ${i.detail}`);
        }
      }
    }
  }
  assert.ok(n > 4000, `expected the full space, only ${n} combinations`);
  assert.deepEqual(issues.slice(0, 8), [], `${issues.length} invalid visual blueprints`);
});

await test('the visual blueprint is deterministic and genuinely seeded', async () => {
  const { visualBlueprintFor } = await import('../src/visual.js');
  const { BLUEPRINT_BY_ID } = await import('../src/blueprint.js');
  const bp = BLUEPRINT_BY_ID['catalogue-gallery']!;
  const at = (seed: number) =>
    visualBlueprintFor({ blueprint: bp, typefaceId: 'grotesk-tight', emotion: 'serenity', density: 'balanced', seed, accent: '#5f7263', ground: '#f7f4ee' });
  assert.deepEqual(at(42), at(42), 'the same seed must give the same drawing');
  const a = JSON.stringify(at(1).sections);
  const b = JSON.stringify(at(9999).sections);
  assert.notEqual(a, b, 'a different seed must move at least the section recipes');
});

await test('typographic recipes are recipes, not just font names', async () => {
  const { typoRecipeFor, HEADLINE_CONSTRUCTIONS, SECTION_BLEEDS } = await import('../src/visual.js');
  const voices = ['grotesk-tight', 'editorial-serif', 'geometric-open', 'mono-technical', 'humanist-light'];
  const constructions = new Set(voices.map((v) => typoRecipeFor(v, 'statement', 'balanced').construction));
  assert.ok(constructions.size >= 3, `expected several headline constructions, got ${[...constructions].join(', ')}`);
  for (const v of voices) {
    const t = typoRecipeFor(v, 'statement', 'balanced');
    assert.ok(HEADLINE_CONSTRUCTIONS.includes(t.construction));
    assert.ok(t.measure.endsWith('ch'), `${v} has no reading measure`);
    assert.ok(['start', 'center'].includes(t.alignment));
    assert.ok(t.scale > 0.6 && t.scale < 1.6, `${v} scale out of range: ${t.scale}`);
  }
  // Density changes the measure, never the construction.
  const dense = typoRecipeFor('grotesk-tight', 'statement', 'dense');
  const quiet = typoRecipeFor('grotesk-tight', 'statement', 'quiet');
  assert.equal(dense.construction, quiet.construction, 'density must not change the construction');
  assert.notEqual(dense.measure, quiet.measure, 'density must change the measure');
  // Outline headlines are only assigned where there is room for them.
  assert.equal(typoRecipeFor('grotesk-tight', 'data', 'balanced').fill, true, 'a data page must not get an outline headline');
  void SECTION_BLEEDS;
});

await test('the three new hero recipes render as genuinely different markup', async () => {
  const cases: [string, string][] = [
    ['statement-display', 'poster'],
    ['story-editorial', 'editorial-figure'],
    ['product-demo', 'product-demo'],
  ];
  const marks: string[] = [];
  for (const [bpId, hero] of cases) {
    const spec = await composed(BRIEFS[0]!);
    spec.blueprint = bpId;
    const html = renderHtml(spec);
    assert.ok(html.includes(`data-hero="${hero}"`), `${bpId} should use the ${hero} hero`);
    assert.ok(html.includes(`hero--${hero}`), `${bpId} should render the ${hero} hero class`);
    marks.push(`${hero}:${html.includes('class="display hero-poster__title"')}|${html.includes('class="hero-figure__col"')}|${html.includes('class="hero-demo__frame"')}`);
  }
  // poster uses none of the other two, and so on
  assert.ok(marks[0]!.includes('poster:true|false|false'), marks[0]);
  assert.ok(marks[1]!.includes('editorial-figure:false|true|false'), marks[1]);
  assert.ok(marks[2]!.includes('product-demo:false|false|true'), marks[2]);
});

await test('a product demonstration is wrapped in a real frame', async () => {
  const spec = await composed(BRIEFS[0]!);
  spec.blueprint = 'product-demo';
  spec.assets = [
    { kind: 'backdrop', slot: 'hero', source: 'generated', file: 'assets/demo/00-backdrop-1.png', alt: 'demo', credit: '', license: '', nativeWidth: 256, nativeHeight: 256, prompt: '', seed: 1, steps: 4, cfg: 2, bytes: 100, seconds: 0 },
  ];
  const html = renderHtml(spec);
  assert.ok(/frame--(browser|device|plain)/.test(html), 'the demonstration should be framed');
  assert.ok(html.includes('use this') === false, 'no control-surface chrome may leak into the page');
});

await test('art-directed treatments degrade rather than hide text', async () => {
  const { IMAGE_TREATMENTS } = await import('../src/visual.js');
  assert.deepEqual(
    [...IMAGE_TREATMENTS],
    ['plain', 'cutout', 'duotone', 'shaped', 'layered', 'textwrap'],
  );
  // Whatever the treatment, the headline must remain filled and readable when
  // the user asks for more contrast.
  const spec = await composed(BRIEFS[0]!);
  spec.blueprint = 'image-mosaic';
  const html = renderHtml(spec);
  assert.ok(/prefers-contrast: more/.test(html), 'contrast fallback missing');
  assert.ok(/data-treatment="/.test(html), 'the treatment must be declared on the page');
});

await test('icons are used sparingly and never as the only carrier of meaning', async () => {
  const spec = await composed(BRIEFS[0]!);
  spec.blueprint = 'catalogue-gallery';
  // The specimen carries no contact details by design, so give it a route to
  // icon. Icons annotate real routes; they are never invented for decoration.
  spec.content = Content.parse({ ...spec.content!, contact: { email: 'studio@kiln.example', phone: '+31 10 000 0000' } });
  const html = renderHtml(spec);
  const icons = [...html.matchAll(/class="icon"/g)].length;
  assert.ok(icons > 0, 'a contact section should use icons for its routes');
  assert.ok(icons <= 6, `at most a small consistent set, found ${icons}`);
  // Every icon carries no title: decorative, with the text doing the work.
  const svgs = [...html.matchAll(/<svg[^>]*class="icon"[^>]*>/g)].map((m) => m[0]!);
  for (const s of svgs) assert.ok(/aria-hidden="true"/.test(s), `icon not hidden from AT: ${s.slice(0, 80)}`);
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
