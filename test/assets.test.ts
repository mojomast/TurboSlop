/**
 * TurboSlop — asset module tests (frames + icons).
 *
 * Entirely offline and pure: both modules are string generators, so these tests
 * pin their contracts — escaping, determinism, the ratio/inset numbers, and the
 * consistency of the icon family — without touching the DOM or the network.
 *
 * Run: npx tsx test/assets.test.ts
 */
import assert from 'node:assert/strict';
import {
  FRAME_KINDS,
  frameForLead,
  frameInset,
  renderFrame,
  type FrameKind,
} from '../src/frames.js';
import {
  ICON_FAMILIES,
  ICON_LICENSE,
  ICON_LICENSES,
  ICON_NAMES,
  ICON_PROFILES,
  ICON_ROLES,
  ICON_ROLE_GLYPHS,
  LUCIDE_LICENSE,
  hasIcon,
  hasIconIn,
  iconNamesFor,
  renderIcon,
  resolveIconRole,
  type IconFamily,
  type IconName,
} from '../src/icons.js';
import {
  LUCIDE_GLYPHS,
  LUCIDE_ICON_NAMES,
  LUCIDE_COMMIT,
} from '../src/iconpacks.js';
import { BLUEPRINT_BY_ID } from '../src/blueprint.js';
import {
  MAX_ICONS,
  iconsFor,
  validateVisualBlueprint,
  visualBlueprintFor,
} from '../src/visual.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LEADS } from '../src/blueprint.js';
import { EMOTIONS } from '../src/catalog.js';

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

console.log('\n=== TurboSlop assets ===\n');

const INNER = '<div class="plate" aria-hidden="true"></div>';
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/* ================================================================== *
 * Frames
 * ================================================================== */
await test('every frame kind renders a non-empty html string', () => {
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: INNER });
    assert.equal(f.kind, kind);
    assert.equal(typeof f.html, 'string');
    assert.ok(f.html.length > 0, `${kind} rendered nothing`);
  }
});

await test('every kind contains the exact inner string exactly once', () => {
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: INNER });
    assert.equal(count(f.html, INNER), 1, `${kind} inner count`);
  }
});

await test('inner is never escaped or transformed', () => {
  const tricky = '<span data-x="1">A &amp; B</span>';
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: tricky });
    assert.equal(count(f.html, tricky), 1, `${kind} mangled inner`);
  }
});

await test('every frame starts with a sensible figure or div tag', () => {
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: INNER });
    assert.ok(/^<(figure|div)\b/.test(f.html), `${kind} started with ${f.html.slice(0, 12)}`);
  }
});

await test('no frame emits undefined or NaN for any seed', () => {
  for (const kind of FRAME_KINDS) {
    for (const seed of [undefined, 0, 7, 12345]) {
      const f = renderFrame({ kind, inner: INNER, seed });
      assert.ok(!f.html.includes('undefined'), `${kind} seed=${seed} leaked undefined`);
      assert.ok(!f.html.includes('NaN'), `${kind} seed=${seed} leaked NaN`);
      assert.ok(!f.role.includes('undefined'), `${kind} role undefined`);
      assert.ok(!f.ratio.includes('undefined') && !f.ratio.includes('NaN'), `${kind} bad ratio`);
    }
  }
});

await test('a hostile label is escaped, not injected', () => {
  const hostile = '<script>alert("x")</script>';
  const f = renderFrame({ kind: 'browser', inner: INNER, label: hostile });
  assert.ok(!f.html.includes('<script>'), 'raw script tag leaked into a frame');
  assert.ok(f.html.includes('&lt;script&gt;'), 'label was not escaped');
  assert.ok(f.html.includes('&quot;x&quot;'), 'quotes were not escaped');
});

await test('frames are deterministic for a fixed seed', () => {
  const a = renderFrame({ kind: 'ticket', inner: INNER, label: 'Gala', seed: 42 });
  const b = renderFrame({ kind: 'ticket', inner: INNER, label: 'Gala', seed: 42 });
  assert.equal(a.html, b.html, 'same seed produced different markup');
  const c = renderFrame({ kind: 'ticket', inner: INNER, label: 'Gala', seed: 43 });
  assert.notEqual(a.html, c.html, 'seed did not affect the decorative detail');
});

