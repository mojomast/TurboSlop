#!/usr/bin/env node
/**
 * TurboSlop — vendor the curated Lucide icon family.
 *
 * Why a script: exported pages must not make a remote request, and the repo
 * holds a zero-runtime-dependency line — an icon library is never imported at
 * render time. Instead a small, explicit allowlist of Lucide (ISC) glyphs is
 * fetched from a PINNED commit, validated, stripped of presentation and
 * re-emitted as generated TypeScript data (`src/iconpacks.ts`) next to a licence
 * document (`public/icons/LICENSES.md`) that carries the upstream ISC notice
 * verbatim.
 *
 * What "vendored" means here:
 *   - the URL is immutable:
 *     https://raw.githubusercontent.com/lucide-icons/lucide/<commit>/icons/<name>.svg
 *   - only names on the allowlist are requested — never a glob or a listing;
 *   - every file is validated before it is used: allowlisted elements only,
 *     hard rejection of script/style/use/defs/image/mask/clipPath/foreignObject,
 *     of `on*`, `href`, `xlink:href` and `url(`, and of non-finite numbers;
 *   - the declared `viewBox` must be the house 24-grid;
 *   - presentation attributes are stripped, so the house wrapper owns stroke,
 *     fill, caps and joins and a family stays visually consistent;
 *   - the sha256 of each upstream file is recorded in the generated module.
 *
 * Idempotence: the output is a pure function of (pinned commit, allowlist), so
 * re-running produces byte-identical files. Without `--refresh`, an existing
 * generated module that already records this commit and allowlist signature is
 * verified and left untouched — no network needed.
 *
 * Run:
 *   npx tsx scripts/fetch-icons.ts            # fetch anything missing
 *   npx tsx scripts/fetch-icons.ts --refresh  # re-fetch and re-validate every glyph
 *
 * Exits non-zero if the allowlist cannot be fetched or fails validation. It
 * never writes a partial pack.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK_PATH = path.join(ROOT, 'src/iconpacks.ts');
const ICON_DIR = path.join(ROOT, 'public/icons');
const LICENSES_PATH = path.join(ICON_DIR, 'LICENSES.md');

/* ------------------------------------------------------------------ *
 * The pin
 * ------------------------------------------------------------------ */
/** Upstream repository, exactly as it appears in the raw URL. */
const UPSTREAM_REPO = 'lucide-icons/lucide';
/** Release the commit below belongs to; recorded in the generated header. */
const UPSTREAM_VERSION = '1.47.0';
/** Full commit SHA — never a branch, never a tag ref by name. */
const COMMIT = '3b9ea6d08707edc439f25a4c354cb0d6b8bee973';
const SOURCE = `https://github.com/${UPSTREAM_REPO}`;
const RAW_ICON_BASE = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${COMMIT}/icons`;
const LICENSE_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${COMMIT}/LICENSE`;
const SPDX = 'ISC';

/** A normal browser UA keeps a CDN from serving an HTML interstitial. */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ *
 * The allowlist
 *
 * Curated by module semantics (the category names below). Every name exists
 * at the pinned commit; the list is deliberately small — one clear glyph per
 * meaning, never a bulk dump. `roles` is the house vocabulary an icon can
 * fulfil where a block draws it (see ICON_ROLES in src/icons.ts); a glyph with
 * no role is vocabulary the allowlist holds for a future block.
 * ------------------------------------------------------------------ */
const CATEGORIES = [
  'navigation',
  'contact',
  'commerce',
  'content',
  'data',
  'process',
  'trust',
  'decoration',
] as const;
type Category = (typeof CATEGORIES)[number];

/** Keep in sync with ICON_ROLES in src/icons.ts; test/assets.test.ts enforces it. */
const ROLES = [
  'contact-email',
  'contact-phone',
  'contact-address',
  'schedule-date',
  'schedule-time',
  'pricing-included',
  'faq-answer',
  'gallery-link',
  'nav-cta',
] as const;
type Role = (typeof ROLES)[number];

