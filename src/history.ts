/**
 * TurboSlop — recent-design history.
 *
 * Diversity only means something against something: a set that is internally
 * distinct can still repeat what the project shipped yesterday. This store
 * keeps the RESOLVED fingerprints of recently produced designs so both single
 * generation (`pipeline.ts`) and direction batches (`sessions.ts`) can reject
 * near-duplicates of what a project already made.
 *
 * ## Scoping and reproducibility
 *
 * History is scoped BY PROJECT — `FORGE_PROJECT` (default `default`) — so two
 * projects sharing an output directory do not poison each other's novelty, and
 * resetting a project is deleting one file.
 *
 * Selection takes a SNAPSHOT of the history before it runs. Same versioned
 * inputs + same seed + same snapshot ⇒ same result, always. The snapshot's
 * keys are recorded on the session so a run can be explained after the fact;
 * history is an input, never a hidden clock.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprintKey, type DesignFeatures } from './fingerprint.js';

export const HISTORY_DIR = '.history';
/** How long a design stays in the novelty window before it stops counting. */
export const HISTORY_LIMIT = 96;

export interface HistoryEntry {
  key: string;
  features: DesignFeatures;
  at: string;
  /** Where it came from, for auditing: a session batch and/or a final slug. */
  source?: string;
  seed?: number;
}

interface HistoryFile {
  version: 1;
  entries: HistoryEntry[];
}

/** The project id, validated: it becomes a filename. */
export function projectId(raw = process.env.FORGE_PROJECT): string {
  const p = (raw ?? 'default').trim().toLowerCase();
  if (!p) return 'default';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(p)) {
    throw new Error(`FORGE_PROJECT must match [a-z0-9][a-z0-9-]{0,39} (got "${p}")`);
  }
  return p;
}

const fileFor = (outDir: string, project: string) => path.join(outDir, HISTORY_DIR, `${project}.json`);

/**
 * A read-only snapshot of recent resolved designs for this project.
 *
 * Returned oldest-first and de-duplicated by key, so a selection run sees a
 * stable list it can record and reproduce.
 */
export async function loadHistory(outDir: string, project = projectId()): Promise<HistoryEntry[]> {
  try {
    const raw = JSON.parse(await readFile(fileFor(outDir, project), 'utf8')) as HistoryFile;
    if (raw?.version !== 1 || !Array.isArray(raw.entries)) return [];
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const e of raw.entries) {
      if (!e?.key || !e?.features || seen.has(e.key)) continue;
      seen.add(e.key);
      out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}

/** Just the feature vectors — the form selection consumes. */
export async function historyFeatures(
  outDir: string,
  project = projectId(),
): Promise<{ features: DesignFeatures[]; keys: string[]; entries: HistoryEntry[] }> {
  const entries = await loadHistory(outDir, project);
  return { features: entries.map((e) => e.features), keys: entries.map((e) => e.key), entries };
}

export interface RecordInput {
  features: DesignFeatures;
  source?: string;
  seed?: number;
}

/**
 * Append resolved fingerprints to the project's history.
 *
 * Write-to-temp-then-rename so a crash mid-write cannot corrupt the file, and
 * a concurrent generation cannot lose the previous batch: the last writer wins
 * only for its own window, which is the honest behaviour for a novelty log.
 */
export async function recordHistory(
  outDir: string,
  inputs: RecordInput[],
  project = projectId(),
): Promise<HistoryEntry[]> {
  if (!inputs.length) return loadHistory(outDir, project);
  const existing = await loadHistory(outDir, project);
  const now = new Date().toISOString();
  const seen = new Set(existing.map((e) => e.key));

  const added: HistoryEntry[] = [];
  for (const input of inputs) {
    const key = fingerprintKey(input.features);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      key,
      features: input.features,
      at: now,
      ...(input.source ? { source: input.source } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    });
  }

  const next: HistoryFile = {
    version: 1,
    entries: [...existing, ...added].slice(-HISTORY_LIMIT),
  };
  const file = fileFor(outDir, project);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next), 'utf8');
  await rename(tmp, file);
  return next.entries;
}

/** Projects that have history in this output directory, for diagnostics. */
export async function listHistoryProjects(outDir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(outDir, HISTORY_DIR)))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}
