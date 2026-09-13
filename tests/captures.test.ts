import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES, CAPTURE_BUCKET, extensionFor, isAllowedImage, MAX_IMAGE_BYTES,
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
