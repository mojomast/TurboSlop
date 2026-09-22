/**
 * TurboSlop — user-supplied images.
 *
 * A brief's owner usually has real brand and product photographs, and those are
 * always better than anything generated. This module takes a local image, copies
 * it into the export, and records who made it and under what licence — because
 * an image that travels without its attribution is a licensing problem waiting
 * to happen, not a design.
 *
 * Deliberately local-file only: no URL fetching, so there is no server-side
 * request forgery surface and no silent insertion of remote stock art. A caller
 * that wants a remote source must fetch it and hand us a path.
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Asset } from './types.js';

/** 12 MB is well past any reasonable web image and well inside memory. */
const MAX_BYTES = 12 * 1024 * 1024;

export interface UserImageRequest {
  /** Which place on the page it fills. Must be a slot the blueprint renders. */
  slot: string;
  /** Path to the image, resolved INSIDE `root`. Traversal is refused. */
  path: string;
  alt?: string;
  /** Who made it. Required for anything the user did not make themselves. */
  credit?: string;
  /** Licence as stated by the rights holder, e.g. `CC-BY-4.0`, `(c) all rights reserved`. */
  license?: string;
}

export interface UserImageResult {
  assets: Asset[];
  notes: string[];
}

/* ------------------------------------------------------------------ *
 * Intrinsic size — so an upscale can be measured instead of hidden
 * ------------------------------------------------------------------ */
export interface ImageSize {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'unknown';
}

/** Read just enough of the header to learn the pixel size and the format. */
export function imageSize(buf: Buffer): ImageSize {
  // PNG: 8-byte magic, then the IHDR chunk with width/height as big-endian u32.
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  // GIF: logical screen descriptor at offset 6, little-endian u16.
  if (buf.length > 10 && buf.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' };
  }
  // WebP: RIFF....WEBP, then VP8 / VP8L / VP8X chunk.
  if (buf.length > 30 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('latin1');
    if (kind === 'VP8X') {
      const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
      const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
      return { width: w, height: h, format: 'webp' };
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
    }
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' };
    }
  }
  // JPEG: walk the segments to the Start Of Frame.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), format: 'jpeg' };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
    return { width: 0, height: 0, format: 'jpeg' };
  }
  return { width: 0, height: 0, format: 'unknown' };
}

const EXT: Record<ImageSize['format'], string> = {
  png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', unknown: 'bin',
};

/**
 * Copy the caller's images into `outDir/assets/<slug>/` and return Assets.
 *
 * Refuses, with a note, rather than failing the whole job: a bad image path is
 * not a reason to lose a design. Anything refused is reported.
 */
export async function ingestUserImages(args: {
  outDir: string;
  slug: string;
  /** The directory the paths are resolved against. */
  root: string;
  requests: UserImageRequest[];
  /** Slot ids the direction actually renders. */
  allowedSlots: string[];
}): Promise<UserImageResult> {
  const notes: string[] = [];
  const assets: Asset[] = [];
  if (!args.requests.length) return { assets, notes };

  const dir = path.join(args.outDir, 'assets', args.slug);
  await mkdir(dir, { recursive: true });
  const root = path.resolve(args.root);

  for (const [i, req] of args.requests.entries()) {
    if (!req || typeof req.path !== 'string' || typeof req.slot !== 'string') {
      notes.push('a user image request was ignored: it needs a slot and a path');
      continue;
    }
    if (!args.allowedSlots.includes(req.slot)) {
      notes.push(`user image for slot "${req.slot}" ignored: this direction renders ${args.allowedSlots.join(', ') || 'no image slots'}`);
      continue;
    }
    const abs = path.resolve(root, req.path);
    // Traversal guard: the resolved path must stay inside the configured root.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      notes.push(`user image "${req.path}" refused: outside the configured image directory`);
      continue;
    }

    let bytes = 0;
    try {
      const st = await stat(abs);
      if (!st.isFile()) throw new Error('not a file');
      bytes = st.size;
      if (bytes > MAX_BYTES) throw new Error(`larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB cap`);
    } catch (err) {
      notes.push(`user image "${req.path}" could not be read: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const buf = await readFile(abs);
    const size = imageSize(buf);
    if (size.format === 'unknown') {
      notes.push(`user image "${req.path}" refused: not a PNG, JPEG, WebP or GIF`);
      continue;
    }

    const slot = req.slot;
    const file = `${String(i).padStart(2, '0')}-user-${slot}.${EXT[size.format]}`;
    await copyFile(abs, path.join(dir, file));

    assets.push({
      kind: 'surface',
      slot,
      source: 'user',
      file: path.posix.join('assets', args.slug, file),
      alt: req.alt?.trim() || `Supplied image for ${slot}`,
      credit: req.credit?.trim() ?? '',
      license: req.license?.trim() ?? '',
      nativeWidth: size.width,
      nativeHeight: size.height,
      prompt: '',
      seed: 0,
      steps: 0,
      cfg: 0,
      bytes: size.width ? bytes : 0,
      seconds: 0,
    });

    if (!req.credit && !req.license) {
      notes.push(`user image for "${slot}" has no credit or licence recorded — the export will not claim one either`);
    }
  }

  return { assets, notes };
}
