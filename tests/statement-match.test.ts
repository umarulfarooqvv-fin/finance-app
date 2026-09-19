import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  chargeFlag, couldBelongToCard, findOnOtherMethods, isBankCharge, reconcileStatement,
  subsetsSummingTo, suggestFor, type AppEntry,
} from '@/lib/statement-match';
import type { StatementLine } from '@/lib/statement-parse';

/* ===========================================================================
   Matching a statement against what the app recorded.

   The output that matters is `statementOnly`: a charge the bank made that has
   no entry behind it. Everything here is really a test of one property — that
   a real bank charge cannot be hidden by a coincidence of amounts.
   =========================================================================== */

let seq = 0;
const line = (day: string, amount: number, description = 'SHOP', direction: 'debit' | 'credit' = 'debit'): StatementLine => ({
  line: ++seq, raw: `${day} ${description} ${amount}`, day, description, amount, direction, ambiguousDate: false,
});
const entry = (day: string, amount: number, description = 'Shop', direction: 'debit' | 'credit' = 'debit'): AppEntry => ({
  id: `tx-${++seq}`, ts: `${day}T12:00:00`, day, amount, description, direction, verified: false,
});

/* --- The straightforward cases -------------------------------------------- */

test('same day, same amount', () => {
  const r = reconcileStatement([line('2026-08-12', 450)], [entry('2026-08-12', 450)]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]?.kind, 'exact');
  assert.equal(r.statementOnly.length, 0);
  assert.equal(r.appOnly.length, 0);
});

test('a bank that posts a few days late still matches', () => {
  const r = reconcileStatement([line('2026-08-15', 450)], [entry('2026-08-12', 450)]);
  assert.equal(r.matches[0]?.kind, 'near');
  assert.equal(r.matches[0]?.dayGap, 3);
});

test('beyond the tolerance it is two separate problems, not one match', () => {
  const r = reconcileStatement([line('2026-08-30', 450)], [entry('2026-08-12', 450)], { tolerance: 4 });
  assert.equal(r.matches.length, 0);
  assert.equal(r.statementOnly.length, 1);
  assert.equal(r.appOnly.length, 1);
});

test('a debit never matches a credit, whatever the amount', () => {
  // A 5,000 refund and a 5,000 purchase are not the same event, and pairing
  // them would cancel out both a real charge and a real credit.
  const r = reconcileStatement(
    [line('2026-08-12', 5000, 'REFUND', 'credit')],
    [entry('2026-08-12', 5000, 'Purchase', 'debit')],
  );
  assert.equal(r.matches.length, 0);
  assert.equal(r.statementOnly.length, 1);
  assert.equal(r.appOnly.length, 1);
});

/* --- The case this page exists for ---------------------------------------- */

test('a charge the bank made that was never recorded is reported', () => {
  const r = reconcileStatement(
    [line('2026-08-12', 450), line('2026-08-20', 590, 'ANNUAL FEE'), line('2026-08-20', 106.2, 'GST ON FEE')],
    [entry('2026-08-12', 450)],
  );
  assert.equal(r.matches.length, 1);
  assert.deepEqual(
    r.statementOnly.map((l) => [l.description, l.amount]),
    [['ANNUAL FEE', 590], ['GST ON FEE', 106.2]],
  );
  assert.equal(r.totals.debitDifference, 696.2, 'the bank charged this much more than was recorded');
});

test('something recorded that the bank never charged is reported too', () => {
  const r = reconcileStatement([line('2026-08-12', 450)], [entry('2026-08-12', 450), entry('2026-08-13', 200)]);
  assert.equal(r.appOnly.length, 1);
  assert.equal(r.appOnly[0]?.amount, 200);
  assert.equal(r.totals.debitDifference, -200);
});

/* --- Merged entries, which is the whole difficulty ------------------------ */

