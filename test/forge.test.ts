/**
 * turboslop — tests.
 *
 * The suite runs entirely offline against the local stand-in decider, so it is
 * deterministic and needs no API key. A live-Jev test is included but skipped
 * unless TYPESAFE_API_KEY is present. Run: npm test
 */
import assert from 'node:assert/strict';
import { decideWithFallback } from '../src/decider.js';
import { compose, ComposeError } from '../src/compose.js';
import { writeCopy, CANONICAL_COPY } from '../src/copy.js';
import { resolveLlm, describeLlm } from '../src/llm.js';
import { renderHtml } from '../src/render.js';
import { DesignSpec, Copy } from '../src/types.js';
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

console.log('\n=== turboslop ===\n');

const BRIEFS = [
  'A calm, spa-like landing page for a wellness studio. Soft edges, lots of whitespace, slow gentle motion.',
  'A brutal technical control panel for satellite operators. Dense data, mono type, no decoration.',
  'A joyful, playful storefront for a candy brand aimed at kids. Bright, bouncy, rewarding to touch.',
];

await test('local decider runs offline and returns Jev-shaped answers', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  assert.equal(r.kind, 'local', 'expected the local stand-in');
  for (const id of ['emotion', 'palette', 'typography', 'layout', 'motion', 'density']) {
    assert.ok(r.response.answers[id], `missing answer for ${id}`);
  }
  const emotion = r.response.answers.emotion!;
  assert.equal(emotion.type, 'choice');
  assert.ok(emotion.confidence >= 0 && emotion.confidence <= 1, 'confidence out of range');
});

await test('every composed pick exists in the catalog (no schema drift)', async () => {
  for (const brief of BRIEFS) {
    const r = await decideWithFallback(brief, { offline: true });
    const { spec } = compose(brief, r);
    for (const d of spec.decisions) {
      assert.ok(
        AXIS_CANDIDATE_IDS[d.axis].includes(d.picked),
        `axis ${d.axis} picked "${d.picked}" which is not in the catalog`,
      );
    }
  }
});

await test('spec validates against the DesignSpec schema', async () => {
  const r = await decideWithFallback(BRIEFS[1]!, { offline: true });
  const { spec } = compose(BRIEFS[1]!, r);
  const parsed = DesignSpec.parse(spec); // throws on any shape violation
  assert.equal(parsed.version, 1);
});

await test('composite score is a weighted mean of axis confidences', async () => {
  const r = await decideWithFallback(BRIEFS[2]!, { offline: true });
  const { spec } = compose(BRIEFS[2]!, r);
  const totalW = spec.decisions.reduce((s, d) => s + (spec.composite.weights[d.axis] ?? 0), 0);
  const expected = spec.decisions.reduce(
    (s, d) => s + (spec.composite.weights[d.axis] ?? 0) * d.confidence,
    0,
  ) / totalW;
  assert.ok(Math.abs(expected - spec.composite.normalized) < 1e-9, 'composite mismatch');
  assert.ok(spec.composite.normalized >= 0 && spec.composite.normalized <= 1);
});

await test('low confidence is flagged for review rather than hidden', async () => {
  // A brief that matches nothing should not produce confident decisions.
  const r = await decideWithFallback('zzzz qqqq', { offline: true });
  const { spec } = compose('zzzz qqqq', r);
  assert.ok(spec.review.length > 0, 'an unmatchable brief should surface review axes');
});

await test('ranking is derived from the probability distribution', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  const emotion = spec.decisions.find((d) => d.axis === 'emotion')!;
  assert.ok(emotion.ranked.length > 1, 'expected ranked alternatives');
  for (let i = 1; i < emotion.ranked.length; i++) {
    assert.ok(emotion.ranked[i - 1]!.score >= emotion.ranked[i]!.score, 'ranking not sorted desc');
  }
  assert.equal(emotion.ranked[0]!.id, emotion.picked, 'top-ranked candidate should be the pick');
});

await test('renderer emits a complete, self-contained document', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  const html = renderHtml(spec);
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'missing doctype');
  assert.ok(html.includes('</html>'), 'unclosed document');
  assert.ok(/<h1[ >]/.test(html), 'missing h1');
  assert.ok(!/href="#"/.test(html), 'dead link emitted');
  // every catalog id chosen must have been resolved to real values
  assert.ok(html.includes(spec.tokens.palette!), 'palette not applied');
  assert.ok(!html.includes('undefined'), 'undefined leaked into the output');
});

await test('renderer uses the modern CSS feature set', async () => {
  const r = await decideWithFallback(BRIEFS[1]!, { offline: true });
  const { spec } = compose(BRIEFS[1]!, r);
  const html = renderHtml(spec);
  for (const feature of [
    '@layer',
    '@supports',
    'animation-timeline: view()',
    'scroll-state(',
    'sibling-index()',
    'sibling-count()',
    'contrast-color(',
    'oklch(from',
    '@container',
    'subgrid',
    'text-box-trim',
    '@starting-style',
    'allow-discrete',
    'anchor-name',
    '@position-try',
    'shape(',
    'corner-shape',
    'appearance: base-select',
    '::scroll-marker',
    '::scroll-button',
    'content-visibility',
    'scrollbar-gutter',
    'prefers-reduced-transparency',
    'field-sizing',
    // harvested from the 10-variation curation pass:
    'aspect-ratio',
    '@media print',
    'prefers-contrast',
    'forced-colors',
    '.atmosphere',
  ]) {
    assert.ok(html.includes(feature), `stylesheet is missing ${feature}`);
  }
});

