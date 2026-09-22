/**
 * TurboSlop — a tiny, dependency-free ZIP writer.
 *
 * The deliverable is a downloaded archive, so every offset, size and checksum
 * here is user-visible: a wrong CRC or a mis-recorded compressed size makes the
 * file unopenable, and a sloppy entry path is a path-traversal vulnerability in
 * whatever the user extracts it with.
 *
 * Scope is deliberately narrow:
 *  - DEFLATE (method 8) when it actually shrinks the payload, otherwise STORE
 *    (method 0). Already-compressed assets (PNG) land on STORE and cost nothing.
 *  - No ZIP64. An entry or archive that would need it throws instead of writing
 *    a silently corrupt file.
 *  - Only `node:zlib` is used.
 */
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Path inside the archive, e.g. "index.html" or "assets/a/00-backdrop-1.png". */
  path: string;
  data: Buffer | string;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Version needed / made by: 2.0, the baseline for DEFLATE and directory entries. */
const VERSION = 20;
/** General purpose bit 11 — filenames and comments are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_UINT32 = 0xffffffff;

/* ------------------------------------------------------------------ *
 * CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320)
 * ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard IEEE CRC-32. Exported so callers/tests can verify vectors. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * DOS date/time
 * ------------------------------------------------------------------ */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  const date = (((year - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date: date & 0xffff, time: time & 0xffff };
}

/* ------------------------------------------------------------------ *
 * Path safety
 * ------------------------------------------------------------------ */
/**
 * Normalise an archive path to a safe, forward-slashed, relative POSIX path.
 * Rejects what could escape the extraction directory: absolute paths, drive
 * letters, UNC prefixes, `..` segments and NUL bytes.
 */
function normalizePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('zip entry path must be a non-empty string');
  }
  if (input.includes('\0')) {
    throw new Error(`zip entry path must not contain NUL bytes: ${JSON.stringify(input)}`);
  }
  // Backslashes are normalised rather than trusted, so Windows-style input
  // cannot smuggle a traversal past the checks below.
  const unified = input.replace(/\\/g, '/');
  if (unified.startsWith('/')) {
    throw new Error(`zip entry path must be relative, got absolute: ${input}`);
  }
  if (/^[A-Za-z]:/.test(unified)) {
    throw new Error(`zip entry path must not contain a drive letter: ${input}`);
  }

  const parts: string[] = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new Error(`zip entry path must not contain '..': ${input}`);
    }
    parts.push(segment);
  }
  if (parts.length === 0) {
    throw new Error(`zip entry path is empty after normalisation: ${JSON.stringify(input)}`);
  }
  return parts.join('/');
}

/* ------------------------------------------------------------------ *
 * Archive writer
 * ------------------------------------------------------------------ */
interface PreparedEntry {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  body: Buffer;
  offset: number;
}

/** Build a ZIP archive. Returns the complete archive as a Buffer. */
export function createZip(entries: ZipEntry[]): Buffer {
  const { date, time } = dosDateTime(new Date());
  const prepared: PreparedEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = normalizePath(entry.path);
    if (seen.has(name)) {
      throw new Error(`duplicate zip entry path: ${name}`);
    }
    seen.add(name);

    const body = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    if (body.length > MAX_UINT32) {
      throw new Error(`zip entry too large for non-ZIP64 archive (${body.length} bytes): ${name}`);
    }

    // Only pay the DEFLATE framing cost when it actually reduces the payload.
    // This is what keeps already-compressed PNGs on STORE.
    const deflated = deflateRawSync(body);
    const useDeflate = deflated.length < body.length;
    const payload = useDeflate ? deflated : body;

    prepared.push({
      name: Buffer.from(name, 'utf8'),
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(body),
      compressedSize: payload.length,
      uncompressedSize: body.length,
      body: payload,
      offset: 0,
    });
  }

  const chunks: Buffer[] = [];
  let offset = 0;

  for (const entry of prepared) {
    if (offset > MAX_UINT32) {
      throw new Error('zip archive too large for non-ZIP64 format');
    }
    entry.offset = offset;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);

    chunks.push(header, entry.name, entry.body);
    offset += header.length + entry.name.length + entry.body.length;
  }

  const centralStart = offset;

  for (const entry of prepared) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIG, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);

    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  }

  const centralSize = offset - centralStart;
  if (centralStart > MAX_UINT32 || centralSize > MAX_UINT32 || prepared.length > 0xffff) {
    throw new Error('zip archive too large for non-ZIP64 format');
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(prepared.length, 8);
  eocd.writeUInt16LE(prepared.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}