test('two app entries summing to one statement line', () => {
  // The bank prints the fuel and its surcharge as one charge; the app has two.
  const r = reconcileStatement(
    [line('2026-08-14', 2011.8, 'INDIAN OIL')],
    [entry('2026-08-14', 2000, 'Petrol'), entry('2026-08-14', 11.8, 'Fuel surcharge')],
  );
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]?.kind, 'grouped');
  assert.equal(r.matches[0]?.app.length, 2);
  assert.equal(r.statementOnly.length, 0);
  assert.equal(r.appOnly.length, 0);
});

test('one app entry covering two statement lines', () => {
  // Typed in as a single 750; the bank billed the meal and the tip separately.
  const r = reconcileStatement(
    [line('2026-08-12', 600, 'RESTAURANT'), line('2026-08-12', 150, 'TIP')],
    [entry('2026-08-12', 750, 'Dinner')],
  );
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]?.kind, 'grouped');
  assert.equal(r.matches[0]?.statement.length, 2);
  assert.equal(r.matches[0]?.app.length, 1);
});

test('a group still has to fall inside the date window', () => {
  const r = reconcileStatement(
    [line('2026-08-14', 2011.8)],
    [entry('2026-08-14', 2000), entry('2026-07-02', 11.8)],
    { tolerance: 4 },
  );
  assert.equal(r.matches.length, 0, 'a July row cannot be part of an August charge');
  assert.equal(r.statementOnly.length, 1);
});

test('grouping does not swallow an unrelated charge that happens to fit', () => {
  // 300 + 150 sums to 450, and so does the single 450. Two readings fit, so
  // neither is chosen — otherwise a real extra charge disappears into a
  // coincidence of arithmetic.
  const r = reconcileStatement(
    [line('2026-08-12', 450, 'A')],
    [entry('2026-08-12', 450, 'X'), entry('2026-08-12', 300, 'Y'), entry('2026-08-12', 150, 'Z')],
  );
  assert.equal(r.matches.length, 1, 'the exact single match is taken first');
  assert.equal(r.matches[0]?.kind, 'exact');
  // The other two are left visible rather than folded away.
  assert.equal(r.appOnly.length, 2);
});

/* --- Refusing to guess ---------------------------------------------------- */

test('two equally good candidates are left unmatched, not picked at random', () => {
  const r = reconcileStatement(
    [line('2026-08-12', 100, 'TEA')],
    [entry('2026-08-11', 100, 'Tea'), entry('2026-08-13', 100, 'Tea')],
    { tolerance: 4 },
  );
  // Both are one day away. Choosing either would be a coin toss.
  assert.equal(r.matches.length, 0);
  assert.equal(r.statementOnly.length, 1);
  assert.equal(r.appOnly.length, 2);
});

test('identical rows on the same day pair off one for one', () => {
  // Two genuine 15-rupee teas is a real thing; they must not collapse into one.
  const r = reconcileStatement(
    [line('2026-08-12', 15, 'TEA'), line('2026-08-12', 15, 'TEA')],
    [entry('2026-08-12', 15, 'Tea'), entry('2026-08-12', 15, 'Tea')],
  );
  assert.equal(r.matches.length, 2);
  assert.equal(r.statementOnly.length, 0);
  assert.equal(r.appOnly.length, 0);
});

/* --- Totals --------------------------------------------------------------- */

test('totals are over everything, matched or not', () => {
  const r = reconcileStatement(
    [line('2026-08-12', 450), line('2026-08-20', 590, 'FEE'), line('2026-08-25', 5000, 'PAYMENT', 'credit')],
    [entry('2026-08-12', 450), entry('2026-08-25', 5000, 'Cleared', 'credit')],
  );
  assert.equal(r.totals.statementDebit, 1040);
  assert.equal(r.totals.appDebit, 450);
  assert.equal(r.totals.debitDifference, 590);
  assert.equal(r.totals.statementCredit, 5000);
  assert.equal(r.totals.creditDifference, 0);
});