interface GlyphEntry {
  name: string;
  category: Category;
  roles: Role[];
}

const PACK: GlyphEntry[] = [
  /* navigation — moving around a page or out of it */
  { name: 'house', category: 'navigation', roles: [] },
  { name: 'menu', category: 'navigation', roles: [] },
  { name: 'arrow-right', category: 'navigation', roles: ['nav-cta'] },
  { name: 'arrow-up-right', category: 'navigation', roles: ['gallery-link'] },
  { name: 'chevron-right', category: 'navigation', roles: ['nav-cta'] },
  { name: 'chevron-down', category: 'navigation', roles: [] },
  { name: 'external-link', category: 'navigation', roles: ['gallery-link'] },
  { name: 'expand', category: 'navigation', roles: ['gallery-link'] },
  { name: 'move-right', category: 'navigation', roles: ['nav-cta'] },

  /* contact — the real routes a stranger can use */
  { name: 'mail', category: 'contact', roles: ['contact-email'] },
  { name: 'at-sign', category: 'contact', roles: ['contact-email'] },
  { name: 'send', category: 'contact', roles: ['contact-email'] },
  { name: 'phone', category: 'contact', roles: ['contact-phone'] },
  { name: 'phone-call', category: 'contact', roles: ['contact-phone'] },
  { name: 'smartphone', category: 'contact', roles: ['contact-phone'] },
  { name: 'map-pin', category: 'contact', roles: ['contact-address'] },
  { name: 'map-pinned', category: 'contact', roles: ['contact-address'] },
  { name: 'navigation', category: 'contact', roles: ['contact-address'] },

  /* commerce — a price, a package, a way to pay */
  { name: 'shopping-bag', category: 'commerce', roles: [] },
  { name: 'shopping-cart', category: 'commerce', roles: [] },
  { name: 'credit-card', category: 'commerce', roles: [] },
  { name: 'tag', category: 'commerce', roles: [] },
  { name: 'receipt-text', category: 'commerce', roles: [] },
  { name: 'package', category: 'commerce', roles: [] },
  { name: 'truck', category: 'commerce', roles: [] },
  { name: 'banknote', category: 'commerce', roles: [] },

  /* content — writing, reading, publishing, answering */
  { name: 'file-text', category: 'content', roles: [] },
  { name: 'book-open', category: 'content', roles: [] },
  { name: 'pen-line', category: 'content', roles: [] },
  { name: 'quote', category: 'content', roles: [] },
  { name: 'image', category: 'content', roles: [] },
  { name: 'download', category: 'content', roles: [] },
  { name: 'newspaper', category: 'content', roles: [] },
  { name: 'message-square', category: 'content', roles: [] },
  { name: 'messages-square', category: 'content', roles: ['faq-answer'] },
  { name: 'circle-question-mark', category: 'content', roles: ['faq-answer'] },

  /* data — figures, tables, trends */
  { name: 'chart-line', category: 'data', roles: [] },
  { name: 'chart-bar', category: 'data', roles: [] },
  { name: 'chart-pie', category: 'data', roles: [] },
  { name: 'database', category: 'data', roles: [] },
  { name: 'table', category: 'data', roles: [] },
  { name: 'calculator', category: 'data', roles: [] },
  { name: 'trending-up', category: 'data', roles: [] },
  { name: 'activity', category: 'data', roles: [] },

  /* process — time, steps, sequence */
  { name: 'clock', category: 'process', roles: ['schedule-time'] },
  { name: 'timer', category: 'process', roles: ['schedule-time'] },
  { name: 'calendar', category: 'process', roles: ['schedule-date'] },
  { name: 'calendar-days', category: 'process', roles: ['schedule-date'] },
  { name: 'workflow', category: 'process', roles: [] },
  { name: 'list-checks', category: 'process', roles: [] },
  { name: 'git-branch', category: 'process', roles: [] },
  { name: 'refresh-cw', category: 'process', roles: [] },

  /* trust — guarantees, credentials, people */
  { name: 'shield', category: 'trust', roles: [] },
  { name: 'shield-check', category: 'trust', roles: [] },
  { name: 'lock', category: 'trust', roles: [] },
  { name: 'key', category: 'trust', roles: [] },
  { name: 'badge-check', category: 'trust', roles: ['pricing-included'] },
  { name: 'circle-check', category: 'trust', roles: ['pricing-included'] },
  { name: 'check', category: 'trust', roles: ['pricing-included'] },
  { name: 'award', category: 'trust', roles: [] },
  { name: 'users', category: 'trust', roles: [] },

  /* decoration — the few marks a page may use as pure ornament */
  { name: 'sparkles', category: 'decoration', roles: [] },
  { name: 'star', category: 'decoration', roles: [] },
  { name: 'heart', category: 'decoration', roles: [] },
  { name: 'sun', category: 'decoration', roles: [] },
  { name: 'moon', category: 'decoration', roles: [] },
  { name: 'leaf', category: 'decoration', roles: [] },
  { name: 'zap', category: 'decoration', roles: [] },
  { name: 'flower', category: 'decoration', roles: [] },
];

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */
/** Elements the house wrapper can own. Everything else is rejected. */
const ALLOWED_ELEMENTS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g']);
/** Named rejections, so the error explains itself rather than "unknown element". */
const FORBIDDEN_ELEMENTS = new Set(['script', 'style', 'use', 'defs', 'image', 'mask', 'clippath', 'foreignobject']);
/** Presentation/identity attributes are dropped: the wrapper decides them. */
const GEOMETRY_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height',
  'points', 'x1', 'y1', 'x2', 'y2', 'transform',
]);
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR_RE = /\s+([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
const NUMBER_RE = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;

interface Tag {
  closing: boolean;
  name: string;
  attrs: Array<{ name: string; value: string }>;
  selfClosing: boolean;
}

function parseAttrs(text: string): Tag['attrs'] {
  const out: Tag['attrs'] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(text)) !== null) out.push({ name: m[1]!, value: m[2]! });
  return out;
}