await test('every kind applies a usable default ratio', () => {
  const seen = new Set<string>();
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: INNER });
    assert.equal(typeof f.ratio, 'string');
    assert.ok(f.ratio.includes('/'), `${kind} ratio "${f.ratio}" is malformed`);
    assert.ok(f.html.includes('--ratio:'), `${kind} ratio was not applied to the markup`);
    seen.add(f.ratio);
  }
  assert.ok(seen.size >= 5, `expected varied default ratios, got ${seen.size}`);
});

await test('an explicit ratio overrides the default', () => {
  const f = renderFrame({ kind: 'browser', inner: INNER, ratio: '21 / 9' });
  assert.equal(f.ratio, '21 / 9');
  assert.ok(f.html.includes('--ratio:21 / 9'), 'explicit ratio not applied');
});

await test('an unknown frame kind throws a clear error', () => {
  assert.throws(
    () => renderFrame({ kind: 'hologram' as FrameKind, inner: INNER }),
    /Unknown frame kind/,
  );
});

await test('each kind declares a unique role and marks its kind in the markup', () => {
  const roles = new Set<string>();
  for (const kind of FRAME_KINDS) {
    const f = renderFrame({ kind, inner: INNER });
    assert.ok(f.role.length > 10, `${kind} role too vague`);
    assert.ok(f.html.includes(`frame--${kind}`), `${kind} class missing`);
    roles.add(f.role);
  }
  assert.equal(roles.size, FRAME_KINDS.length, 'two kinds share a role');
});

await test('frame colour comes from palette custom properties with fallbacks', () => {
  const all = FRAME_KINDS.map((k) => renderFrame({ kind: k, inner: INNER }).html).join('\n');
  for (const token of ['var(--fg,', 'var(--accent,', 'var(--hair,', 'var(--bg-raised,']) {
    assert.ok(all.includes(token), `no frame uses ${token}`);
  }
  for (const kind of FRAME_KINDS) {
    const html = renderFrame({ kind, inner: INNER }).html;
    if (kind === 'plain') {
      // The honest fallback is deliberately bare: no ornament, so no colour.
      assert.ok(!/var\(--[a-z-]+,\s*[^)]+\)/.test(html), 'plain must stay unadorned');
      continue;
    }
    assert.ok(/var\(--[a-z-]+,\s*[^)]+\)/.test(html), `${kind} has no palette var with fallback`);
  }
});

await test('frameForLead is total for every lead and emotion', () => {
  for (const lead of LEADS) {
    for (const emotion of EMOTIONS) {
      const kind = frameForLead(lead, emotion.id);
      assert.ok(FRAME_KINDS.includes(kind), `${lead}/${emotion.id} -> ${kind}`);
    }
  }
});

await test('frameForLead still returns a valid kind for unknown input', () => {
  assert.ok(FRAME_KINDS.includes(frameForLead('nonsense', 'nonsense')));
  assert.ok(FRAME_KINDS.includes(frameForLead('', '')));
  assert.ok(FRAME_KINDS.includes(frameForLead('product', 'not-an-emotion')));
});

await test('frameInset is a real per-kind number in 0..1 with plain the maximum', () => {
  let max = -1;
  let maxKind: FrameKind | '' = '';
  for (const kind of FRAME_KINDS) {
    const v = frameInset(kind);
    assert.ok(v > 0 && v <= 1, `${kind} inset ${v} out of range`);
    if (v > max) {
      max = v;
      maxKind = kind;
    }
  }
  assert.equal(maxKind, 'plain', 'plain must be the maximum inset');
});

await test('frameInset values are distinct per kind', () => {
  const values = FRAME_KINDS.map(frameInset);
  assert.equal(new Set(values).size, FRAME_KINDS.length, 'two kinds share an inset');
});

/* ================================================================== *
 * Icons
 * ================================================================== */
