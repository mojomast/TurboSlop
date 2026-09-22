/**
 * turboslop — ZIP writer tests.
 *
 * The archive is the last thing a user touches, so the things worth protecting
 * are: the checksum, the recorded sizes/offsets, and the entry path. Most tests
 * verify by *extracting* rather than by reading fields back, because a writer
 * that agrees with itself can still be wrong.
 *
 * Two independent readers are used:
 *  - a small in-test parser (central directory walk + zig-zag-free local
 *    headers), which proves offsets even when no system `unzip` exists;
 *  - the real Info-ZIP `unzip`, when present, which proves interoperability.
 *    If `unzip` is missing those tests print a skip note instead of failing.
 *
 * Run: npm run test:zip
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createZip, crc32 } from '../src/zip.js';

let passed = 0;
let failed = 0;
let skipped = 0;
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
function skip(name: string, reason: string): void {
  skipped++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
let tmpSeq = 0;
function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), `forge-zip-${process.pid}-${tmpSeq++}-`));
}

const hasUnzip = (() => {
  try {
    execFileSync('which', ['unzip'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Extract with the system Info-ZIP unzip and return `relative-path -> bytes`. */
function unzipTo(dir: string, zipPath: string): Map<string, Buffer> {
  const out = path.join(dir, 'extracted');
  mkdirSync(out, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', out], { stdio: 'pipe' });
  const files = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.endsWith('/'));
  const result = new Map<string, Buffer>();
  for (const rel of files) {
    result.set(rel, readFileSync(path.join(out, rel)));
  }
  return result;
}

/**
 * A self-contained reader: walk the central directory, then each local header,
 * decompress and verify CRC/sizes. This catches offset bugs without `unzip`.
 */
function extractWithNode(archive: Buffer): Map<string, Buffer> {
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = archive.lastIndexOf(eocdSig);
  assert.ok(eocd >= 0, 'end-of-central-directory signature not found');
  assert.equal(eocd, archive.length - 22, 'EOCD must be the final record (no comment)');

  const total = archive.readUInt16LE(eocd + 10);
  const cdSize = archive.readUInt32LE(eocd + 12);
  const cdOffset = archive.readUInt32LE(eocd + 16);
  assert.equal(archive.readUInt16LE(eocd + 8), total, 'entry counts must agree');
  assert.equal(cdOffset + cdSize, eocd, 'central directory must abut the EOCD');

  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    assert.equal(archive.readUInt32LE(p), 0x02014b50, 'central header signature');
    const method = archive.readUInt16LE(p + 10);
    const crc = archive.readUInt32LE(p + 16);
    const compressedSize = archive.readUInt32LE(p + 20);
    const uncompressedSize = archive.readUInt32LE(p + 24);
    const nameLen = archive.readUInt16LE(p + 28);
    const extraLen = archive.readUInt16LE(p + 30);
    const commentLen = archive.readUInt16LE(p + 32);
    const localOffset = archive.readUInt32LE(p + 42);
    const name = archive.toString('utf8', p + 46, p + 46 + nameLen);

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, `local header signature (${name})`);
    assert.equal(archive.readUInt16LE(localOffset + 8), method, `local/central method mismatch (${name})`);
    assert.equal(archive.readUInt32LE(localOffset + 14), crc, `local/central CRC mismatch (${name})`);
    assert.equal(archive.readUInt32LE(localOffset + 18), compressedSize, `local/central size mismatch (${name})`);
    const localNameLen = archive.readUInt16LE(localOffset + 26);
    const localExtraLen = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const stored = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);

    assert.equal(data.length, uncompressedSize, `uncompressed size mismatch (${name})`);
    assert.equal(crc32(data), crc, `CRC mismatch (${name})`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Assert expected entries came back byte-for-byte, and nothing extra. */
function assertSame(actual: Map<string, Buffer>, expected: Map<string, Buffer>): void {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'entry names differ');
  for (const [name, want] of expected) {
    assert.ok(actual.get(name)!.equals(want), `bytes differ for ${name}`);
  }
}

