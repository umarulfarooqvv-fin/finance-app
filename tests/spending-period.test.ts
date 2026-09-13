import assert from 'node:assert/strict';
import { test } from 'vitest';
import { comparisonFor, granularity, readPeriod } from '@/lib/period';

/* ===========================================================================
   The stretch of time the Spending page describes.

   The comparison matters more than the range here. "+13.5% versus last month"
   is a sentence people act on, and it is only true if the window underneath it
   is the one the label claims.
   =========================================================================== */

const TODAY = '2026-09-13';
const EARLIEST = '2024-07-06';

const p = (sp: Record<string, string>) => readPeriod(sp, TODAY, EARLIEST);

/* --- Resolving ------------------------------------------------------------ */

test('the default is the month so far, exactly as before', () => {
  const got = p({});
  assert.equal(got.kind, 'mtd');
  assert.equal(got.from, '2026-09-01');
  assert.equal(got.to, TODAY);
  assert.equal(got.days, 13);
});

test('anything unparseable falls back rather than resolving to nothing', () => {
  // A range that silently resolved to zero days would read as "you spent
  // nothing", which is the one wrong answer that looks plausible.
  const bads: Record<string, string>[] = [
    { p: 'month', m: '2026-13' }, { p: 'year', y: '26' }, { p: 'days', n: 'ten' },
    { p: 'range', from: 'x', to: '2026-01-01' }, { p: 'nonsense' },
  ];
  for (const bad of bads) {
    assert.equal(p(bad).kind, 'mtd', `${JSON.stringify(bad)} should fall back`);
  }
});

test('a completed month is the whole month; the current one stops at today', () => {
  const aug = p({ p: 'month', m: '2026-08' });
  assert.deepEqual([aug.from, aug.to, aug.days, aug.running], ['2026-08-01', '2026-08-31', 31, false]);

  const sep = p({ p: 'month', m: '2026-09' });
  assert.deepEqual([sep.from, sep.to, sep.running], ['2026-09-01', TODAY, true]);
});

test('a year never runs past today', () => {
  const past = p({ p: 'year', y: '2025' });
  assert.deepEqual([past.from, past.to, past.days], ['2025-01-01', '2025-12-31', 365]);

  const now = p({ p: 'year', y: '2026' });
  assert.equal(now.to, TODAY, 'a year in progress cannot end in December');
  assert.equal(now.running, true);
});

test('a preset span counts today as one of its days', () => {
  const week = p({ p: 'days', n: '7' });
  assert.equal(week.from, '2026-09-07', '7 days ending today starts on the 7th, not the 6th');
  assert.equal(week.days, 7);
});

test('a custom range given backwards is read forwards', () => {
  const got = p({ p: 'range', from: '2026-03-31', to: '2026-01-01' });
  assert.deepEqual([got.from, got.to], ['2026-01-01', '2026-03-31']);
});

test('a custom range is clamped to today, never projected', () => {
  const got = p({ p: 'range', from: '2026-09-01', to: '2027-12-31' });
  assert.equal(got.to, TODAY);
  assert.equal(got.days, 13, 'days must count only days that have happened');
});

test('all time starts where the data does', () => {
  const got = p({ p: 'all' });
  assert.equal(got.from, EARLIEST);
  assert.equal(got.to, TODAY);
});

/* --- What it is compared against ------------------------------------------ */

test('a month is compared with the same days of the month before', () => {
  // 1-13 Sep against 1-13 Aug. NOT the 13 days immediately before 1 Sep,
  // which would be 19-31 Aug and answers a different question entirely.
  const c = comparisonFor(p({}));
  assert.deepEqual([c?.from, c?.to], ['2026-08-01', '2026-08-13']);
});

test('a short month does not invent days it does not have', () => {
  // 31 days of March compared with February, which has 28.
  const c = comparisonFor(readPeriod({ p: 'month', m: '2026-03' }, '2026-12-31', EARLIEST));
  assert.deepEqual([c?.from, c?.to], ['2026-02-01', '2026-02-28']);
});

test('a year is compared with the same dates a year earlier, not 365 days back', () => {
  const c = comparisonFor(readPeriod({ p: 'ytd' }, '2026-09-13', EARLIEST));
  assert.deepEqual([c?.from, c?.to], ['2025-01-01', '2025-09-13']);
});

test('29 February compares against 28 February in a common year', () => {
  const c = comparisonFor(readPeriod({ p: 'ytd' }, '2028-02-29', EARLIEST));
  assert.equal(c?.to, '2027-02-28', 'a date that does not exist would silently become 1 March');
});

test('any other span is compared with the equal span immediately before it', () => {
  const c = comparisonFor(p({ p: 'days', n: '30' }));
  const period = p({ p: 'days', n: '30' });
  assert.equal(c?.to, '2026-08-14', 'ends the day before the period starts');
  assert.equal(c?.from, '2026-07-16');
  // The two windows must be the same length, or the percentage is nonsense.
  assert.equal(
    Math.round((Date.parse(`${c!.to}T00:00Z`) - Date.parse(`${c!.from}T00:00Z`)) / 86400000) + 1,
    period.days,
  );
});

test('all time is compared with nothing, because there is nothing before it', () => {
  assert.equal(comparisonFor(p({ p: 'all' })), null);
});

/* --- Charting granularity -------------------------------------------------- */

test('long periods switch from days to months', () => {
  assert.equal(granularity(p({})), 'day');
  assert.equal(granularity(p({ p: 'days', n: '90' })), 'day');
  assert.equal(granularity(p({ p: 'days', n: '365' })), 'month', '365 columns say nothing');
  assert.equal(granularity(p({ p: 'all' })), 'month');
});
