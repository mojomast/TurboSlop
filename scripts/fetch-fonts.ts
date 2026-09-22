#!/usr/bin/env node
/**
 * TurboSlop — fetch the bundled variable-font pack.
 *
 * Exported pages must not depend on a remote font request, so this script
 * downloads a small pack of genuinely variable, SIL Open Font License 1.1
 * families (one per typographic direction) and writes them to `public/fonts/`.
 * It also writes `public/fonts/LICENSES.md`, carrying the *real* fetched
 * licence text for every family — OFL requires the licence to travel with the
 * fonts, so the text is retrieved from the upstream repository rather than
 * paraphrased.
 *
 * Determinism / idempotence:
 *   - Google Fonts serves several formats for one family. The CSS is fetched
 *     with a modern browser User-Agent so it returns woff2, and only the
 *     `latin` unicode-range block (the one containing U+0000-00FF) is taken.
 *   - The served woff2 URL is versioned, but the *bytes* are what matter; a
 *     file that already exists and passes the woff2 magic + size check is left
 *     untouched, so re-running is a no-op.
 *   - Every other result is refused loudly: anything that is not a real woff2
 *     (> 5 KB and starting with `wOF2`) is deleted.
 *
 * Run:
 *   npx tsx scripts/fetch-fonts.ts
 *
 * Exits non-zero if any required family cannot be fetched or fails validation.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_DIR = fileURLToPath(new URL('../public/fonts/', import.meta.url));
const LICENSES_PATH = path.join(FONT_DIR, 'LICENSES.md');

/** A modern browser UA is required: Google Fonts only serves woff2 to it. */
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** woff2 files always begin with the four ASCII bytes `wOF2`. */
const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]);
/** Anything smaller than this is a truncated download or an error page. */
const MIN_BYTES = 5 * 1024;

interface PackEntry {
  /** Typographic direction this family serves. */
  direction: string;
  /** Upstream family name; also the CSS `font-family` the pack defines. */
  upstream: string;
  /** Deterministic file name under public/fonts/. */
  file: string;
  /** Google Fonts CSS2 family query, including the requested axis range. */
  cssQuery: string;
  /** `font-variation-settings` descriptor. */
  variation: string;
  /** Weight axis range. */
  weightRange: [number, number];
  /** Human-facing source page. */
  source: string;
  /** Raw OFL.txt in the upstream google/fonts repository. */
  licenseUrl: string;
  /** One-line purpose. */
  note: string;
}

const PACK: PackEntry[] = [
  {
    direction: 'poster',
    upstream: 'Archivo',
    file: 'archivo-latin-var.woff2',
    cssQuery: 'Archivo:wght@100..900',
    variation: "'wght' 100 900",
    weightRange: [100, 900],
    source: 'https://fonts.google.com/specimen/Archivo',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt',
    note: 'Grotesque display with a very wide weight axis — loud, poster-scale headlines.',
  },
  {
    direction: 'literary',
    upstream: 'Source Serif 4',
    file: 'source-serif-4-latin-var.woff2',
    cssQuery: 'Source+Serif+4:opsz,wght@8..60,200..900',
    variation: "'opsz' 8 60, 'wght' 200 900",
    weightRange: [200, 900],
    source: 'https://fonts.google.com/specimen/Source+Serif+4',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/OFL.txt',
    note: 'Optical-size serif for editorial reading and literary drop caps.',
  },
  {
    direction: 'friendly',
    upstream: 'Nunito',
    file: 'nunito-latin-var.woff2',
    cssQuery: 'Nunito:wght@200..1000',
    variation: "'wght' 200 1000",
    weightRange: [200, 1000],
    source: 'https://fonts.google.com/specimen/Nunito',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt',
    note: 'Rounded humanist sans — soft, toy-like, approachable.',
  },
  {
    direction: 'technical',
    upstream: 'JetBrains Mono',
    file: 'jetbrains-mono-latin-var.woff2',
    cssQuery: 'JetBrains+Mono:wght@100..800',
    variation: "'wght' 100 800",
    weightRange: [100, 800],
    source: 'https://fonts.google.com/specimen/JetBrains+Mono',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt',
    note: 'Monospace for annotations, labels and control-panel body text.',
  },
  {
    direction: 'restrained',
    upstream: 'Inter',
    file: 'inter-latin-var.woff2',
    cssQuery: 'Inter:wght@100..900',
    variation: "'wght' 100 900",
    weightRange: [100, 900],
    source: 'https://fonts.google.com/specimen/Inter',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt',
    note: 'Neutral low-contrast sans — quiet, legible, invisible when it should be.',
  },
];

