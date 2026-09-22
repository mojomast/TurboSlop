#!/usr/bin/env node
/**
 * TurboSlop — similarity calibration.
 *
 * The review asked for similarity to be CALIBRATED against rendered geometry
 * and reviewed screenshots — not asserted. This script takes the evidence run
 * (`scripts/evidence.ts`): every page has a resolved design fingerprint
 * (raw.json) AND live-browser geometry (measure.json), and computes, for every
 * within-brief pair of pages (same brief = same fixed content inventory, so
 * geometry differences are DESIGN differences):
 *
 *   - fingerprint distance   — the selection's own feature metric
 *   - geometry distance      — measured section heights, hero height and h1
 *                              size, normalised to 0..1-ish
 *
 * It then reports the rank correlation between them and the distribution of
 * geometry distance inside each threshold band the selector uses
 * (NEAR_DUPLICATE, MIN_SEPARATION, HISTORY_SEPARATION). If pages the selector
 * considers near-duplicates do not in fact measure nearly the same, the
 * thresholds are wrong; if geometry distance grows monotonically with
 * fingerprint distance, they are measuring something real.
 *
 * Usage:
 *   npx tsx scripts/calibrate.ts --evidence /tmp/opencode/ev
 *   (writes <evidence>/calibration.json and prints a markdown table)
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  GRAYSCALE_SEPARATION,
  HISTORY_SEPARATION,
  MIN_SEPARATION,
  NEAR_DUPLICATE,
  featureDistance,
  grayscaleDistance,
  type DesignFeatures,
} from '../src/fingerprint.js';

interface RawPage {
  brief: string;
  seed: number;
  direction: number;
  session: string;
  preview: string;
}
interface Raw {
  pageMap: Record<string, RawPage>;
  sessions: {
    brief: string;
    seed: number;
    directions: { index: number; features: DesignFeatures }[];
  }[];
  styleProbe?: { slug: string; features: DesignFeatures; note: string }[];
}
interface Measured {
  pages: {
    slug: string;
    desktop: {
      heroHeight: number;
      h1FontSizePx: number;
      sections: { id: string; height: number }[];
      sectionOrder: string[];
      firstScreenBlocks: string[];
      overflowsHorizontally: boolean;
      duplicateIds: string[];
      brokenAnchors: string[];
      imageCount: number;
    };
    mobile: { scrollWidth: number; overflowsHorizontally: boolean; duplicateIds: string[]; brokenAnchors: string[] };
  }[];
}

function parseArgs(argv: string[]): { evidence: string } {
  let evidence = 'evidence';
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--evidence') evidence = argv[++i]!;
  return { evidence };
}

/** Spearman rank correlation, with ties averaged. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const idx = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]!.x === idx[i]!.x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]!.i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Rendered-geometry distance, 0..1-ish.
 *
 * Section heights are aligned in render order; the hero and the headline size
 * carry their own terms; a missing section counts as a difference. This is the
 * number a person would roughly agree with: two pages that measure the same
 * vertically and open the same way look like the same page in a screenshot.
 */
