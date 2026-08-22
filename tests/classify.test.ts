import assert from 'node:assert/strict';
import { test } from 'vitest';
import { classify, parsePerson, parseTags, parseTimestamp } from '@/lib/classify';
import { fixtureTransactions } from './helpers.ts';

test('parses the form custom format, with centiseconds', () => {
  const p = parseTimestamp(' 08, March 26 at 03:58:47:71 PM');
  assert.equal(p?.ts, '2026-03-08T15:58:47');
  assert.equal(p?.dateOnly, false);
});

test('12:00:00:00 AM is the date-only convention, not midnight data', () => {
  const p = parseTimestamp(' 21, May 26 at 12:00:00:00 AM');
  assert.equal(p?.ts, '2026-05-21T00:00:00');
  assert.equal(p?.dateOnly, true);
  // A real midnight-adjacent time is NOT date-only.
  assert.equal(parseTimestamp(' 21, May 26 at 12:01:00:00 AM')?.dateOnly, false);
});

test('parses the plain sheets format the sheet switched to', () => {
  assert.equal(parseTimestamp('5/21/2026 14:13:19')?.ts, '2026-05-21T14:13:19');
  assert.equal(parseTimestamp('12/1/2026 9:05')?.ts, '2026-12-01T09:05:00');
});

test('parses the dashed history format, weekday and all', () => {
  const p = parseTimestamp('06-July-2024,  Saturday');
  assert.equal(p?.ts, '2024-07-06T00:00:00');
  assert.equal(p?.dateOnly, true);
});

test('unparseable timestamps return null rather than a guess', () => {
  for (const bad of ['', '   ', 'yesterday', '32/13/2026 10:00', null, undefined]) {
    assert.equal(parseTimestamp(bad), null);
  }
});

test('PM/AM conversion is right at the 12 boundary', () => {
  assert.equal(parseTimestamp(' 01, June 26 at 12:30:00:00 PM')?.ts, '2026-06-01T12:30:00'); // noon
  assert.equal(parseTimestamp(' 01, June 26 at 12:30:00:00 AM')?.ts, '2026-06-01T00:30:00'); // after midnight
  assert.equal(parseTimestamp(' 01, June 26 at 01:00:00:00 PM')?.ts, '2026-06-01T13:00:00');
});

test('remarks tags: trip, cirqle, EMI counter and components', () => {
  assert.equal(parseTags('Fuel (Trip Ponnani to Ernakulam)').trip, 'Ponnani to Ernakulam');
  assert.equal(parseTags('Domain renewal (Cirqle)').cirqle, true);

  const emi = parseTags("Sheya's 18/24 Emi");
  assert.deepEqual(emi.emi, { n: 18, m: 24 });
  assert.equal(emi.emiName, 'Sheya');
  assert.equal(emi.emiComponent, 'principal');

  assert.equal(parseTags('Ipad Mini 15/24 Surcharge').emiComponent, 'surcharge');
  assert.equal(parseTags('Ipad Mini 15/24 Tax').emiComponent, 'tax');
  assert.equal(parseTags('Fayiz payment cleared').cleared, true);
});

test('an n/m counter is only an EMI when the numbers make sense', () => {
  // A date in the remarks must not invent a 24-instalment plan.
  assert.equal(parseTags('Paid on 5/21 for lunch').emi, undefined);
  // n cannot exceed m.
  assert.equal(parseTags('Random 30/24 note').emi, undefined);
  // Nor can the plan be implausibly long.
  assert.equal(parseTags('Ref 12/99').emi, undefined);
  // But a real one still parses.
  assert.deepEqual(parseTags('Laptop 3/12').emi, { n: 3, m: 12 });
});

test('a spend on a card increases that card debt', () => {
  const c = classify({ method: 'Coral', category: 'Food', remarks: 'Lunch' });
  assert.equal(c.kind, 'spend');
  assert.equal(c.cardAffected, 'Coral');
  assert.equal(c.cardDirection, 'debt+');
});

test('a spend from a bank account touches no card', () => {
  const c = classify({ method: 'Fi', category: 'Food', remarks: 'Samosa' });
  assert.equal(c.kind, 'spend');
  assert.equal(c.cardAffected, null);
});

test('category naming a card is a payment TO that card', () => {
  const c = classify({ method: 'Fi', category: 'Coral', remarks: 'Bill payment' });
  assert.equal(c.kind, 'card_payment');
  assert.equal(c.cardAffected, 'Coral');
  assert.equal(c.cardDirection, 'debt-');
});

test('paying one card from another moves debt to the paying card', () => {
  // Category wins for the card being cleared; the paying card is the method.
  const c = classify({ method: 'Edge', category: 'ICICI', remarks: 'Cleared ICICI' });
  assert.equal(c.kind, 'card_payment');
  assert.equal(c.cardAffected, 'ICICI');
  assert.equal(c.cardDirection, 'debt-');
});

test('the legacy "Credit Card" category finds its target in the remarks', () => {
  const c = classify({ method: 'Fi', category: 'Credit Card', remarks: 'Edge Credit Card Bill Payment' });
  assert.equal(c.kind, 'card_payment');
  assert.equal(c.cardAffected, 'Edge');
  // With no card named, it stays a card_payment but affects nothing — it must
  // never guess and silently credit the wrong card.
  const blind = classify({ method: 'Fi', category: 'Credit Card', remarks: 'Bill payment' });
  assert.equal(blind.cardAffected, null);
});

test('credit given by card is still card debt, and names the person', () => {
  const c = classify({ method: 'Coral', category: 'Credit Given', remarks: 'Fayiz' });
  assert.equal(c.kind, 'credit_given');
  assert.equal(c.cardAffected, 'Coral');
  assert.equal(c.cardDirection, 'debt+');
  assert.equal(c.tags.person, 'Fayiz');
});

test('investments are transfers, never spend', () => {
  const c = classify({ method: 'Fi', category: 'Investment', remarks: 'SIP' });
  assert.equal(c.kind, 'investment');
});

test('an unrecognised category is flagged, not counted', () => {
  assert.equal(classify({ method: 'Fi', category: 'Wat', remarks: 'x' }).kind, 'unknown');
});

test('person extraction strips bookkeeping words', () => {
  assert.equal(parsePerson('Fayiz'), 'Fayiz');
  assert.equal(parsePerson('Credit given to Ashiq sudu'), 'Ashiq sudu');
  assert.equal(parsePerson('500'), null);
});

test('the real sheet fixture parses cleanly end to end', async () => {
  const rows = await fixtureTransactions();
  assert.ok(rows.length > 300, `expected the full fixture, got ${rows.length}`);

  // Every row must land on a real date. A null here is what silently blanked
  // the date column and starved every date-based analytic in v2.
  const undated = rows.filter((r) => r.ts === null);
  assert.equal(undated.length, 0, `${undated.length} rows failed to parse a timestamp`);

  // Classification must reach a verdict on essentially everything.
  const unknown = rows.filter((r) => r.kind === 'unknown');
  assert.ok(unknown.length / rows.length < 0.02, `too many unclassified rows: ${unknown.length}`);

  // Card charges and card payments both have to be present and directional.
  assert.ok(rows.some((r) => r.cardDirection === 'debt+'));
  assert.ok(rows.some((r) => r.cardDirection === 'debt-'));
  for (const r of rows) {
    if (r.cardDirection) assert.ok(r.cardAffected, 'a direction with no card is incoherent');
  }
});
