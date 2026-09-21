import assert from 'node:assert/strict';
import { test } from 'vitest';
import { applyFilters, isNarrowed, queryString, readFilters } from '@/app/transactions/filters';
import { tx } from './helpers';

/* ===========================================================================
   Narrowing the transaction list.

   A filter that quietly drops a row does not look broken — it looks like a
   month where you spent less. That is why these assert on what SURVIVES as
   much as on what is excluded.
   =========================================================================== */

const NOW = '2026-09-13T23:59:59';

const rows = [
  tx({ ts: '2026-08-04T10:00:00', amount: 370, method: 'Cash', category: 'Food', remarks: 'Lunch' }),
  tx({ ts: '2026-08-04T19:00:00', amount: 20, method: 'Scapia', category: 'Food', remarks: 'Unknow food' }),
  tx({ ts: '2026-08-22T15:06:50', amount: 1799, method: 'Fi', category: 'Personal', remarks: 'Shirts' }),
  tx({ ts: '2026-09-01T10:32:26', amount: 1000, method: 'Fi', category: 'Credit Given', remarks: 'Arshadali' }),
  tx({ ts: '2026-09-12T07:57:41', amount: 2620.2, method: 'Jupiter', category: 'Coral', remarks: 'Cleared' }),
  tx({ ts: '2026-12-14T00:00:00', amount: 3437.39, method: 'Scapia', category: 'Credit Given', remarks: 'EMI 6/6' }),
];

const run = (sp: Record<string, string>) => applyFilters(rows, readFilters(sp), NOW);

/* --- What the URL is allowed to mean ------------------------------------- */

test('a malformed month or day is ignored, never half-applied', () => {
  // "2026-13" is not a month. Treating it as one would silently return nothing
  // and read as "you spent nothing", which is a lie the UI cannot detect.
  assert.equal(readFilters({ month: '2026-13' }).month, '');
  assert.equal(readFilters({ month: 'August' }).month, '');
  assert.equal(readFilters({ day: '2026-02-30' }).day, '2026-02-30', 'shape is checked, not the calendar');
  assert.equal(readFilters({ day: '4/8/2026' }).day, '');
  assert.equal(readFilters({ month: '2026-08' }).month, '2026-08');
});

test('an amount bound that is not a number does not become a bound', () => {
  assert.equal(readFilters({ min: 'abc' }).min, null);
  assert.equal(readFilters({ min: '-5' }).min, null, 'a negative floor would exclude nothing and confuse');
  assert.equal(readFilters({ min: '' }).min, null);
  // Typed the way a person types money.
  assert.equal(readFilters({ min: '1,000' }).min, 1000);
  assert.equal(readFilters({ max: '₹2,500.50' }).max, 2500.5);
});

/* --- Time ----------------------------------------------------------------- */

test('a month keeps only that month', () => {
  const got = run({ month: '2026-08' });
  assert.equal(got.length, 3);
  assert.ok(got.every((t) => t.ts!.startsWith('2026-08')));
});

test('a day beats a month, because picking both means you meant the day', () => {
  const got = run({ month: '2026-09', day: '2026-08-04' });
  assert.equal(got.length, 2);
  assert.ok(got.every((t) => t.ts!.startsWith('2026-08-04')));
});

test('future rows are hidden until asked for', () => {
  assert.equal(run({}).some((t) => t.remarks === 'EMI 6/6'), false);
  assert.equal(run({ upcoming: '1' }).some((t) => t.remarks === 'EMI 6/6'), true);
});

/* --- Category, method, amount --------------------------------------------- */

test('category and method narrow independently and together', () => {
  assert.equal(run({ cat: 'Food' }).length, 2);
  assert.equal(run({ method: 'Fi' }).length, 2);
  assert.equal(run({ cat: 'Food', method: 'Scapia' }).length, 1);
  // A card name as the category is a bill payment, not spending on that card.
  const bill = run({ cat: 'Coral' });
  assert.equal(bill.length, 1);
  assert.equal(bill[0]?.method, 'Jupiter');
});

test('amount bounds are inclusive at both ends', () => {
  // 1799, 1000 and 2620.20; the 3437.39 instalment is future-dated and hidden.
  assert.equal(run({ min: '1000' }).length, 3, '1000 itself must survive a floor of 1000');
  assert.equal(run({ max: '20' }).length, 1, '20 itself must survive a ceiling of 20');
  assert.equal(run({ min: '20', max: '370' }).length, 2);
  assert.equal(run({ min: '5000' }).length, 0);
});

