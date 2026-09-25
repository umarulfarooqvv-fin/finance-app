import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES, CAPTURE_BUCKET, extensionFor, isAllowedImage, MAX_IMAGE_BYTES,
  sniffImage,
} from '@/lib/storage';

/* ===========================================================================
   What the capture endpoint will and will not accept.

   The gate matters more than it looks: the bucket is private and every byte is
   served back through a session-guarded route, so anything accepted here is
   something the app will later hand to a browser with a Content-Type it was
   told. Accepting text/html would make that an XSS surface on the app's own
   origin.
   =========================================================================== */

test('only real image types are accepted', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
    assert.equal(isAllowedImage(ok), true, ok);
  }
  for (const no of [
    'text/html', 'image/svg+xml', 'application/pdf', 'application/octet-stream',
    'text/plain', '', 'image/jpeg; charset=utf-8',
  ]) {
    assert.equal(isAllowedImage(no), false, no);
  }
});

test('SVG is refused, because it is a document that executes', () => {
  // An <svg> can carry script and would run on the app's own origin when
  // served back. It is the one "image" type that is not inert.
  assert.equal(isAllowedImage('image/svg+xml'), false);
});

test('HEIC is accepted, because that is what an iPhone produces', () => {
  assert.equal(isAllowedImage('image/heic'), true);
  assert.equal(extensionFor('image/heic'), 'heic');
});

test('every accepted type has a file extension', () => {
  for (const mime of ALLOWED_IMAGE_TYPES) {
    const ext = extensionFor(mime);
    assert.notEqual(ext, 'bin', `${mime} fell back to the unknown extension`);
    assert.match(ext, /^[a-z]+$/);
  }
});

test('an unknown type still gets a safe extension rather than throwing', () => {
  assert.equal(extensionFor('application/zip'), 'bin');
});

test('the size limit matches the database constraint and the bucket', () => {
  // db/migrations/002_captures.sql: check (bytes > 0 and bytes <= 20971520)
  assert.equal(MAX_IMAGE_BYTES, 20971520);
});

test('the bucket name is fixed, since the migration and the bucket must agree', () => {
  assert.equal(CAPTURE_BUCKET, 'captures');
});

/* ---------------------------------------------------------------------------
   Recognising a photo by its bytes.

   A Shortcut chooses the Content-Type for you and gets it wrong invisibly:
   "Get Contents of URL" left on its default Request Body of JSON posts the
   photo itself as application/json. Refusing that over a header is a dead end
   on a phone — the bytes were a perfectly good JPEG the whole time.
   --------------------------------------------------------------------------- */

/** A buffer that starts with these bytes and is long enough to sniff. */
function header(...bytes: number[]): ArrayBuffer {
  const b = new Uint8Array(32);
  b.set(bytes);
  return b.buffer;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test('a JPEG is recognised whatever the request claimed it was', () => {
  assert.equal(sniffImage(header(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
});

test('a PNG is recognised by its signature', () => {
  assert.equal(sniffImage(header(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
});

test('WebP needs both RIFF and WEBP, not just RIFF', () => {
  assert.equal(sniffImage(header(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'))), 'image/webp');
  // A RIFF container that is a WAV is not an image.
  assert.equal(sniffImage(header(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE'))), null);
});

test('an iPhone HEIC is recognised by its ftyp brand', () => {
  assert.equal(sniffImage(header(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic'))), 'image/heic');
  assert.equal(sniffImage(header(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mif1'))), 'image/heif');
});

test('an ISO container that is not a still image is not claimed', () => {
  // An MP4 is the same box structure with a video brand. Accepting it would
  // put a film in the bucket where a receipt should be.
  assert.equal(sniffImage(header(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom'))), null);
});

test('anything else, including JSON and truncated bytes, is refused', () => {
  assert.equal(sniffImage(header(...ascii('{"image":"..."}'))), null, 'real JSON is not an image');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]).buffer), null, 'too short to be sure');
  assert.equal(sniffImage(new ArrayBuffer(0)), null);
});

test('every type the sniffer names is one the app actually accepts', () => {
  // Otherwise it would recognise a photo and then refuse it anyway.
  for (const bytes of [
    header(0xff, 0xd8, 0xff, 0xe0),
    header(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a),
    header(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')),
    header(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')),
    header(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mif1')),
  ]) {
    const mime = sniffImage(bytes);
    assert.ok(mime, 'recognised');
    assert.equal(isAllowedImage(mime), true, mime);
    assert.notEqual(extensionFor(mime), 'bin', `${mime} has a real extension`);
  }
});