function parseTags(name: string, svg: string): Tag[] {
  const tags: Tag[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(svg)) !== null) {
    tags.push({ closing: m[1] === '/', name: m[2]!, attrs: parseAttrs(m[3] ?? ''), selfClosing: m[4] === '/' });
  }
  const text = svg.replace(TAG_RE, '').trim();
  if (text !== '') throw new Error(`${name}: unexpected text content ${JSON.stringify(text.slice(0, 40))}`);
  return tags;
}

/** Reject anything the family rule forbids, and return only geometry attrs. */
function safeAttrs(name: string, tag: Tag): Tag['attrs'] {
  for (const a of tag.attrs) {
    const lower = a.name.toLowerCase();
    if (lower.startsWith('on')) throw new Error(`${name}: event handler attribute ${a.name}`);
    if (lower === 'href' || lower.endsWith(':href')) throw new Error(`${name}: external reference ${a.name}`);
    if (/url\s*\(/i.test(a.value)) throw new Error(`${name}: url() reference in ${a.name}`);
    if (/javascript:/i.test(a.value)) throw new Error(`${name}: javascript: URL in ${a.name}`);
    if (/nan|infinity/i.test(a.value)) throw new Error(`${name}: non-finite number in ${a.name}`);
    for (const token of a.value.match(NUMBER_RE) ?? []) {
      if (!Number.isFinite(Number(token))) throw new Error(`${name}: non-finite number "${token}" in ${a.name}`);
    }
  }
  return tag.attrs.filter((a) => a.name === a.name.toLowerCase() && GEOMETRY_ATTRS.has(a.name));
}

interface VendoredGlyph {
  entry: GlyphEntry;
  /** sha256 of the upstream SVG file, exactly as fetched. */
  sha256: string;
  /** Inner geometry, presentation stripped, canonical `/>` spelling. */
  body: string;
}

/**
 * Validate one upstream SVG and return its normalised inner geometry.
 *
 * The contract is the family rule in src/icons.ts: a 24-grid outline whose
 * presentation the wrapper owns. Anything that could execute, load, reference
 * or hide content is refused rather than stripped.
 */
function normaliseGlyph(entry: GlyphEntry, raw: Buffer): VendoredGlyph {
  const { name } = entry;
  const svg = raw.toString('utf8').trim();
  const tags = parseTags(name, svg);
  const root = tags[0];
  const tail = tags[tags.length - 1];
  if (tags.length < 3 || !root || root.closing || root.name !== 'svg' || tail?.name !== 'svg' || !tail.closing) {
    throw new Error(`${name}: not a single <svg> document`);
  }
  const viewBox = root.attrs.find((a) => a.name === 'viewBox')?.value;
  if (viewBox !== '0 0 24 24') throw new Error(`${name}: viewBox "${viewBox ?? 'missing'}" is not the 24-grid`);
  const rootClose = tags[tags.length - 1]!;
  for (const tag of tags) {
    const lower = tag.name.toLowerCase();
    const isRootTag = tag === root || tag === rootClose;
    if (!isRootTag && !ALLOWED_ELEMENTS.has(lower)) {
      throw new Error(
        FORBIDDEN_ELEMENTS.has(lower)
          ? `${name}: forbidden element <${tag.name}>`
          : `${name}: element <${tag.name}> is not in the allowed set`,
      );
    }
    if (!isRootTag && tag.name !== lower) throw new Error(`${name}: element <${tag.name}> is not lowercase`);
    if (!isRootTag && (tag.closing || !tag.selfClosing)) {
      throw new Error(`${name}: nested <${tag.name}> content is not supported`);
    }
    safeAttrs(name, tag);
  }

  const body = tags
    .slice(1, -1)
    .map((tag) => `<${tag.name}${safeAttrs(name, tag).map((a) => ` ${a.name}="${a.value}"`).join('')}/>`)
    .join('');
  if (body.length === 0) throw new Error(`${name}: no geometry`);
  if (/<script|<style|<use|<defs|<image|<mask|<clipPath|<foreignObject/i.test(body)) {
    throw new Error(`${name}: forbidden markup survived normalisation`);
  }
  return { entry, sha256: createHash('sha256').update(raw).digest('hex'), body };
}

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */
async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/svg+xml,text/plain,*/*;q=0.1' } });
  if (!res.ok) throw new Error(`request failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The upstream licence must actually be the ISC notice we claim to vendored. */
function validateLicence(text: string): string {
  const trimmed = text.trimEnd() + '\n';
  if (!/^ISC License/m.test(trimmed) || !/Permission to use, copy, modify, and\/or distribute this software/.test(trimmed)) {
    throw new Error(`licence from ${LICENSE_URL} does not look like ISC`);
  }
  if (!/Copyright \(c\)/.test(trimmed)) throw new Error(`no copyright line in ${LICENSE_URL}`);
  return trimmed;
}

/** The Feather-derived names listed inside the upstream licence text. */
function featherDerived(licence: string): Set<string> {
  const list = /derived from the Feather project:\s*([^\n]+)/i.exec(licence)?.[1] ?? '';
  return new Set(list.split(',').map((s) => s.trim()).filter(Boolean));
}

/* ------------------------------------------------------------------ *
 * Generated output
 * ------------------------------------------------------------------ */
function allowlistSignature(): string {
  const rows = PACK.map((g) => `${g.name}\t${g.category}\t${g.roles.join(',')}`).join('\n');
  return createHash('sha256').update(`${COMMIT}\n${rows}\n`).digest('hex');
}

function glyphsPerCategory(): Map<Category, string[]> {
  const out = new Map<Category, string[]>();
  for (const g of PACK) {
    const list = out.get(g.category) ?? [];
    list.push(g.name);
    out.set(g.category, list);
  }
  return out;
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildIconpacksTs(glyphs: VendoredGlyph[], allowlistSha: string): string {
  const perCategory = glyphsPerCategory();
  const summary = CATEGORIES.map((c) => `${c} (${perCategory.get(c)?.length ?? 0})`).join(', ');
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * TurboSlop — vendored Lucide icon geometry.');
  lines.push(' *');
  lines.push(' * GENERATED BY scripts/fetch-icons.ts — DO NOT EDIT BY HAND.');
  lines.push(' * Re-run `npx tsx scripts/fetch-icons.ts` (`--refresh` to re-fetch) to verify or update.');
  lines.push(' *');
  lines.push(` * Upstream: ${SOURCE} at commit ${COMMIT} (release ${UPSTREAM_VERSION}).`);
  lines.push(` * Raw pattern: ${RAW_ICON_BASE}/<name>.svg`);
  lines.push(` * Licence: ${SPDX} (SPDX: \`${SPDX}\`). The verbatim upstream notice — the ISC licence`);
  lines.push(' * plus the MIT notice for the Feather-derived glyphs — lives in');
  lines.push(' * `public/icons/LICENSES.md` and must travel with any redistribution of this data.');
  lines.push(' *');
  lines.push(` * Allowlist (${glyphs.length} glyphs, curated by module semantics): ${summary}.`);
  lines.push(' * Only geometry attributes are vendored; src/icons.ts wraps every glyph with the');
  lines.push(' * house profile (24-grid, stroke 1.6, round caps/joins, currentColor, no fill),');
  lines.push(' * exactly like the original family. This module is pure data: no fs, no network,');
  lines.push(' * no clock, no randomness.');
  lines.push(' */');
  lines.push('');
  lines.push('/** Upstream commit the glyphs were fetched from (full SHA, immutable). */');
  lines.push(`export const LUCIDE_COMMIT = ${quote(COMMIT)};`);
  lines.push('/** Upstream release the pinned commit belongs to. */');
  lines.push(`export const LUCIDE_VERSION = ${quote(UPSTREAM_VERSION)};`);
  lines.push('/** Human-facing upstream repository. */');
  lines.push(`export const LUCIDE_SOURCE = ${quote(SOURCE)};`);
  lines.push('/** Raw URL base: <base>/<name>.svg. */');
  lines.push(`export const LUCIDE_RAW_BASE = ${quote(RAW_ICON_BASE)};`);
  lines.push('/** Upstream licence file for the pinned commit. */');
  lines.push(`export const LUCIDE_LICENSE_URL = ${quote(LICENSE_URL)};`);
  lines.push('/** sha256 of (commit + curated allowlist): a re-run can tell whether the plan changed. */');
  lines.push(`export const LUCIDE_ALLOWLIST_SHA256 = ${quote(allowlistSha)};`);
  lines.push('/** The one grid every glyph is drawn on. */');
  lines.push('export const LUCIDE_GRID = 24;');
  lines.push('');
  lines.push('/** Glyph names, in allowlist order. */');
  lines.push('export const LUCIDE_ICON_NAMES = [');
  for (const g of glyphs) lines.push(`  ${quote(g.entry.name)},`);
  lines.push('] as const;');
  lines.push('export type LucideIconName = (typeof LUCIDE_ICON_NAMES)[number];');
  lines.push('');
  lines.push('/** The curated module semantics the allowlist is grouped by. */');
  lines.push(`export type LucideIconCategory = ${CATEGORIES.map(quote).join(' | ')};`);
  lines.push('');
  lines.push('export interface LucideGlyph {');
  lines.push('  category: LucideIconCategory;');
  lines.push('  /** House roles this glyph can fulfil; see ICON_ROLE_GLYPHS in src/icons.ts. */');
  lines.push('  roles: readonly string[];');
  lines.push('  /** sha256 of the upstream SVG this geometry was normalised from. */');
  lines.push('  sha256: string;');
  lines.push('  /** Inner geometry. Presentation is stripped: the wrapper decides stroke/fill. */');
  lines.push('  body: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const LUCIDE_GLYPHS: { readonly [K in LucideIconName]: LucideGlyph } = {');
  let current: Category | null = null;
  for (const g of glyphs) {
    if (g.entry.category !== current) {
      current = g.entry.category;
      lines.push(`  /* ---- ${current} (${perCategory.get(current)?.length ?? 0}) ---- */`);
    }
    lines.push(`  ${quote(g.entry.name)}: {`);
    lines.push(`    category: ${quote(g.entry.category)},`);
    lines.push(`    roles: [${g.entry.roles.map(quote).join(', ')}],`);
    lines.push(`    sha256: ${quote(g.sha256)},`);
    lines.push(`    body: ${quote(g.body)},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function buildLicensesMd(glyphs: VendoredGlyph[], licence: string): string {
  const perCategory = glyphsPerCategory();
  const derived = featherDerived(licence);
  const ours = glyphs.map((g) => g.entry.name).filter((n) => derived.has(n));
  const banner = [
    '# Bundled icon licences',
    '',
    'These are **redistribution licences**. The glyphs described here are vendored as',
    'generated TypeScript data in `src/iconpacks.ts` (never as a runtime import):',
    'they were fetched from a pinned upstream commit, validated, stripped of their',
    'presentation attributes and re-emitted through the house wrapper (24-grid,',
    'stroke 1.6, round caps/joins, `currentColor`, no fills). The outlines themselves',
    'are unmodified — only `stroke`, `fill`, `width`/`height` and `class` were removed.',
    '',
    'If you copy, bundle or redistribute the data in `src/iconpacks.ts`, keep this',
    'document and the full upstream notice below with it.',
    '',
    '| family | glyphs | source | commit | licence |',
    '| --- | --- | --- | --- | --- |',
    `| Lucide | ${glyphs.length} | <${SOURCE}> | \`${COMMIT}\` | ${SPDX} (SPDX: \`${SPDX}\`) |`,
    '',
    '---',
    '',
    '## Lucide — the vendored icon family',
    '',
    '- Family: **Lucide** (outline icons from `lucide-icons/lucide`)',
    '- Generated data: `src/iconpacks.ts` (written by `scripts/fetch-icons.ts`)',
    `- Upstream source: <${SOURCE}> at commit \`${COMMIT}\` (release ${UPSTREAM_VERSION})`,
    `- Raw URL pattern: \`${RAW_ICON_BASE}/<name>.svg\``,
    `- Repository licence: <${LICENSE_URL}>`,
    `- Licence: ISC (SPDX: \`${SPDX}\`)`,
    `- Grid: 24 x 24, outline only; presentation is applied by \`src/icons.ts\``,
    '',
    `### Glyph list (${glyphs.length})`,
    '',
    ...CATEGORIES.flatMap((c) => [
      `- **${c}** (${perCategory.get(c)?.length ?? 0}): ${(perCategory.get(c) ?? []).map((n) => `\`${n}\``).join(', ')}`,
    ]),
    '',
    '### Feather-derived glyphs in this pack',
    '',
    ours.length
      ? `The upstream licence carries a second, MIT notice for glyphs derived from the Feather project. Of this pack: ${ours.map((n) => `\`${n}\``).join(', ')}.`
      : 'None of the vendored glyphs appear in the Feather-derived list.',
    '',
    '---',
    '',
    '## Upstream licence — verbatim',
    '',
    `Fetched from <${LICENSE_URL}>; reproduced without changes.`,
    '',
    '```text',
    licence.trimEnd(),
    '```',
    '',
  ];
  return banner.join('\n');
}

/* ------------------------------------------------------------------ *
 * Idempotence
 * ------------------------------------------------------------------ */
async function existingPackVerifies(allowlistSha: string): Promise<boolean> {
  try {
    const pack = await readFile(PACK_PATH, 'utf8');
    const licences = await readFile(LICENSES_PATH, 'utf8');
    if (!pack.includes(`export const LUCIDE_COMMIT = '${COMMIT}';`)) return false;
    if (!pack.includes(`export const LUCIDE_ALLOWLIST_SHA256 = '${allowlistSha}';`)) return false;
    if (!PACK.every((g) => pack.includes(`  '${g.name}': {`))) return false;
    if (!licences.includes(COMMIT) || !/ISC License/.test(licences)) return false;
    if (!PACK.every((g) => licences.includes(`\`${g.name}\``))) return false;
    return true;
  } catch {
    return false; // missing or unreadable — fetch afresh
  }
}

async function writeIfChanged(file: string, content: string): Promise<'written' | 'unchanged'> {
  let previous = '';
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    /* first run */
  }
  if (previous === content) return 'unchanged';
  await writeFile(file, content);
  return 'written';
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
function assertAllowlistIsSane(): void {
  const seen = new Set<string>();
  for (const g of PACK) {
    if (seen.has(g.name)) throw new Error(`duplicate allowlist entry ${g.name}`);
    seen.add(g.name);
    if (!CATEGORIES.includes(g.category)) throw new Error(`${g.name}: unknown category ${g.category}`);
    for (const r of g.roles) if (!ROLES.includes(r)) throw new Error(`${g.name}: unknown role ${r}`);
  }
  // Every role needs 2-3 curated candidates; the page picks one per seed.
  for (const role of ROLES) {
    const n = PACK.filter((g) => g.roles.includes(role)).length;
    if (n < 2 || n > 3) throw new Error(`role ${role} has ${n} candidates; expected 2-3`);
  }
}

async function main(): Promise<void> {
  assertAllowlistIsSane();
  await mkdir(ICON_DIR, { recursive: true });
  const allowlistSha = allowlistSignature();
  const refresh = process.argv.includes('--refresh');

  if (!refresh && (await existingPackVerifies(allowlistSha))) {
    console.log(
      `\n  Lucide @${COMMIT.slice(0, 8)} (${PACK.length} glyphs) already vendored and verified —` +
        ' src/iconpacks.ts and public/icons/LICENSES.md left untouched.\n',
    );
    return;
  }

  const failures: string[] = [];
  const licence = validateLicence((await fetchBuffer(LICENSE_URL)).toString('utf8'));

  const glyphs: VendoredGlyph[] = [];
  for (const entry of PACK) {
    try {
      glyphs.push(normaliseGlyph(entry, await fetchBuffer(`${RAW_ICON_BASE}/${entry.name}.svg`)));
    } catch (err) {
      failures.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAILED ${f}`);
    console.error(`\n  ${failures.length} glyph(s) failed validation — refusing to write a partial pack.\n`);
    process.exit(1);
  }

  const packStatus = await writeIfChanged(PACK_PATH, buildIconpacksTs(glyphs, allowlistSha));
  const licenceStatus = await writeIfChanged(LICENSES_PATH, buildLicensesMd(glyphs, licence));

  const perCategory = glyphsPerCategory();
  const rows = CATEGORIES.map((c) => `  ${c.padEnd(11)} ${String(perCategory.get(c)?.length ?? 0).padStart(3)}`);
  const bytes = glyphs.reduce((n, g) => n + Buffer.byteLength(g.body, 'utf8'), 0);
  console.log(
    ['\n  category    glyphs', ...rows, '', `  ${glyphs.length} glyphs from ${UPSTREAM_REPO}@${COMMIT.slice(0, 8)} (${UPSTREAM_VERSION})`,
      `  geometry ${(bytes / 1024).toFixed(1)} KB · src/iconpacks.ts ${packStatus} · public/icons/LICENSES.md ${licenceStatus}`,
      '  licence: ISC (verbatim notice in public/icons/LICENSES.md)\n'].join('\n'),
  );
}

await main();