await test('every icon name renders a standalone svg', () => {
  for (const name of ICON_NAMES) {
    const svg = renderIcon(name);
    assert.ok(svg.startsWith('<svg'), `${name} does not start with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${name} does not end with </svg>`);
  }
});

await test('no icon emits undefined or NaN, with or without options', () => {
  for (const name of ICON_NAMES) {
    for (const opts of [undefined, { size: 32 }, { title: 'A "quote" & <thing>' }]) {
      const svg = renderIcon(name, opts);
      assert.ok(!svg.includes('undefined'), `${name} leaked undefined`);
      assert.ok(!svg.includes('NaN'), `${name} leaked NaN`);
    }
  }
});

await test('hasIcon recognises every declared name and rejects others', () => {
  for (const name of ICON_NAMES) assert.ok(hasIcon(name), `hasIcon(${name}) false`);
  assert.ok(!hasIcon('not-an-icon'));
  assert.ok(!hasIcon('constructor'));
  assert.ok(!hasIcon(''));
});

await test('a title makes an icon labelled and not hidden', () => {
  const svg = renderIcon('star', { title: 'Favourite' });
  assert.ok(svg.includes('<title>Favourite</title>'), 'title element missing');
  assert.ok(svg.includes('role="img"'), 'role=img missing');
  assert.ok(!svg.includes('aria-hidden'), 'labelled icon must not be aria-hidden');
});

await test('an icon without a title is hidden from assistive tech', () => {
  const svg = renderIcon('star');
  assert.ok(svg.includes('aria-hidden="true"'), 'decorative icon must be aria-hidden');
  assert.ok(!svg.includes('<title>'), 'unexpected title element');
  assert.ok(!svg.includes('role="img"'), 'unexpected role=img');
});

await test('the icon title is escaped', () => {
  const svg = renderIcon('info', { title: '<x> & "y"' });
  assert.ok(svg.includes('&lt;x&gt; &amp; &quot;y&quot;'), 'title not escaped');
  assert.ok(!svg.includes('<x>'), 'raw markup leaked from the title');
});

await test('every icon shares the same stroke width (family guarantee)', () => {
  const widths = new Set<string>();
  for (const name of ICON_NAMES) {
    const m = /stroke-width="([\d.]+)"/.exec(renderIcon(name));
    assert.ok(m, `${name} has no stroke-width`);
    widths.add(m![1]!);
  }
  assert.equal(widths.size, 1, `mixed stroke widths: ${[...widths].join(', ')}`);
  assert.equal([...widths][0], '1.6', 'family stroke width must be 1.6');
});

await test('every icon shares round caps and joins', () => {
  for (const name of ICON_NAMES) {
    const svg = renderIcon(name);
    assert.ok(svg.includes('stroke-linecap="round"'), `${name} lacks round cap`);
    assert.ok(svg.includes('stroke-linejoin="round"'), `${name} lacks round join`);
  }
});

await test('every viewBox is the same 24 by 24 grid', () => {
  for (const name of ICON_NAMES) {
    const m = /viewBox="([^"]+)"/.exec(renderIcon(name));
    assert.ok(m, `${name} has no viewBox`);
    assert.equal(m![1]!, '0 0 24 24', `${name} viewBox is ${m![1]}`);
  }
});

await test('every icon uses currentColor, no fill, and is not focusable', () => {
  for (const name of ICON_NAMES) {
    const svg = renderIcon(name);
    assert.ok(svg.includes('stroke="currentColor"'), `${name} not currentColor`);
    assert.ok(svg.includes('fill="none"'), `${name} is not an outline`);
    assert.ok(svg.includes('focusable="false"'), `${name} is focusable`);
  }
});

await test('icon names are unique and numerous', () => {
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length, 'duplicate icon name');
  assert.ok(ICON_NAMES.length >= 20, `expected ~20 icons, got ${ICON_NAMES.length}`);
});

await test('every icon stays under the byte ceiling', () => {
  for (const name of ICON_NAMES) {
    const bytes = Buffer.byteLength(renderIcon(name), 'utf8');
    assert.ok(bytes < 600, `${name} is ${bytes} bytes`);
  }
});