function geometryDistance(a: Measured['pages'][number]['desktop'], b: Measured['pages'][number]['desktop']): number {
  const n = Math.max(a.sections.length, b.sections.length, 1);
  let sectionTerm = 0;
  for (let i = 0; i < n; i++) {
    const ha = a.sections[i]?.height ?? 0;
    const hb = b.sections[i]?.height ?? 0;
    sectionTerm += Math.min(1, Math.abs(ha - hb) / 900);
  }
  sectionTerm /= n;
  const heroTerm = Math.min(1, Math.abs(a.heroHeight - b.heroHeight) / 900);
  const h1Term = Math.min(1, Math.abs(a.h1FontSizePx - b.h1FontSizePx) / 200);
  const shapeA = a.firstScreenBlocks.join('>');
  const shapeB = b.firstScreenBlocks.join('>');
  const shapeTerm = shapeA === shapeB ? 0 : 1;
  return Number((0.55 * sectionTerm + 0.25 * heroTerm + 0.1 * h1Term + 0.1 * shapeTerm).toFixed(4));
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const dir = path.resolve(cli.evidence);
  const raw = JSON.parse(await readFile(path.join(dir, 'raw.json'), 'utf8')) as Raw;
  const measured = JSON.parse(await readFile(path.join(dir, 'measure.json'), 'utf8')) as Measured;

  const featuresBySlug = new Map<string, DesignFeatures>();
  for (const s of raw.sessions) {
    for (const d of s.directions) {
      const slug = `${s.brief}-s${s.seed}-d${d.index}`;
      featuresBySlug.set(slug, d.features);
    }
  }
  /* The style probe fills the near bands selection deliberately removes. */
  for (const probe of raw.styleProbe ?? []) featuresBySlug.set(probe.slug, probe.features);

  const pageBySlug = new Map(measured.pages.map((p) => [p.slug, p]));
  const byBrief = new Map<string, string[]>();
  for (const [slug, meta] of Object.entries(raw.pageMap)) {
    if (!featuresBySlug.has(slug) || !pageBySlug.has(slug)) continue;
    const list = byBrief.get(meta.brief) ?? [];
    list.push(slug);
    byBrief.set(meta.brief, list);
  }

  const pairs: { brief: string; a: string; b: string; fp: number; gray: number; geo: number }[] = [];
  for (const [brief, slugs] of byBrief) {
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const fa = featuresBySlug.get(slugs[i]!)!;
        const fb = featuresBySlug.get(slugs[j]!)!;
        const ma = pageBySlug.get(slugs[i]!)!.desktop;
        const mb = pageBySlug.get(slugs[j]!)!.desktop;
        pairs.push({
          brief,
          a: slugs[i]!,
          b: slugs[j]!,
          fp: featureDistance(fa, fb),
          gray: grayscaleDistance(fa, fb),
          geo: geometryDistance(ma, mb),
        });
      }
    }
  }

  const band = (fp: number) =>
    fp <= NEAR_DUPLICATE ? `≤ ${NEAR_DUPLICATE} (near-duplicate)` :
    fp < MIN_SEPARATION ? `${NEAR_DUPLICATE}–${MIN_SEPARATION} (below separation)` :
    fp < 0.4 ? `${MIN_SEPARATION}–0.40` :
    '≥ 0.40';

  const bands = new Map<string, number[]>();
  for (const p of pairs) {
    const k = band(p.fp);
    bands.set(k, [...(bands.get(k) ?? []), p.geo]);
  }
  const bandRows = [...bands.entries()].map(([bandName, geos]) => ({
    band: bandName,
    pairs: geos.length,
    medianGeometryDistance: Number(median(geos).toFixed(4)),
  }));

  const rho = spearman(pairs.map((p) => p.fp), pairs.map((p) => p.geo));
  const rhoGray = spearman(pairs.map((p) => p.gray), pairs.map((p) => p.geo));

  const sameBlueprintPairs = pairs.filter(
    (p) => featuresBySlug.get(p.a)!.sequence === featuresBySlug.get(p.b)!.sequence,
  );
  const differentSequencePairs = pairs.filter(
    (p) => featuresBySlug.get(p.a)!.sequence !== featuresBySlug.get(p.b)!.sequence,
  );

  const calibration = {
    generatedAt: new Date().toISOString(),
    method:
      'within-brief pairs only (the content inventory is fixed per brief), ' +
      'fingerprint distance from raw.json vs measured geometry (section heights, hero height, h1 size, first-screen shape) from measure.json',
    thresholds: { NEAR_DUPLICATE, MIN_SEPARATION, HISTORY_SEPARATION, GRAYSCALE_SEPARATION },
    pairs: pairs.length,
    briefs: [...byBrief.keys()],
    spearmanFingerprintVsGeometry: Number(rho.toFixed(3)),
    spearmanGrayscaleVsGeometry: Number(rhoGray.toFixed(3)),
    bands: bandRows,
    sameBlueprintDifferentStyling: {
      pairs: sameBlueprintPairs.length,
      medianFingerprint: Number(median(sameBlueprintPairs.map((p) => p.fp)).toFixed(4)),
      medianGeometry: Number(median(sameBlueprintPairs.map((p) => p.geo)).toFixed(4)),
    },
    differentSequence: {
      pairs: differentSequencePairs.length,
      medianFingerprint: Number(median(differentSequencePairs.map((p) => p.fp)).toFixed(4)),
      medianGeometry: Number(median(differentSequencePairs.map((p) => p.geo)).toFixed(4)),
    },
    note:
      'Pairs below the near-duplicate threshold are EXPECTED to be absent: the selector rejects them within ' +
      'a set and project history rejects them across sets. The band table therefore reports the floor the ' +
      'enforcement leaves behind, and the Spearman coefficient is computed under that range restriction.',
    worstNearDuplicates: pairs
      .filter((p) => p.fp <= NEAR_DUPLICATE)
      .sort((a, b) => b.geo - a.geo)
      .slice(0, 5)
      .map((p) => ({ a: p.a, b: p.b, fingerprint: p.fp, geometry: p.geo })),
    raw: pairs,
  };

  await writeFile(path.join(dir, 'calibration.json'), JSON.stringify(calibration, null, 1), 'utf8');

  const lines = [
    `## Fingerprint distance vs rendered geometry`,
    ``,
    `Pairs: **${calibration.pairs}** within-brief (fixed inventory). Spearman ρ(fingerprint, geometry) = **${rho.toFixed(3)}**, ρ(grayscale, geometry) = **${rhoGray.toFixed(3)}**.`,
    ``,
    `| band | pairs | median geometry distance |`,
    `|---|---|---|`,
    ...bandRows.map((b) => `| ${b.band} | ${b.pairs} | ${b.medianGeometryDistance} |`),
    ``,
    `| group | pairs | median fingerprint | median geometry |`,
    `|---|---|---|---|`,
    `| identical section sequence | ${calibration.sameBlueprintDifferentStyling.pairs} | ${calibration.sameBlueprintDifferentStyling.medianFingerprint} | ${calibration.sameBlueprintDifferentStyling.medianGeometry} |${calibration.sameBlueprintDifferentStyling.pairs === 0 ? ' — none exist: all measured sequences are distinct' : ''}`,
    `| different section sequence | ${calibration.differentSequence.pairs} | ${calibration.differentSequence.medianFingerprint} | ${calibration.differentSequence.medianGeometry} |`,
    ``,
  ];
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(`\n  calibrate failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
