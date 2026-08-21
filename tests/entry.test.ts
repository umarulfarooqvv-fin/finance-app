import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseEntry, parseAmount, toRow } from '../src/domain/entry.ts';

test('amounts arrive in several shapes', () => {
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount('₹1234'), 1234);
  assert.equal(parseAmount(' 99 '), 99);
  assert.equal(parseAmount(500), 500);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount('abc'), null);
});

test('a card spend from the Shortcut is classified and dated', async () => {
  const e = await normaliseEntry({ amount: '480', method: 'Coral', category: 'Food', remarks: 'Lunch' });
  assert.equal(e.amount, 480);
  assert.equal(e.kind, 'spend');
  assert.equal(e.cardAffected, 'Coral');
  assert.equal(e.cardDirection, 'debt+');
  assert.equal(e.verified, false);
  assert.equal(e.needsReview, false);
  assert.match(e.ts!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('a bill payment from the Shortcut credits the right card', async () => {
  const e = await normaliseEntry({ amount: '5000', method: 'Fi', category: 'Edge', remarks: 'Bill' });
  assert.equal(e.kind, 'card_payment');
  assert.equal(e.cardAffected, 'Edge');
  assert.equal(e.cardDirection, 'debt-');
});

test('a missing amount is flagged rather than stored as zero', async () => {
  const e = await normaliseEntry({ amount: '', method: 'Fi', category: 'Food', remarks: '' });
  assert.equal(e.amount, null);
  assert.equal(e.needsReview, true);
});

test('the id is derived from content, so a retried post cannot double-count', async () => {
  const input = { amount: '480', method: 'Coral', category: 'Food', remarks: 'Lunch', ts: '2026-08-21T10:00:00' };
  const a = await normaliseEntry(input);
  const b = await normaliseEntry(input);
  assert.equal(a.id, b.id, 'the same entry must produce the same id');

  const different = await normaliseEntry({ ...input, amount: '481' });
  assert.notEqual(a.id, different.id, 'a different amount must be a different row');
});

test('the row shape matches the Postgres columns', async () => {
  const row = toRow(await normaliseEntry({ amount: '100', method: 'Coral', category: 'Fuel', remarks: 'x' }));
  for (const col of ['id', 'ts', 'amount', 'method', 'category', 'remarks', 'kind',
                     'card_affected', 'card_direction', 'tags', 'verified',
                     'needs_review', 'deleted', 'source']) {
    assert.ok(col in row, `missing column ${col}`);
  }
  // camelCase must not leak through to the database.
  assert.ok(!('cardAffected' in row));
  assert.ok(!('needsReview' in row));
});