test('every row ends up somewhere: matched, statement-only or app-only', () => {
  const lines = [line('2026-08-12', 450), line('2026-08-14', 2011.8), line('2026-08-20', 590, 'FEE')];
  const entries = [entry('2026-08-12', 450), entry('2026-08-14', 2000), entry('2026-08-14', 11.8), entry('2026-08-28', 99)];
  const r = reconcileStatement(lines, entries);

  const accountedLines = r.matches.flatMap((m) => m.statement).length + r.statementOnly.length
    + r.ambiguous.flatMap((a) => a.statement).length;
  const accountedEntries = r.matches.flatMap((m) => m.app).length + r.appOnly.length
    + r.ambiguous.flatMap((a) => a.app).length;
  assert.equal(accountedLines, lines.length, 'no statement row may vanish');
  assert.equal(accountedEntries, entries.length, 'no app row may vanish');
});

/* --- The combination search ----------------------------------------------- */

test('subset search finds every exact combination and stops at the size limit', () => {
  const items = [{ amount: 100 }, { amount: 200 }, { amount: 300 }, { amount: 400 }];
  assert.equal(subsetsSummingTo(items, 30000, 2).length, 1, '100 + 200');
  assert.equal(subsetsSummingTo(items, 60000, 3).length, 2, '200+400 and 100+200+300');
  assert.equal(subsetsSummingTo(items, 60000, 2).length, 1, 'the three-item answer is out of range');
  assert.equal(subsetsSummingTo(items, 99900, 4).length, 0);
});

test('combinations are exact to the paisa', () => {
  // 0.1 + 0.2 is not 0.3 in floating point; in paise it is 10 + 20 = 30.
  const items = [{ amount: 0.1 }, { amount: 0.2 }];
  assert.equal(subsetsSummingTo(items, 30, 2).length, 1);
});

/* --- Reading a line for what it is --------------------------------------- */

test('a bank charge is told apart from a purchase', () => {
  // Both are unmatched; only one is a finding worth acting on.
  for (const fee of [
    'ANNUAL MEMBERSHIP FEE', 'JOINING FEE', 'LATE PAYMENT CHARGES', 'OVER LIMIT FEE',
    'CASH ADVANCE FEE', 'FUEL SURCHARGE', 'FOREIGN CURRENCY MARKUP', 'PROCESSING FEE',
  ]) {
    assert.equal(isBankCharge(fee), true, fee);
  }
  for (const purchase of ['SWIGGY BANGALORE', 'INDIAN OIL PETROL', 'AMAZON RETAIL', 'UBER TRIP']) {
    assert.equal(isBankCharge(purchase), false, purchase);
  }
});

test('tax is read as tax, even when it sits on top of a fee', () => {
  // "GST ON LATE FEE" is the bank adding tax to a charge; calling it a fee
  // would hide which half is the tax.
  assert.equal(chargeFlag('IGST @18%')?.kind, 'tax');
  assert.equal(chargeFlag('GST ON LATE FEE')?.kind, 'tax');
  assert.equal(chargeFlag('CGST 9%')?.kind, 'tax');
});

test('interest and instalments are separated from fees', () => {
  assert.equal(chargeFlag('INTEREST CHARGES')?.kind, 'interest');
  assert.equal(chargeFlag('FINANCE CHARGE')?.kind, 'interest');
  assert.equal(chargeFlag('APPLE INDIA EMI 18/24')?.kind, 'emi');
  // An EMI instalment is a real purchase being repaid, not a charge to dispute.
  assert.equal(isBankCharge('APPLE INDIA EMI 18/24'), false);
});

test('a refund is not a charge', () => {
  assert.equal(chargeFlag('REVERSAL OF LATE FEE')?.kind, 'reversal');
  assert.equal(isBankCharge('REVERSAL OF LATE FEE'), false);
  assert.equal(chargeFlag('ANNUAL FEE WAIVED')?.kind, 'reversal');
});

/* --- Suggestions ---------------------------------------------------------- */

test('an exact single match is suggested first', () => {
  const l = line('2026-08-12', 450, 'SWIGGY');
  const s = suggestFor(l, [entry('2026-08-12', 450, 'Lunch'), entry('2026-08-12', 300, 'Other')]);
  assert.equal(s[0]?.app.length, 1);
  assert.equal(s[0]?.app[0]?.description, 'Lunch');
  assert.equal(s[0]?.difference, 0);
});