/** Read the compression method from the first local file header. */
function firstMethod(archive: Buffer): number {
  assert.equal(archive.readUInt32LE(0), 0x04034b50, 'expected a local header first');
  return archive.readUInt16LE(8);
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

console.log('\n=== turboslop / zip ===\n');
console.log(`  info  unzip: ${hasUnzip ? execFileSync('which', ['unzip'], { encoding: 'utf8' }).trim() : 'NOT INSTALLED — round-trip tests will be skipped'}\n`);

/* ---- CRC-32 vectors ---- */
await test('crc32 matches the standard IEEE test vectors', () => {
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('a')), 0xe8b7be43);
  assert.equal(crc32(Buffer.from('abc')), 0x352441c2);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  // Multi-byte input crosses the table boundary more than once.
  assert.equal(crc32(Buffer.from('a'.repeat(1024))), 0x7c5597b9);
});

/* ---- structural signatures ---- */
await test('archive carries local, central and EOCD signatures with the right count', () => {
  const archive = createZip([
    { path: 'index.html', data: '<h1>hi</h1>' },
    { path: 'assets/a/00-backdrop-1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) },
  ]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50, 'local file header signature');
  assert.ok(archive.includes(Buffer.from('PK\x01\x02', 'latin1')), 'central directory signature');
  const eocd = archive.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  assert.ok(eocd >= 0, 'end-of-central-directory signature');
  assert.equal(archive.readUInt16LE(eocd + 8), 2, 'entries on this disk');
  assert.equal(archive.readUInt16LE(eocd + 10), 2, 'total entries');
  // UTF-8 name flag on the first local header.
  assert.equal(archive.readUInt16LE(6), 0x0800, 'general purpose bit 11 must be set');
});

/* ---- self-contained round trip (no external tools) ---- */
await test('node reader round-trips nested, unicode, zero-byte and text entries', () => {
  const entries = [
    { path: 'index.html', data: '<!doctype html><title>forged</title>' },
    { path: 'assets/a/00-backdrop-1.png', data: randomBytes(2048) },
    { path: './nested/deep/hmm.txt', data: 'normalised' },
    { path: '空白/файл-🎨.txt', data: 'unicode payload' },
    { path: 'empty.bin', data: Buffer.alloc(0) },
  ];
  const archive = createZip(entries);
  const expected = new Map<string, Buffer>([
    ['index.html', Buffer.from('<!doctype html><title>forged</title>')],
    ['assets/a/00-backdrop-1.png', entries[1]!.data as Buffer],
    ['nested/deep/hmm.txt', Buffer.from('normalised')],
    ['空白/файл-🎨.txt', Buffer.from('unicode payload')],
    ['empty.bin', Buffer.alloc(0)],
  ]);
  assertSame(extractWithNode(archive), expected);
});

/* ---- unzip interoperability ---- */
await test('unzip -t reports integrity and entries match byte-for-byte', () => {
  if (!hasUnzip) return skip('unzip round trip', 'unzip not installed');
  const dir = tempDir();
  const zipPath = path.join(dir, 'roundtrip.zip');
  const png = randomBytes(8192);
  const entries = [
    { path: 'index.html', data: '<h1>hello</h1>' },
    { path: 'assets/a/00-backdrop-1.png', data: png },
    { path: 'zero.dat', data: Buffer.alloc(0) },
  ];
  writeFileSync(zipPath, createZip(entries));

  // -t exits non-zero on any CRC/size error.
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  const extracted = unzipTo(dir, zipPath);
  assertSame(extracted, new Map<string, Buffer>([
    ['index.html', Buffer.from('<h1>hello</h1>')],
    ['assets/a/00-backdrop-1.png', png],
    ['zero.dat', Buffer.alloc(0)],
  ]));
  assert.equal(sha256(extracted.get('assets/a/00-backdrop-1.png')!), sha256(png), 'sha256 must match');
});

await test('unicode filename survives a real unzip round trip', () => {
  if (!hasUnzip) return skip('unicode round trip', 'unzip not installed');
  const dir = tempDir();
  const zipPath = path.join(dir, 'unicode.zip');
  const name = 'assets/空白-🎨/café.txt';
  writeFileSync(zipPath, createZip([{ path: name, data: 'résumé' }]));
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  const extracted = unzipTo(dir, zipPath);
  assertSame(extracted, new Map([[name, Buffer.from('résumé')]]));
});

await test('empty archive is valid and extractable', () => {
  const archive = createZip([]);
  assert.equal(archive.length, 22, 'a bare EOCD is 22 bytes');
  assert.equal(archive.readUInt32LE(0), 0x06054b50);
  assert.equal(archive.readUInt16LE(10), 0, 'zero entries');
  assert.equal(extractWithNode(archive).size, 0);

  if (!hasUnzip) return skip('empty archive extract', 'unzip not installed');
  const dir = tempDir();
  const zipPath = path.join(dir, 'empty.zip');
  writeFileSync(zipPath, archive);
  // Info-ZIP reports a well-formed zero-entry archive as "zipfile is empty"
  // and exits 1. That is an empty-file warning, not corruption: tolerate it.
  const out = path.join(dir, 'extracted');
  mkdirSync(out, { recursive: true });
  for (const args of [['-t', zipPath], ['-o', '-q', zipPath, '-d', out]]) {
    try {
      execFileSync('unzip', args, { stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const text = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
      assert.match(text, /zipfile is empty/i, `unexpected unzip failure: ${text}`);
    }
  }
  assert.deepEqual(readdirSync(out), [], 'an empty archive must extract no files');
});

/* ---- compression method selection ---- */
await test('STORE is chosen for incompressible data and DEFLATE for compressible', () => {
  const incompressible = randomBytes(4096);
  const compressible = Buffer.from('a'.repeat(8192));

  const stored = createZip([{ path: 'noise.bin', data: incompressible }]);
  assert.equal(firstMethod(stored), 0, 'random bytes must not pay the DEFLATE framing cost');
  assertSame(extractWithNode(stored), new Map([['noise.bin', incompressible]]));

  const deflated = createZip([{ path: 'run.txt', data: compressible }]);
  assert.equal(firstMethod(deflated), 8, 'a long run must be deflated');
  assert.ok(deflated.length < compressible.length, 'deflate must have shrunk the payload');
  assertSame(extractWithNode(deflated), new Map([['run.txt', compressible]]));

  if (!hasUnzip) return skip('method round trip via unzip', 'unzip not installed');
  const dir = tempDir();
  const mixed = path.join(dir, 'mixed.zip');
  writeFileSync(mixed, createZip([
    { path: 'noise.bin', data: incompressible },
    { path: 'run.txt', data: compressible },
  ]));
  execFileSync('unzip', ['-t', mixed], { stdio: 'pipe' });
  assertSame(unzipTo(dir, mixed), new Map([
    ['noise.bin', incompressible],
    ['run.txt', compressible],
  ]));
});

/* ---- safety ---- */
await test('path traversal and absolute paths are rejected', () => {
  for (const bad of ['../evil', 'a/../../evil', '/abs', '/etc/passwd', 'C:\\Windows\\evil', '\\\\server\\share', 'ok/../../..']) {
    assert.throws(() => createZip([{ path: bad, data: 'x' }]), /relative|'\.\.'|drive letter/, `should reject ${bad}`);
  }
  // Normalisation is allowed but can never introduce a traversal.
  assert.doesNotThrow(() => createZip([{ path: './a/./b.txt', data: 'x' }]));
  assert.throws(() => createZip([{ path: '', data: 'x' }]), /non-empty/);
  assert.throws(() => createZip([{ path: './', data: 'x' }]), /empty after normalisation/);
});

await test('duplicate paths are rejected with a clear error', () => {
  assert.throws(
    () => createZip([
      { path: 'index.html', data: 'one' },
      { path: './index.html', data: 'two' },
    ]),
    /duplicate zip entry path: index\.html/,
  );
});

/* ---- scale ---- */
await test('a ~5 MB incompressible payload round-trips byte-identically', () => {
  const payload = randomBytes(5 * 1024 * 1024);
  const archive = createZip([{ path: 'big/noise.bin', data: payload }]);
  assert.equal(firstMethod(archive), 0, 'incompressible 5 MB should be stored');
  const viaNode = extractWithNode(archive);
  assert.ok(viaNode.get('big/noise.bin')!.equals(payload), 'node reader bytes differ');

  if (!hasUnzip) return skip('5 MB unzip round trip', 'unzip not installed');
  const dir = tempDir();
  const zipPath = path.join(dir, 'big.zip');
  writeFileSync(zipPath, archive);
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  const extracted = unzipTo(dir, zipPath);
  assert.equal(sha256(extracted.get('big/noise.bin')!), sha256(payload), 'sha256 differs after unzip');
});

console.log(`\n${skipped ? `${skipped} skipped; ` : ''}${failed ? `FAILURES: ${failed}, passed: ${passed}` : `all ${passed} checks passed`}\n`);
process.exit(failed ? 1 : 0);