interface Outcome {
  entry: PackEntry;
  status: 'downloaded' | 'skipped' | 'failed';
  bytes: number;
  detail: string;
  license?: string;
}

function isWoff2(buf: Buffer): boolean {
  return buf.length > MIN_BYTES && buf.subarray(0, 4).equals(WOFF2_MAGIC);
}

/**
 * Pull the `latin` @font-face URL out of a Google Fonts CSS response. The
 * latin block is the one whose unicode-range contains `U+0000-00FF`; matching
 * on the comment label alone is not enough because ordering can change.
 */
export function parseLatinWoff2(css: string): string | null {
  const blocks = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = blocks.exec(css)) !== null) {
    const body = match[2] ?? '';
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '';
    if (!range.includes('U+0000-00FF')) continue;
    const url = /src:\s*url\((https:\/\/[^)]+\.woff2)\)/.exec(body)?.[1];
    if (url) return url;
  }
  // Fallback for a response whose comments were stripped: take the first
  // woff2 `src` after a `/* latin */` marker.
  const idx = css.indexOf('/* latin */');
  if (idx >= 0) {
    const url = /src:\s*url\((https:\/\/[^)]+\.woff2)\)/.exec(css.slice(idx))?.[1];
    if (url) return url;
  }
  return null;
}

async function resolveLatinUrl(cssQuery: string): Promise<string> {
  const url = `https://fonts.googleapis.com/css2?family=${cssQuery}&display=swap`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/css,*/*;q=0.1' },
  });
  if (!res.ok) throw new Error(`CSS request failed (${res.status}) for ${cssQuery}`);
  const css = await res.text();
  const woff2 = parseLatinWoff2(css);
  if (!woff2) throw new Error(`no latin woff2 block for ${cssQuery}`);
  return woff2;
}

async function fetchBuffer(url: string, accept: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: accept } });
  if (!res.ok) throw new Error(`request failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchLicence(entry: PackEntry): Promise<string> {
  const text = (await fetchBuffer(entry.licenseUrl, 'text/plain')).toString('utf8').trim();
  if (text.length < 400 || !/SIL OPEN FONT LICENSE/i.test(text)) {
    throw new Error(`licence text from ${entry.licenseUrl} does not look like OFL`);
  }
  const copyright = /^Copyright [^\n]+/m.exec(text)?.[0];
  if (!copyright) throw new Error(`no copyright line in ${entry.licenseUrl}`);
  return `${text}\n`;
}

/** Download (or accept an existing) verified woff2. */
async function ensureFont(entry: PackEntry): Promise<{ status: Outcome['status']; bytes: number; detail: string }> {
  const target = path.join(FONT_DIR, entry.file);
  try {
    const existing = await readFile(target);
    if (isWoff2(existing)) {
      return { status: 'skipped', bytes: existing.length, detail: 'exists and verifies' };
    }
    // A corrupt or truncated leftover must never ship: remove it and refetch.
    await unlink(target);
  } catch {
    // Missing file — fall through to download.
  }

  const remote = await resolveLatinUrl(entry.cssQuery);
  const buf = await fetchBuffer(remote, 'font/woff2,*/*;q=0.1');
  if (!isWoff2(buf)) {
    // Fail loudly: never leave a broken reference on disk.
    try {
      await unlink(target);
    } catch {
      /* nothing to remove */
    }
    throw new Error(
      `downloaded ${buf.length} bytes for ${entry.upstream} but it is not a valid woff2 (magic/5KB check failed)`,
    );
  }
  await writeFile(target, buf);
  return { status: 'downloaded', bytes: buf.length, detail: remote };
}

function summaryTable(outcomes: Outcome[]): string {
  const rows = outcomes.map((o) => {
    const kb = (o.bytes / 1024).toFixed(1).padStart(8);
    return `  ${o.entry.direction.padEnd(11)} ${o.entry.upstream.padEnd(16)} ${o.entry.file.padEnd(30)} ${kb} KB  ${o.status}`;
  });
  return ['  direction   family           file                                size      status', ...rows].join('\n');
}

function buildLicencesMd(outcomes: Outcome[]): string {
  const totalBytes = outcomes.reduce((sum, o) => sum + o.bytes, 0);
  const banner = [
    '# Bundled font licences',
    '',
    'These are **redistribution licences**. Every file in `public/fonts/` is',
    'redistributable under the **SIL Open Font License 1.1**. OFL requires the',
    'licence to travel with the fonts: if you copy, bundle, subset or redistribute',
    'these `.woff2` files, keep the copyright line and the full OFL notice below',
    'with them. Do not sell the fonts by themselves, and do not use a Reserved Font',
    'Name for a modified version.',
    '',
    'Every `.woff2` here is an **unmodified latin subset** fetched from Google',
    'Fonts: no glyphs were added, removed, renamed or re-licensed, and the outlines',
    'are byte-identical to the upstream served subset. The full licence text for',
    'each family is reproduced verbatim in its section below.',
    '',
    `Pack total: ${outcomes.length} families, ${(totalBytes / 1024).toFixed(1)} KB.`,
    '',
    '| direction | family | file | axis | upstream | licence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...outcomes.map(
      (o) =>
        `| ${o.entry.direction} | ${o.entry.upstream} | \`${o.entry.file}\` | \`${o.entry.variation}\` | ${o.entry.source} | [OFL-1.1](${o.entry.licenseUrl}) |`,
    ),
    '',
    '---',
  ].join('\n');

  const sections = outcomes.map((o) => {
    const e = o.entry;
    return [
      '',
      `## ${e.upstream} — ${e.direction}`,
      '',
      `- Direction: ${e.direction}`,
      `- CSS family: \`${e.upstream}\``,
      `- Files: \`${e.file}\` (latin subset, variable ${e.variation}, unmodified)`,
      `- Weight range: ${e.weightRange[0]}–${e.weightRange[1]}`,
      `- Upstream source: <${e.source}>`,
      `- Repository licence: <${e.licenseUrl}>`,
      `- Licence: SIL Open Font License 1.1 (SPDX: \`OFL-1.1\`)`,
      `- Purpose: ${e.note}`,
      '',
      '```',
      (o.license ?? '').trimEnd(),
      '```',
      '',
      '---',
    ].join('\n');
  });

  return `${banner}\n${sections.join('\n')}`;
}

