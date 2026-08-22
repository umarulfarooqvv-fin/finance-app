import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MAX_AMOUNT, parseUserAmount, round2, sumDisplayed, sumExact } from '@/lib/money';
import { byCategory, byMethod, monthlySeries, spendBetween, total } from '@/lib/analytics';
import { statementView } from '@/lib/statement';
import { monthKey } from '@/lib/time';
import { fixtureTransactions, makeSnapshot } from './helpers.ts';

/* ===========================================================================
   Financial reconciliation.

   The rule these tests exist to protect: A TOTAL ON SCREEN MUST EQUAL THE SUM
   OF THE ROWS ON SCREEN. Nothing else about a money app matters if a user can
   add up a column by hand and get a different answer.

   This was a real defect, not a hypothetical. Against the live data, eight
   groupings disagreed by a paisa — including the Coral card page and a
   three-row month. It happened because rows were displayed rounded while
   totals were computed from unrounded values.
   =========================================================================== */

test('user-entered amounts parse exactly, never through a float', () => {
  assert.deepEqual(parseUserAmount('1,234.56'), { ok: true, amount: 1234.56, paise: 123456 });
  assert.deepEqual(parseUserAmount('₹1234'), { ok: true, amount: 1234, paise: 123400 });
  assert.deepEqual(parseUserAmount(' 99 '), { ok: true, amount: 99, paise: 9900 });
  assert.deepEqual(parseUserAmount('0.05'), { ok: true, amount: 0.05, paise: 5 });
  assert.deepEqual(parseUserAmount('.5'), { ok: true, amount: 0.5, paise: 50 });

  // The classic float trap: 0.1 + 0.2 style drift must not reach the amount.
  // Parsing digit-wise into paise is what prevents it.
  const p = parseUserAmount('1234.56');
  assert.equal(p.ok && p.paise, 123456);
  assert.equal(p.ok && p.amount, 1234.56);
  // Built naively this is 1234.5600000000002; built from paise it is exact.
  const small = parseUserAmount('0.07');
  assert.ok(small.ok);
  assert.equal(small.paise, 7);
});

test('amounts a person types are limited to the paisa', () => {
  assert.deepEqual(parseUserAmount('10.999'), { ok: false, reason: 'too-precise' });
  assert.deepEqual(parseUserAmount('abc'), { ok: false, reason: 'not-a-number' });
  assert.deepEqual(parseUserAmount(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseUserAmount(null), { ok: false, reason: 'empty' });
  assert.deepEqual(parseUserAmount(String(MAX_AMOUNT + 1)), { ok: false, reason: 'out-of-range' });
});

test('round2 is half-up and survives binary representation', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(51.929568), 51.93);
  assert.equal(round2(288.4976), 288.5);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0), 0);
});

test('IDENTITY: displayed row sums equal displayed totals, on real data', async () => {
  // Every grouping the UI puts a total underneath. If any of these drift, a
  // screen is showing a column that does not add up.
  const snap = makeSnapshot({ transactions: await fixtureTransactions() });
  const rows = snap.transactions.filter((t) => t.amount != null && t.ts);

  const groups = new Map<string, number[]>();
  const add = (k: string, v: number) => groups.set(k, [...(groups.get(k) ?? []), v]);

  for (const t of rows) {
    const amt = t.amount as number;
    add(`month:${monthKey(t.ts!)}`, amt);
    add(`category:${t.category}`, amt);
    add(`method:${t.method}`, amt);
    if (t.cardAffected) add(`card:${t.cardAffected}`, amt);
    if (t.cardAffected) add(`card-month:${t.cardAffected}:${monthKey(t.ts!)}`, amt);
  }

  const offenders: string[] = [];
  for (const [key, values] of groups) {
    if (sumDisplayed(values) !== sumExact(values)) {
      offenders.push(`${key} (${sumDisplayed(values)} vs ${sumExact(values)})`);
    }
  }
  assert.deepEqual(offenders, [], `groupings whose rows do not add up to their total:\n${offenders.join('\n')}`);
});

test('IDENTITY: the amounts reaching the engine are already at paisa precision', async () => {
  // This is what makes the reconciliation above hold by construction rather
  // than by coincidence. Rounding happens once, at the data boundary.
  const rows = await fixtureTransactions();
  const unrounded = rows.filter((t) => t.amount != null && round2(t.amount) !== t.amount);
  assert.deepEqual(
    unrounded.map((t) => `${t.ts} ${t.amount}`),
    [],
    'every amount entering the domain must already be rounded to 2dp',
  );
});

test('IDENTITY: fractional bank values still reconcile once rounded', () => {
  // The real shape of the bug: an EMI instalment split into principal,
  // surcharge and tax, where the bank computed to six decimal places.
  const raw = [2305.09, 288.4976, 51.929568];
  const rounded = raw.map(round2);

  // Unrounded, the two ways of adding differ. That was the defect.
  const naive = round2(raw.reduce((a, v) => a + v, 0));
  const shown = rounded.reduce((a, v) => a + v, 0);
  assert.equal(round2(shown), 2645.52);
  assert.ok(Math.abs(naive - shown) < 0.011, 'sanity: the two differ by at most a paisa');

  // Rounded at the boundary, they agree exactly — which is the guarantee.
  assert.equal(sumDisplayed(rounded), sumExact(rounded));
});

test('category and method breakdowns total to the overall spend', async () => {
  const snap = makeSnapshot({ transactions: await fixtureTransactions() });
  const rows = spendBetween(snap, '2000-01-01', '2030-01-01');
  const grand = total(rows);

  assert.equal(sumExact(byCategory(rows).map((c) => c.total)), grand, 'categories must total to spend');
  assert.equal(sumExact(byMethod(rows).map((m) => m.total)), grand, 'methods must total to spend');

  // Shares are a proportion of the same grand total.
  const shares = byCategory(rows).reduce((a, c) => a + c.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, `category shares must sum to 1, got ${shares}`);
});

test('the monthly series totals to the same figure as the flat sum', async () => {
  const snap = makeSnapshot({ transactions: await fixtureTransactions() });
  const monthly = monthlySeries(snap);
  const flat = total(spendBetween(snap, '2000-01-01', '2030-01-01'));
  assert.equal(sumExact(monthly.map((m) => m.total)), flat);
});

test('statement totals equal the sum of the card rows', async () => {
  const snap = makeSnapshot({ transactions: await fixtureTransactions() });
  const view = statementView(snap, '2026-06-10');

  for (const field of ['remainingDueBill', 'totalDebtLive', 'unbilled', 'totalDebtExcl'] as const) {
    assert.equal(
      view.totals[field],
      sumExact(view.rows.map((r) => r[field])),
      `the ${field} total must equal the sum of its column`,
    );
  }
});