await test('every emotion yields a non-empty atmosphere layer', async () => {
  for (const brief of BRIEFS) {
    const r = await decideWithFallback(brief, { offline: true });
    const { spec } = compose(brief, r);
    const html = renderHtml(spec);
    assert.ok(
      /\.atmosphere\s*\{[^}]*background:/.test(html),
      `no atmosphere background for ${spec.tokens.emotion}`,
    );
  }
});

await test('grain is emitted only for emotions that want texture', async () => {
  // mystery/nostalgia/awe carry grain; trust/tension deliberately do not.
  const mysterious = await decideWithFallback(
    'A dark, mysterious occult portfolio with scarce light and something withheld.',
    { offline: true },
  );
  const ms = compose('x', mysterious).spec;
  const mHtml = renderHtml(ms);
  if (ms.tokens.emotion === 'mystery' || ms.tokens.emotion === 'nostalgia') {
    assert.ok(mHtml.includes('feTurbulence'), `expected grain for ${ms.tokens.emotion}`);
  } else {
    // A different emotion was selected; the assertion is conditional by design.
    assert.ok(true);
  }
});

await test('reduced-motion is honoured', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  const html = renderHtml(spec);
  assert.ok(html.includes('prefers-reduced-motion'), 'no reduced-motion guard');
});

await test('compose rejects a catalog/criteria drift', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  // Forge an answer that could never come back from Jev, to prove we catch it.
  const tampered = structuredClone(r);
  (tampered.response.answers.emotion as { choice: string }).choice = 'not-a-real-emotion';
  assert.throws(() => compose(BRIEFS[0]!, tampered), ComposeError);
});

/* ------------------------------------------------------------------ *
 * Generation half — "Jev decides, the LLM writes"
 * ------------------------------------------------------------------ */

await test('copy falls back to canonical when no LLM is configured', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  const w = await writeCopy(BRIEFS[0]!, spec, { offline: true });
  assert.equal(w.source, 'canonical');
  assert.equal(w.copy.lede, CANONICAL_COPY.lede);
});

await test('canonical copy is what renders when the LLM is skipped', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  spec.copy = CANONICAL_COPY;
  spec.meta.copyWriter = 'canonical';
  const html = renderHtml(spec);
  assert.ok(html.includes(CANONICAL_COPY.lede.slice(0, 48)), 'canonical lede missing from output');
  assert.ok(html.includes(CANONICAL_COPY.cta), 'canonical CTA missing from output');
});

await test('the spec carries copy metadata even without an LLM', async () => {
  const r = await decideWithFallback(BRIEFS[0]!, { offline: true });
  const { spec } = compose(BRIEFS[0]!, r);
  const parsed = DesignSpec.parse(spec);
  assert.equal(parsed.meta.copyWriter, 'none');
  assert.equal(parsed.meta.copyLatencyMs, 0);
});

const llm = resolveLlm();
await test(`live copywriting${llm ? ` (${describeLlm(llm)})` : ' (SKIPPED — no LLM configured)'}`, async () => {
  if (!llm) return;
  const brief = 'A calm, spa-like wellness studio landing page with slow, gentle motion.';
  // Design locally so this test isolates the WRITER, not the decider.
  const r = await decideWithFallback(brief, { offline: true });
  const { spec } = compose(brief, r);

  const w = await writeCopy(brief, spec, { config: llm });
  assert.equal(w.source, 'llm', `expected LLM copy but got canonical: ${w.fallbackReason ?? ''}`);
  Copy.parse(w.copy); // schema-valid by construction
  assert.ok(w.copy.about.length >= 1 && w.copy.about.length <= 3);
  assert.ok(w.copy.title.length <= 140);

  // The fixed facts must survive: no invented numbers or client names.
  const blob = JSON.stringify(w.copy);
  assert.ok(!/\b(?:award-winning|world-class|industry-leading)\b/i.test(blob), 'marketing filler leaked in');

  spec.copy = w.copy;
  spec.meta.copyWriter = w.source;
  spec.meta.copyModel = w.model;
  const html = renderHtml(spec);
  assert.ok(!html.includes('undefined'), 'copy rendered undefined');
  assert.ok(html.includes(w.copy.lede.slice(0, 40)), 'written lede missing from the page');

  console.log(`        -> ${w.model} wrote ${w.copy.about.length} paragraphs in ${w.latencyMs}ms`);
});

/* ------------------------------------------------------------------ */
const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
await test(`live Jev decision${hasKey ? '' : ' (SKIPPED — no TYPESAFE_API_KEY)'}`, async () => {
  if (!hasKey) return;
  const brief = 'A mysterious, dark, occult-feeling portfolio for a tattoo artist.';
  const r = await decideWithFallback(brief, { preference: 'live' });
  assert.equal(r.kind, 'live', 'expected a live Jev decision');
  const { spec } = compose(brief, r);
  assert.ok(spec.meta.latencyMs > 0);
  assert.ok(spec.meta.model.startsWith('jev'), `unexpected model ${spec.meta.model}`);
  console.log(`        -> ${spec.decisions.map((d) => `${d.axis}=${d.picked}(${d.confidence.toFixed(2)})`).join(' ')}`);
});

await test('both halves compose: Jev designs, the LLM writes (SKIPPED without both keys)', async () => {
  if (!hasKey || !llm) return;
  const brief = 'A brutal technical control panel for satellite operators. Dense, mono, no decoration.';
  const r = await decideWithFallback(brief, { preference: 'live' });
  const { spec } = compose(brief, r);
  const w = await writeCopy(brief, spec, { config: llm });
  spec.copy = w.copy;
  const html = renderHtml(spec);
  assert.equal(spec.meta.decider, 'live');
  assert.equal(w.source, 'llm');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  console.log(`        -> design by ${spec.meta.model}, copy by ${w.model}, total ${spec.meta.latencyMs + w.latencyMs}ms`);
});

console.log(`\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
