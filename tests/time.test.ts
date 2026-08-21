import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays, dayInMonth, daysBetween, daysInMonth, dayNumber, formatDay,
  monthEnd, monthKey, nowIST, shiftMonth, weekdayName,
} from '../src/domain/time.ts';

test('civil date arithmetic round-trips', () => {
  for (const d of ['2023-01-01', '2024-02-29', '2026-06-10', '2026-12-31']) {
    assert.equal(addDays(d, 0), d);
    assert.equal(addDays(addDays(d, 37), -37), d);
  }
});

test('leap years are handled', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29); // divisible by 400
  assert.equal(daysInMonth(1900, 2), 28); // divisible by 100, not 400
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
});

test('a bill date past the end of the month clamps instead of rolling over', () => {
  // This is the bug that `new Date(y, 1, 31)` introduces: it silently becomes
  // 2 or 3 March. A card billing on the 31st must bill on the last day of Feb.
  assert.equal(dayInMonth(2026, 2, 31), '2026-02-28');
  assert.equal(dayInMonth(2024, 2, 31), '2024-02-29');
  assert.equal(dayInMonth(2026, 4, 31), '2026-04-30');
  assert.equal(dayInMonth(2026, 1, 31), '2026-01-31');
});

test('month shifting crosses year boundaries', () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(shiftMonth(2026, 6, -18), { y: 2024, m: 12 });
});

test('day differences are exact across months and years', () => {
  assert.equal(daysBetween('2026-06-10', '2026-06-21'), 11);
  assert.equal(daysBetween('2026-06-21', '2026-06-10'), -11);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2); // leap year
});

test('weekday derivation matches the calendar', () => {
  assert.equal(weekdayName('2026-06-10'), 'Wed');
  assert.equal(weekdayName('2026-06-13'), 'Sat');
  assert.equal(weekdayName('2024-07-06'), 'Sat'); // from a real history row
});

test('month helpers', () => {
  assert.equal(monthKey('2026-06-10T12:00:00'), '2026-06');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(formatDay('2026-06-10'), '10 Jun 2026');
});

test('nowIST reports IST wall clock regardless of the host timezone', () => {
  // 2026-06-10T00:00:00Z is 05:30 the same day in IST (+5:30).
  const at = new Date('2026-06-10T00:00:00Z');
  assert.equal(nowIST(at), '2026-06-10T05:30:00');
  // 20:00Z crosses midnight into the next IST day — the case that makes a
  // UTC-hosted server disagree with the phone about which day it is.
  assert.equal(nowIST(new Date('2026-06-10T20:00:00Z')), '2026-06-11T01:30:00');
});

test('day numbers are monotonic', () => {
  assert.ok(dayNumber('2026-06-11') > dayNumber('2026-06-10'));
  assert.ok(dayNumber('2023-01-01') < dayNumber('2026-01-01'));
});
