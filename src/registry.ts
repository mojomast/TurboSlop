/**
 * turboslop — the design registry.
 *
 * The control surface needs to show every design that exists, including ones
 * produced by the CLI before the surface existed. So records are DERIVED from
 * the spec files on disk, and a small sidecar (`out/registry.json`) only stores
 * what cannot be derived: lineage, revision number, creation time and title.
 *
 * That means the registry is self-healing. Delete it and you lose the family
 * tree, not the work.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DesignSpec } from './types.js';

export interface DesignRecord {
  slug: string;
  title: string;
  brief: string;
  /** Slug of the design this was iterated from, if any. */
  parent: string | null;
  revision: number;
  createdAt: string;
  source: 'cli' | 'surface';
  decisions: Record<string, string>;
  composite: number;
  review: string[];
  decider: string;
  copyWriter: string;
  copyModel: string;
  imageCount: number;
  imageMs: number;
  htmlFile: string;
  specFile: string;
  htmlBytes: number;
}

interface SidecarEntry {
  title?: string;
  parent?: string | null;
  revision?: number;
  createdAt?: string;
  source?: 'cli' | 'surface';
}

interface Sidecar {
  version: 1;
  designs: Record<string, SidecarEntry>;
}

const REGISTRY_FILE = 'registry.json';

async function readSidecar(outDir: string): Promise<Sidecar> {
  try {
    const raw = await readFile(path.join(outDir, REGISTRY_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Sidecar;
    if (parsed && typeof parsed === 'object' && parsed.designs) return parsed;
  } catch {
    /* absent or unreadable: start fresh */
  }
  return { version: 1, designs: {} };
}

async function writeSidecar(outDir: string, sidecar: Sidecar): Promise<void> {
  await writeFile(path.join(outDir, REGISTRY_FILE), JSON.stringify(sidecar, null, 2), 'utf8');
}

/** A human title from the brief: first line, first clause, trimmed. */
export function titleFromBrief(brief: string): string {
  const first = brief.split('\n')[0]!.trim();
  const clause = first.split(/[.!?]/)[0]!.trim();
  const t = clause.length > 0 ? clause : first;
  return t.length > 64 ? `${t.slice(0, 61)}…` : t;
}

function toRecord(slug: string, spec: DesignSpec, sidecarEntry: SidecarEntry | undefined, htmlBytes: number, outDir: string): DesignRecord {
  const decisions: Record<string, string> = {};
  for (const d of spec.decisions) decisions[d.axis] = d.picked;
  return {
    slug,
    title: sidecarEntry?.title ?? titleFromBrief(spec.brief),
    brief: spec.brief,
    parent: sidecarEntry?.parent ?? null,
    revision: sidecarEntry?.revision ?? 1,
    createdAt: sidecarEntry?.createdAt ?? new Date(0).toISOString(),
    source: sidecarEntry?.source ?? 'cli',
    decisions,
    composite: spec.composite.normalized,
    review: spec.review,
    decider: spec.meta.decider,
    copyWriter: spec.meta.copyWriter,
    copyModel: spec.meta.copyModel,
    imageCount: spec.meta.imageCount,
    imageMs: spec.meta.imageMs,
    htmlFile: path.join(outDir, `${slug}.html`),
    specFile: path.join(outDir, `${slug}.spec.json`),
    htmlBytes,
  };
}

/** Every design on disk, newest first. */
export async function listDesigns(outDir: string): Promise<DesignRecord[]> {
  const sidecar = await readSidecar(outDir);

  let files: string[] = [];
  try {
    files = (await readdir(outDir)).filter((f) => f.endsWith('.spec.json'));
  } catch {
    return [];
  }

  const out: DesignRecord[] = [];
  for (const f of files) {
    const slug = f.replace(/\.spec\.json$/, '');
    try {
      const spec = DesignSpec.parse(JSON.parse(await readFile(path.join(outDir, f), 'utf8')));
      let htmlBytes = 0;
      try {
        const html = await readFile(path.join(outDir, `${slug}.html`), 'utf8');
        htmlBytes = Buffer.byteLength(html, 'utf8');
      } catch {
        /* html missing: still list the spec */
      }
      out.push(toRecord(slug, spec, sidecar.designs[slug], htmlBytes, outDir));
    } catch {
      /* an unreadable spec should not take down the whole list */
    }
  }

  // Newest first. Records without a recorded time sort last but stay visible.
  return out.sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta === tb) return a.slug.localeCompare(b.slug);
    return tb - ta;
  });
}

export interface LoadedDesign {
  record: DesignRecord;
  spec: DesignSpec;
}

export async function getDesign(outDir: string, slug: string): Promise<LoadedDesign | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null; // no traversal, no surprises
  const all = await listDesigns(outDir);
  const record = all.find((d) => d.slug === slug);
  if (!record) return null;
  const spec = DesignSpec.parse(JSON.parse(await readFile(record.specFile, 'utf8')));
  return { record, spec };
}

export interface RecordOptions {
  slug: string;
  brief: string;
  parent?: string | null;
  revision?: number;
  source?: 'cli' | 'surface';
  title?: string;
}

/** Persist lineage metadata for a design that has just been written. */
export async function recordDesign(outDir: string, opts: RecordOptions): Promise<void> {
  const sidecar = await readSidecar(outDir);
  sidecar.designs[opts.slug] = {
    title: opts.title ?? titleFromBrief(opts.brief),
    parent: opts.parent ?? null,
    revision: opts.revision ?? 1,
    createdAt: new Date().toISOString(),
    source: opts.source ?? 'surface',
  };
  await writeSidecar(outDir, sidecar);
}

/**
 * Slug for the next iteration of a design: `<base>-r2`, `-r3`, …
 * Keeps the family visibly related in filenames.
 */
export async function nextIterationSlug(outDir: string, parentSlug: string): Promise<string> {
  const base = parentSlug.replace(/-r\d+$/, '');
  const existing = new Set((await listDesigns(outDir)).map((d) => d.slug));
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-r${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-r${Date.now()}`;
}

/** Ensure a slug is unique, appending -2, -3, … when it collides. */
export async function uniqueSlug(outDir: string, desired: string): Promise<string> {
  const existing = new Set((await listDesigns(outDir)).map((d) => d.slug));
  if (!existing.has(desired)) return desired;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${desired}-${Date.now()}`;
}
