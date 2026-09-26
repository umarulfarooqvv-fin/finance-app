import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { isHeic, toStorable } from '@/lib/image-convert';
import { sniffImage } from '@/lib/storage';

/* ===========================================================================
   HEIC is converted to JPEG when a photo arrives.

   The fixture is a 2 KB synthetic receipt made by macOS's own HEIC encoder —
   the same HEVC profile an iPhone writes — so this exercises the real decoder,
   not a stub. (A real receipt would carry somebody's payment details into the
   repository.)
   =========================================================================== */

const fixture = (name: string) => {
  const buf = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

test('an iPhone-style HEIC comes out as a JPEG', async () => {
  const heic = fixture('receipt.heic');
  assert.equal(sniffImage(heic), 'image/heic', 'the fixture really is HEIC');

  const out = await toStorable(heic, 'image/heic');
  assert.equal(out.converted, true);
  assert.equal(out.mime, 'image/jpeg');
  assert.equal(sniffImage(out.bytes), 'image/jpeg', 'and the bytes really are JPEG now');
});

test('anything that is not HEIC is stored exactly as it came', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const out = await toStorable(jpeg, 'image/jpeg');
  assert.equal(out.converted, false);
  assert.equal(out.bytes, jpeg, 'the same bytes, not a copy');
});

test('a HEIC that cannot be decoded is kept, not lost', async () => {
  // Losing a receipt over its file format would be worse than storing it as-is.
  const broken = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 1, 2, 3]).buffer;
  const out = await toStorable(broken, 'image/heic');
  assert.equal(out.converted, false);
  assert.equal(out.mime, 'image/heic');
  assert.equal(out.bytes, broken);
});

test('HEIF counts as HEIC; other types do not', () => {
  assert.equal(isHeic('image/heic'), true);
  assert.equal(isHeic('image/heif'), true);
  assert.equal(isHeic('image/jpeg'), false);
  assert.equal(isHeic('image/png'), false);
});