test('a split is suggested as one combination', () => {
  const l = line('2026-08-14', 2620.2, 'APPLE INDIA EMI');
  const s = suggestFor(l, [
    entry('2026-08-14', 2350.88, 'Ipad'),
    entry('2026-08-14', 228.24, 'Ipad Charge'),
    entry('2026-08-14', 41.08, 'Ipad Tax'),
  ]);
  assert.equal(s[0]?.app.length, 3);
  assert.equal(s[0]?.total, 2620.2);
  assert.equal(s[0]?.difference, 0);
  assert.match(s[0]?.reason ?? '', /adding up exactly/);
});

test('a near miss is offered only when nothing matches exactly', () => {
  // A 2-rupee gap is usually rounding or a tip, and worth showing — but never
  // beside a perfect match, where it would invite the wrong pick.
  const withExact = suggestFor(line('2026-08-12', 450), [
    entry('2026-08-12', 450, 'Exact'),
    entry('2026-08-12', 448, 'Close'),
  ]);
  assert.equal(withExact.length, 1, 'the near miss is withheld');
  assert.equal(withExact[0]?.app[0]?.description, 'Exact');

  const withoutExact = suggestFor(line('2026-08-12', 450), [entry('2026-08-12', 448, 'Close')]);
  assert.equal(withoutExact.length, 1);
  assert.equal(withoutExact[0]?.difference, 2);
  assert.match(withoutExact[0]?.reason ?? '', /short by 2/);
});

test('suggestions never cross direction, and stay inside the window', () => {
  const l = line('2026-08-12', 500, 'SHOP');
  const s = suggestFor(l, [
    entry('2026-08-12', 500, 'Refund', 'credit'),   // wrong direction
    entry('2026-06-01', 500, 'Months earlier'),      // outside the window
  ], { tolerance: 7 });
  assert.equal(s.length, 0, 'neither is a plausible pairing');
});

test('fewer rows and closer dates rank higher', () => {
  const l = line('2026-08-12', 300, 'SHOP');
  const s = suggestFor(l, [
    entry('2026-08-12', 100, 'A'), entry('2026-08-12', 200, 'B'),
    entry('2026-08-14', 300, 'Single'),
  ]);
  assert.equal(s[0]?.app.length, 1, 'one exact row beats a two-row combination');
  assert.equal(s[0]?.app[0]?.description, 'Single');
});

/* ---------------------------------------------------------------------------
   Which rows may be offered for re-filing onto a card.

   Every case here is a row that LOOKS like a candidate — it is in the window
   and its method is not this card — and must not be offered anyway.
   --------------------------------------------------------------------------- */

const row = (method: string, cardAffected: string | null, kind = 'spend') =>
  ({ method, cardAffected, kind });

test('a spend paid with another method is a candidate', () => {
  assert.equal(couldBelongToCard(row('Fi', null), 'Edge'), true);
});

test('a spend already on another card is a candidate — that is the common mix-up', () => {
  assert.equal(couldBelongToCard(row('Scapia', 'Scapia'), 'Edge'), true);
});

test('a row already on this card is not a candidate', () => {
  assert.equal(couldBelongToCard(row('Edge', 'Edge'), 'Edge'), false);
});

test('paying THIS card\'s bill is not a candidate, though its method differs', () => {
  // method Fi, cardAffected Edge: this row is already in the card's own entry
  // list. Offering it here would put one id in both columns at once.
  assert.equal(couldBelongToCard(row('Fi', 'Edge', 'card_payment'), 'Edge'), false);
});

test('paying ANOTHER card\'s bill is not a candidate', () => {
  // Re-filing it would claim Edge paid Coral's bill, not that a purchase was
  // made on Edge. Five such rows carry 68,456.03 in the live 6 Sep window.
  assert.equal(couldBelongToCard(row('Fi', 'Coral', 'card_payment'), 'Edge'), false);
});

