import assert from 'node:assert/strict';
import { test } from 'vitest';
import { billCheck } from '@/lib/bill-check';
import { parseStatement, parseStatementSummary } from '@/lib/statement-parse';

/* ===========================================================================
   The whole bill, bank against app.

   The case that prompted it, in the app's own numbers: every charge matched,
   and the bill was still ₹79.91 out — ₹85.81 inherited from an earlier month,
   less a ₹5.90 surcharge-waiver refund that was never entered.
   =========================================================================== */

const BANK = { previousBalance: 25159.26, charges: 18432.73, payments: 25165.16, totalDue: 18426.83 };
const APP = { opening: 25073.45, charges: 18432.73, payments: 25159.26, closing: 18346.92 };

test('an inherited difference and a missing refund are told apart', () => {
  const c = billCheck(BANK, APP);
  assert.deepEqual(c.diff, { opening: -85.81, charges: 0, payments: -5.9, closing: -79.91 });
  assert.deepEqual(c.findings, [
    { kind: 'opening', diff: -85.81 },
    { kind: 'payments', diff: -5.9 },
  ]);
});

test('the opening is reported first — no work on this month’s lines can find it', () => {
  const c = billCheck(BANK, { ...APP, charges: 18400 });
  assert.deepEqual(c.findings.map((f) => f.kind), ['opening', 'charges', 'payments']);
});

test('a bill that agrees says so, and says nothing else', () => {
  const c = billCheck(BANK, { opening: 25159.26, charges: 18432.73, payments: 25165.16, closing: 18426.83 });
  assert.deepEqual(c.findings, [{ kind: 'agree' }]);
});

test('bank figures that do not add up point at a fee outside the list', () => {
  const c = billCheck({ ...BANK, totalDue: 18426.83 + 118 }, { ...APP, closing: 18346.92 + 118 });
  assert.ok(c.findings.some((f) => f.kind === 'bank-extra' && Math.abs(f.amount - 118) < 0.001));
});

test('rounding below a paisa is not a difference', () => {
  const c = billCheck(BANK, { opening: 25159.261, charges: 18432.729, payments: 25165.16, closing: 18426.83 });
  assert.deepEqual(c.findings, [{ kind: 'agree' }]);
});

/* ---------------------------------------------------------------------------
   A statement PDF's text layer, as it comes out of the file: labels with their
   spaces gone, a time glued to the date, "+" marking a credit, a
   reward-points column after some amounts, and header figures carrying dates.
   Made-up merchants; the same layout as a real Federal-issued card PDF.
   --------------------------------------------------------------------------- */
const PDF = `BillingCycle
16Aug2026-15Sep2026
TotalDue
₹1,409.20
StatementDate
16 Sep 2026
AvailableLimit
₹48,590.80
Previousbalance ₹2,000.00
Paymentsandrefunds -₹2,005.90
Transactions +₹1,415.10
Cashwithdrawal +₹0.00
Feesandinterest +₹0.00
Newbalance ₹1,409.20
15-08-2026·14:40 Corner Shop ₹49.00
17-08-2026·11:53 BusCo ₹1,208.00 60
19-08-2026·17:34 FuelSurcharge-Pump ₹5.90
20-08-2026·17:53 Fuelsurchargewaiver Refund +₹5.90
30-08-2026·13:22 Billpayment Payment +₹2,000.00
06-09-2026·16:58 Telco ₹152.20`;

test('the PDF layout reads as the bank printed it', () => {
  const { lines } = parseStatement(PDF, { year: 2026 } as never);
  const debit = lines.filter((l) => l.direction === 'debit');
  const credit = lines.filter((l) => l.direction === 'credit');
  assert.equal(debit.length, 4, 'header figures are not transactions');
  assert.equal(Math.round(debit.reduce((a, l) => a + l.amount, 0) * 100), 141510);
  assert.equal(credit.length, 2, '"+₹" is a credit');
  assert.equal(Math.round(credit.reduce((a, l) => a + l.amount, 0) * 100), 200590);
  assert.equal(debit[1]!.description, 'BusCo', 'no time prefix, no reward points');
});

test('the run-together summary labels are read', () => {
  assert.deepEqual(parseStatementSummary(PDF), {
    totalDue: 1409.2, previousBalance: 2000, payments: 2005.9, charges: 1415.1,
  });
});