test('a bound compares the magnitude, not a sign the data never carries', () => {
  // Every amount is stored positive; direction lives in `kind`. A bill payment
  // of 2620.20 must answer a "at least 2000" question.
  const got = run({ min: '2000' });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.remarks, 'Cleared');
});

/* --- Search and combination ----------------------------------------------- */

test('search covers remarks, category and method, case-insensitively', () => {
  assert.equal(run({ q: 'shirts' }).length, 1);
  assert.equal(run({ q: 'SCAPIA' }).length, 1);
  assert.equal(run({ q: 'credit given' }).length, 1);
  assert.equal(run({ q: 'nothing here' }).length, 0);
});

test('filters compose rather than override each other', () => {
  const got = run({ month: '2026-08', cat: 'Food', method: 'Cash', min: '100' });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.remarks, 'Lunch');
});

test('deleted rows are their own view, never mixed into the live list', () => {
  const withDeleted = [...rows, tx({ ts: '2026-08-05T10:00:00', amount: 50, category: 'Food', deleted: true })];
  assert.equal(applyFilters(withDeleted, readFilters({}), NOW).length, 5);
  const binned = applyFilters(withDeleted, readFilters({ deleted: '1' }), NOW);
  assert.equal(binned.length, 1);
  assert.equal(binned[0]?.deleted, true);
});

test('no filters means everything that has already happened', () => {
  assert.equal(run({}).length, 5);
  assert.equal(isNarrowed(readFilters({})), false);
  assert.equal(isNarrowed(readFilters({ cat: 'Food' })), true);
  assert.equal(isNarrowed(readFilters({ page: '3' })), false, 'paging is not narrowing');
});

/* --- The URL is the state ------------------------------------------------- */

test('changing a filter drops the page, so you never land on a page that is gone', () => {
  const qs = queryString({ cat: 'Food', page: '4' }, { cat: 'Fuel', page: undefined });
  assert.ok(qs.includes('cat=Fuel'));
  assert.ok(!qs.includes('page='));
});

test('an empty override removes the parameter instead of blanking it', () => {
  assert.equal(queryString({ cat: 'Food' }, { cat: '' }), '?');
  assert.ok(queryString({ cat: 'Food', method: 'Fi' }, { cat: undefined }).includes('method=Fi'));
});

/* --- Several at once ------------------------------------------------------ */

/* Two categories is a WIDER question, not an impossible one: "Food and
   Personal" means either, because no row is both. Reading it as "and" would
   always return nothing, which looks exactly like a month with no spending. */
test('several categories mean ANY of them', () => {
  assert.equal(run({ cat: 'Food' }).length, 2);
  assert.equal(run({ cat: 'Personal' }).length, 1);
  assert.equal(run({ cat: 'Food,Personal' }).length, 3);
});

test('several methods mean ANY of them', () => {
  assert.equal(run({ method: 'Fi,Cash' }).length, 3);
});

test('a multi-select still narrows across the two together', () => {
  // Food or Personal, but only on Scapia.
  assert.equal(run({ cat: 'Food,Personal', method: 'Scapia' }).length, 1);
});

test('blanks and repeats in the list are ignored rather than matching nothing', () => {
  assert.equal(run({ cat: 'Food,,Food, ' }).length, 2);
  assert.deepEqual(readFilters({ cat: 'Food,,Food' }).category, ['Food']);
});

test('an empty list is the same as no filter at all', () => {
  assert.equal(run({ cat: '' }).length, run({}).length);
  assert.equal(isNarrowed(readFilters({ cat: '' })), false);
  assert.equal(isNarrowed(readFilters({ cat: 'Food' })), true);
});

/* --- Searching by amount -------------------------------------------------- */

/* Typing the price you remember is the obvious thing to try, and before this
   it silently found nothing. */
test('a numeric query searches the amount as well as the text', () => {
  assert.equal(run({ q: '1799' }).length, 1);
  assert.equal(run({ q: '1799' })[0]!.remarks, 'Shirts');
});

test('a partial figure finds it, so the exact paisa need not be remembered', () => {
  assert.equal(run({ q: '2620' })[0]!.remarks, 'Cleared');
  assert.equal(run({ q: '2620.2' })[0]!.remarks, 'Cleared');
});

test('commas and a rupee sign in the query are ignored', () => {
  assert.equal(run({ q: '₹1,799' }).length, 1);
});

test('a text query still searches text, and does not become an amount', () => {
  assert.equal(run({ q: 'Shirts' }).length, 1);
  assert.equal(run({ q: 'Food' }).length, 2);
});

test('a number that matches nothing returns nothing rather than everything', () => {
  assert.equal(run({ q: '987654' }).length, 0);
});
