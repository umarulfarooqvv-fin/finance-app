import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, classifyRow, parseRemarkTags, parseCsv, normalizeRows } from '../lib/parser.js';

test('format A: custom form timestamp with centiseconds', () => {
  const r = parseTimestamp(' 11, March 26 at 08:06:31:04 PM');
  assert.ok(r);
  assert.equal(r.date.getFullYear(), 2026);
  assert.equal(r.date.getMonth(), 2); // March
  assert.equal(r.date.getDate(), 11);
  assert.equal(r.date.getHours(), 20);
  assert.equal(r.date.getMinutes(), 6);
  assert.equal(r.dateOnly, false);
});

test('format A: 12 AM date-only convention', () => {
  const r = parseTimestamp(' 15, March 26 at 12:00:00:00 AM');
  assert.ok(r);
  assert.equal(r.dateOnly, true);
  assert.equal(r.date.getHours(), 0);
});

test('format A: 12 PM is noon, not midnight', () => {
  const r = parseTimestamp(' 01, April 26 at 12:14:20:30 PM');
  assert.equal(r.date.getHours(), 12);
});

test('format B: plain sheets timestamp', () => {
  const r = parseTimestamp('5/21/2026 14:13:19');
  assert.ok(r);
  assert.equal(r.date.getFullYear(), 2026);
  assert.equal(r.date.getMonth(), 4);
  assert.equal(r.date.getDate(), 21);
  assert.equal(r.date.getHours(), 14);
  assert.equal(r.dateOnly, false);
});

test('unparseable timestamp returns null', () => {
  assert.equal(parseTimestamp('not a date'), null);
  assert.equal(parseTimestamp(''), null);
});

test('classification: spend on a card increases card debt', () => {
  const c = classifyRow({ amount: 318.54, method: 'Scapia', category: 'Fuel', remarks: 'Nayara' });
  assert.equal(c.kind, 'spend');
  assert.deepEqual(c.cardAffected, { card: 'Scapia', direction: 'debt+' });
});

test('classification: spend via Fi has no card debt', () => {
  const c = classifyRow({ amount: 80, method: 'Fi', category: 'Family', remarks: 'Samosa' });
  assert.equal(c.kind, 'spend');
  assert.equal(c.cardAffected, null);
});

test('classification: category = card name → payment TO that card', () => {
  const c = classifyRow({ amount: 4136.03, method: 'Fi', category: 'Coral', remarks: 'Cleared' });
  assert.equal(c.kind, 'card_payment');
  assert.deepEqual(c.cardAffected, { card: 'Coral', direction: 'debt-' });
});

test('classification: card paying another card', () => {
  const c = classifyRow({ amount: 189.57, method: 'Jupiter', category: 'One Card', remarks: 'Cleared with credit given' });
  assert.equal(c.kind, 'card_payment');
  assert.deepEqual(c.cardAffected, { card: 'One Card', direction: 'debt-' });
});

test('classification: credit given via card is still card debt', () => {
  const c = classifyRow({ amount: 5150, method: 'Scapia', category: 'Credit Given', remarks: 'Ashiq sudu' });
  assert.equal(c.kind, 'credit_given');
  assert.deepEqual(c.cardAffected, { card: 'Scapia', direction: 'debt+' });
});

test('tags: EMI counter, component, trip, cirqle', () => {
  let t = parseRemarkTags("Sheya's 18/24 Emi");
  assert.deepEqual(t.emi, { n: 18, m: 24 });
  assert.equal(t.emiComponent, 'principal');

  t = parseRemarkTags('Ipad Mini 14/24 Charge');
  assert.equal(t.emiComponent, 'surcharge');

  t = parseRemarkTags('Ipad Mini 14/24 Tax');
  assert.equal(t.emiComponent, 'tax');

  t = parseRemarkTags('Waterbottle  (Trip Ponnani to Ernakulam)');
  assert.equal(t.trip, 'Ponnani to Ernakulam');

  t = parseRemarkTags('Ipad Mini 13/24 (Cirqle)');
  assert.equal(t.cirqle, true);

  t = parseRemarkTags('Credit given to ashiq sudu is cleared');
  assert.equal(t.cleared, true);
});

test('csv: quoted field with embedded newline', () => {
  const rows = parseCsv('"a","b1\nb2","c"\n"d","e","f"');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], 'b1\nb2');
});

test('normalizeRows: skips empty trailing rows, flags blanks', () => {
  const csv = [
    '"Timestamp","Enter Payment Made","Payment Method","Category of Payment","Remarks","x","y","z",""',
    '" 11, March 26 at 11:53:55:48 AM","","Scapia","Food","","FALSE","FALSE","",""',
    '"5/21/2026 14:13:19","155","Scapia","Family","Sugar medicine uppa 50","FALSE","FALSE","",""',
    '"","","","","","FALSE","FALSE","",""',
  ].join('\n');
  const rows = normalizeRows(parseCsv(csv));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, null);
  assert.equal(rows[0].needsReview, true);
  assert.equal(rows[1].amount, 155);
  assert.equal(rows[1].sheetRow, 3);
  assert.equal(rows[1].needsReview, false);
});