await test('size adds width/height; leaving it out keeps the icon scalable', () => {
  const sized = renderIcon('check', { size: 20 });
  assert.ok(sized.includes('width="20"') && sized.includes('height="20"'), 'size ignored');
  const bare = renderIcon('check');
  assert.ok(!/\swidth="/.test(bare), 'unexpected width attribute');
  assert.ok(!/\sheight="/.test(bare), 'unexpected height attribute');
});

await test('an unknown icon name throws', () => {
  assert.throws(() => renderIcon('nope' as IconName), /Unknown icon/);
});

await test('the icon licence records original MIT work', () => {
  assert.equal(ICON_LICENSE.spdx, 'MIT');
  assert.ok(ICON_LICENSE.name.length > 0, 'licence name missing');
  assert.ok(/original/i.test(ICON_LICENSE.origin), 'origin must state originality');
  assert.ok(/TurboSlop/i.test(ICON_LICENSE.origin), 'origin must name the project');
});

/* ================================================================== *
 * Icons — the vendored Lucide family
 * ================================================================== */
await test('both families parse every declared glyph', () => {
  for (const family of ICON_FAMILIES) {
    const names = iconNamesFor(family);
    assert.ok(names.length > 0, `${family} declares no glyphs`);
    for (const name of names) {
      const svg = renderIcon(name, family);
      assert.ok(svg.startsWith('<svg'), `${family}/${name} does not start with <svg`);
      assert.ok(svg.endsWith('</svg>'), `${family}/${name} does not end with </svg>`);
    }
  }
  assert.ok(LUCIDE_ICON_NAMES.length >= 60, `expected a larger second vocabulary, got ${LUCIDE_ICON_NAMES.length}`);
  assert.ok(LUCIDE_ICON_NAMES.length <= 80, `allowlist grew past its curation budget: ${LUCIDE_ICON_NAMES.length}`);
});

await test('both families declare and render the same 24-grid outline profile', () => {
  for (const family of ICON_FAMILIES) {
    const p = ICON_PROFILES[family];
    assert.equal(p.grid, 24, `${family} grid`);
    assert.equal(p.stroke, 1.6, `${family} stroke`);
    assert.equal(p.linecap, 'round', `${family} linecap`);
    assert.equal(p.linejoin, 'round', `${family} linejoin`);
    assert.equal(p.fill, 'none', `${family} fill`);
    assert.equal(p.color, 'currentColor', `${family} colour`);
    for (const name of iconNamesFor(family)) {
      const svg = renderIcon(name, family);
      assert.equal(/viewBox="([^"]+)"/.exec(svg)?.[1], '0 0 24 24', `${family}/${name} viewBox`);
      assert.ok(svg.includes('stroke-width="1.6"'), `${family}/${name} stroke width`);
      assert.ok(svg.includes('stroke-linecap="round"'), `${family}/${name} cap`);
      assert.ok(svg.includes('stroke-linejoin="round"'), `${family}/${name} join`);
      assert.ok(svg.includes('fill="none"'), `${family}/${name} not an outline`);
      assert.ok(svg.includes('stroke="currentColor"'), `${family}/${name} not currentColor`);
      assert.ok(svg.includes('focusable="false"'), `${family}/${name} focusable`);
      assert.ok(svg.includes('aria-hidden="true"'), `${family}/${name} not decorative by default`);
      assert.ok(!svg.includes('undefined') && !svg.includes('NaN'), `${family}/${name} leaked undefined/NaN`);
    }
  }
  assert.equal(new Set(LUCIDE_ICON_NAMES).size, LUCIDE_ICON_NAMES.length, 'duplicate Lucide glyph name');
});

await test('no glyph in any family carries scripts, events or external references', () => {
  const sources: string[] = [];
  for (const family of ICON_FAMILIES) {
    for (const name of iconNamesFor(family)) sources.push(renderIcon(name, family));
  }
  for (const name of LUCIDE_ICON_NAMES) sources.push(LUCIDE_GLYPHS[name].body);
  for (const source of sources) {
    assert.ok(!/<(script|style|use|defs|image|mask|clipPath|foreignObject)/i.test(source), `forbidden element in ${source.slice(0, 60)}`);
    assert.ok(!/\son[a-z]+\s*=/i.test(source), `event handler in ${source.slice(0, 60)}`);
    assert.ok(!/[\s"']href\s*=|\sxlink:href\s*=/.test(source), `external ref in ${source.slice(0, 60)}`);
    assert.ok(!/url\s*\(/i.test(source), `url() in ${source.slice(0, 60)}`);
    assert.ok(!/javascript:/i.test(source), `javascript: in ${source.slice(0, 60)}`);
    assert.ok(!/NaN|Infinity/.test(source), `non-finite value in ${source.slice(0, 60)}`);
  }
});

await test('the Lucide licence document names the family, the file and the ISC notice', async () => {
  const md = await readFile(fileURLToPath(new URL('../public/icons/LICENSES.md', import.meta.url)), 'utf8');
  assert.ok(/ISC License/.test(md), 'verbatim ISC text missing');
  assert.ok(/Permission to use, copy, modify, and\/or distribute this software/.test(md), 'ISC grant missing');
  assert.ok(md.includes(LUCIDE_COMMIT), 'pinned commit missing');
  assert.ok(md.includes('lucide-icons/lucide'), 'source URL missing');
  assert.ok(md.includes('src/iconpacks.ts'), 'generated data file not named');
  assert.ok(md.includes('Lucide'), 'family not named');
  for (const name of LUCIDE_ICON_NAMES) {
    assert.ok(md.includes(`\`${name}\``), `licence document omits glyph ${name}`);
  }
  assert.equal(LUCIDE_LICENSE.spdx, 'ISC');
  assert.equal(LUCIDE_LICENSE.licenseFile, 'public/icons/LICENSES.md');
  assert.equal(LUCIDE_LICENSE.commit, LUCIDE_COMMIT);
  assert.ok(/Lucide/i.test(LUCIDE_LICENSE.origin), 'licence origin must name Lucide');
  for (const family of ICON_FAMILIES) {
    assert.equal(ICON_LICENSES[family].spdx, ICON_PROFILES[family].license.spdx, `${family} licence drift`);
  }
});

await test('every icon role has curated candidates that resolve per family', () => {
  for (const family of ICON_FAMILIES) {
    const names = iconNamesFor(family);
    for (const role of ICON_ROLES) {
      const candidates = ICON_ROLE_GLYPHS[family][role];
      assert.ok(candidates.length >= 1, `${family}/${role} has no candidates`);
      for (const c of candidates) {
        assert.ok(hasIconIn(family, c), `${family}/${role} candidate ${c} does not resolve`);
        assert.ok(names.includes(c), `${family}/${role} candidate ${c} is not declared`);
      }
      assert.ok(resolveIconRole(family, role, names), `${family}/${role} does not resolve`);
    }
    // The vendored family is the one with a real choice per meaning.
    if (family === 'lucide') {
      for (const role of ICON_ROLES) {
        const n = ICON_ROLE_GLYPHS[family][role].length;
        assert.ok(n >= 2 && n <= 3, `lucide/${role} has ${n} candidates; expected 2-3`);
      }
    }
    assert.equal(resolveIconRole(family, 'contact-email', []), null, `${family} must draw nothing with an empty allowlist`);
  }
  // The generated plan may only use roles this module declares.
  for (const name of LUCIDE_ICON_NAMES) {
    for (const role of LUCIDE_GLYPHS[name].roles) {
      assert.ok((ICON_ROLES as readonly string[]).includes(role), `${name} declares unknown role ${role}`);
    }
  }
});

await test('every iconsFor result is deterministic per seed and resolves in its family', () => {
  const blueprints = Object.values(BLUEPRINT_BY_ID);
  assert.ok(blueprints.length > 0, 'no blueprints to test');
  for (const bp of blueprints) {
    for (let seed = 1; seed <= 40; seed++) {
      const a = iconsFor(bp, seed);
      const b = iconsFor(bp, seed);
      assert.deepEqual(a, b, `iconsFor(${bp.id}, ${seed}) is not deterministic`);
      assert.ok(ICON_FAMILIES.includes(a.family), `iconsFor(${bp.id}, ${seed}) unknown family ${a.family}`);
      assert.ok(a.icons.length <= MAX_ICONS, `iconsFor(${bp.id}, ${seed}) has ${a.icons.length} icons`);
      assert.equal(new Set(a.icons).size, a.icons.length, `iconsFor(${bp.id}, ${seed}) repeats a glyph`);
      for (const name of a.icons) {
        assert.ok(hasIconIn(a.family, name), `iconsFor(${bp.id}, ${seed}): ${name} is not in ${a.family}`);
      }
    }
  }
});

await test('both families are reachable and a page never mixes them', () => {
  const bp = BLUEPRINT_BY_ID['catalogue-gallery']!;
  const seen = new Set<string>();
  for (let seed = 1; seed <= 120; seed++) {
    const selection = iconsFor(bp, seed);
    seen.add(selection.family);
    const other = ICON_FAMILIES.find((f) => f !== selection.family)!;
    for (const name of selection.icons) {
      assert.ok(hasIconIn(selection.family, name), `${seed}: ${name} not in chosen ${selection.family}`);
      if (!hasIconIn(other, name)) {
        assert.throws(() => renderIcon(name, other), /Unknown icon/, `${seed}: ${name} must not render in ${other}`);
      }
    }
    const vb = visualBlueprintFor({
      blueprint: bp,
      typefaceId: 'grotesk-tight',
      emotion: 'serenity',
      density: 'balanced',
      seed,
      accent: '#5f7263',
      ground: '#f7f4ee',
    });
    assert.deepEqual(validateVisualBlueprint(vb), [], `seed ${seed}: derived blueprint invalid`);
    assert.equal(vb.iconFamily, selection.family, `seed ${seed}: blueprint and selection disagree`);
    for (const name of vb.icons) assert.ok(hasIconIn(vb.iconFamily, name), `seed ${seed}: ${name} foreign`);
  }
  assert.deepEqual([...seen].sort(), [...ICON_FAMILIES].sort(), 'both families must be reachable across seeds');
});

await test('a renamed or unknown glyph is rejected by validation', () => {
  const bp = BLUEPRINT_BY_ID['catalogue-gallery']!;
  const vb = visualBlueprintFor({
    blueprint: bp,
    typefaceId: 'grotesk-tight',
    emotion: 'serenity',
    density: 'balanced',
    seed: 7,
    accent: '#5f7263',
    ground: '#f7f4ee',
  });
  assert.deepEqual(validateVisualBlueprint(vb), [], 'the baseline blueprint must be valid');

  const renamed = { ...vb, icons: [...vb.icons, 'telephone-fax'] };
  assert.ok(validateVisualBlueprint(renamed).some((i) => i.rule === 'icon'), 'a renamed glyph must be rejected');

  const foreign = vb.iconFamily === 'lucide' ? 'close' : 'at-sign';
  assert.ok(!hasIconIn(vb.iconFamily, foreign), `${foreign} should be foreign to ${vb.iconFamily}`);
  const crossFamily = { ...vb, icons: [foreign] };
  assert.ok(validateVisualBlueprint(crossFamily).some((i) => i.rule === 'icon'), `${foreign} must not cross families`);

  const unknownFamily = { ...vb, iconFamily: 'material' as IconFamily };
  assert.ok(validateVisualBlueprint(unknownFamily).some((i) => i.rule === 'icon-family'), 'an unknown family must be rejected');

  const tooMany = { ...vb, icons: [...vb.icons, ...iconNamesFor(vb.iconFamily)].slice(0, MAX_ICONS + 1) };
  assert.ok(validateVisualBlueprint(tooMany).some((i) => i.rule === 'icon-count'), 'the six-icon cap must be enforced');
});

console.log(
  `\n${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`,
);
process.exit(failed ? 1 : 0);