async function main(): Promise<void> {
  await mkdir(FONT_DIR, { recursive: true });
  const outcomes: Outcome[] = [];

  for (const entry of PACK) {
    try {
      const { status, bytes, detail } = await ensureFont(entry);
      const license = await fetchLicence(entry);
      outcomes.push({ entry, status, bytes, detail, license });
    } catch (err) {
      outcomes.push({
        entry,
        status: 'failed',
        bytes: 0,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failures = outcomes.filter((o) => o.status === 'failed');
  const ready = outcomes.filter((o) => o.status !== 'failed');

  // Only ship a licence document for families whose bytes are actually present.
  if (ready.length > 0) {
    const md = buildLicencesMd(ready);
    let previous = '';
    try {
      previous = await readFile(LICENSES_PATH, 'utf8');
    } catch {
      /* first run */
    }
    if (previous !== md) {
      await writeFile(LICENSES_PATH, md);
      console.log('  wrote public/fonts/LICENSES.md');
    } else {
      console.log('  public/fonts/LICENSES.md unchanged');
    }
  }

  console.log(`\n${summaryTable(outcomes)}\n`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAILED ${f.entry.upstream}: ${f.detail}`);
    console.error(`\n${failures.length} required font(s) failed — not shipping a broken reference.\n`);
    process.exit(1);
  }

  const downloaded = outcomes.filter((o) => o.status === 'downloaded').length;
  console.log(
    `  ${outcomes.length} families bundled${downloaded ? `, ${downloaded} downloaded` : ' — nothing to do (idempotent)'}; ` +
      `${(outcomes.reduce((s, o) => s + o.bytes, 0) / 1024).toFixed(1)} KB total.\n`,
  );
}

await main();