test('credit given, investments and unclassified rows stay candidates', () => {
  // They are all charges someone made; only a bill payment is definitionally
  // not a purchase, so only it is excluded by kind.
  for (const kind of ['credit_given', 'investment', 'emi', 'unknown']) {
    assert.equal(couldBelongToCard(row('Fi', null, kind), 'Edge'), true, kind);
  }
});

/* ---------------------------------------------------------------------------
   Recovering this card's spends from entries filed under another method.

   Proposals, not moves — so the bar is not "could this be it" but "is this the
   only thing it could be". Most of these assert a REFUSAL, because a wrong
   proposal here re-files real money onto the wrong bill.
   --------------------------------------------------------------------------- */

test('an exact-amount entry on another method is proposed', () => {
  const found = findOnOtherMethods(
    [line('2026-08-22', 1799, 'MAX RETAIL 4617')],
    [entry('2026-08-22', 1799, 'Shirts (Banglore Trip)')],
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.kind, 'exact');
  assert.equal(found[0]!.dayGap, 0);
});

test('a late-posted entry is proposed, and says how late', () => {
  const found = findOnOtherMethods(
    [line('2026-08-25', 450, 'SWIGGY')],
    [entry('2026-08-22', 450, 'Dinner')],
    { tolerance: 4 },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.kind, 'near');
  assert.equal(found[0]!.dayGap, 3);
});

test('two equally close candidates propose NOTHING', () => {
  // One three days before, one three days after. Choosing is a coin toss, and
  // the loser is real money moved onto a bill it never belonged to.
  const found = findOnOtherMethods(
    [line('2026-08-22', 200, 'SHOP')],
    [entry('2026-08-19', 200, 'On Fi'), entry('2026-08-25', 200, 'On Scapia')],
    { tolerance: 4 },
  );
  assert.equal(found.length, 0);
});

test('an entry either of two lines could claim is still proposed', () => {
  /* Not the same situation as a tie between two ENTRIES, which is refused
     above. Choosing which entry to move is a real decision with a loser. But
     both of these LINES are charges on this card's own statement, so whichever
     one it pairs with, the only thing being decided here — that this entry
     belongs on this card — comes out the same. Refusing would drop a correct
     proposal to avoid an ambiguity that does not change the answer. */
  const found = findOnOtherMethods(
    [line('2026-08-20', 300, 'SHOP A'), line('2026-08-24', 300, 'SHOP B')],
    [entry('2026-08-22', 300, 'Something')],
    { tolerance: 4 },
  );
  assert.equal(found.length, 1);
});

test('direction must agree — a refund is not a charge', () => {
  const found = findOnOtherMethods(
    [line('2026-08-22', 500, 'PURCHASE', 'debit')],
    [entry('2026-08-22', 500, 'Refund received', 'credit')],
  );
  assert.equal(found.length, 0);
});

test('an amount that is close but not equal is not proposed', () => {
  const found = findOnOtherMethods(
    [line('2026-08-22', 500, 'SHOP')],
    [entry('2026-08-22', 499, 'Nearly')],
  );
  assert.equal(found.length, 0);
});

test('two entries summing to one line are NEVER proposed', () => {
  // Good evidence the charge was split, poor evidence about which CARD it
  // belongs to — and this decision moves money between bills.
  const found = findOnOtherMethods(
    [line('2026-08-22', 500, 'RESTAURANT')],
    [entry('2026-08-22', 300, 'Meal'), entry('2026-08-22', 200, 'Tip')],
  );
  assert.equal(found.length, 0);
});

test('each entry is proposed at most once across the whole statement', () => {
  const found = findOnOtherMethods(
    [line('2026-08-10', 70, 'A'), line('2026-08-10', 70, 'B')],
    [entry('2026-08-10', 70, 'Only one')],
  );
  assert.equal(found.length, 1);
  assert.equal(new Set(found.map((f) => f.entryId)).size, found.length);
});
