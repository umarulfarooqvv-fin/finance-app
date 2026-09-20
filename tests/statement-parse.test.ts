import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseStatement, parseStatementSummary } from '@/lib/statement-parse';
import { EXAMPLE, STATEMENT_PROMPT } from '@/lib/statement-prompt';

/* ===========================================================================
   Reading a pasted statement.

   The paste is whatever the user could get out of a PDF, often via a model.
   These are the shapes that actually come back from that, and the rule the
   parser must never break: a line it cannot read is REPORTED, not dropped.
   =========================================================================== */

test('a markdown table, which is what a model usually emits', () => {
  const r = parseStatement(`
| Date | Description | Amount |
| --- | --- | --- |
| 2026-08-12 | SWIGGY BANGALORE | 450.00 |
| 2026-08-14 | INDIAN OIL PETROL | 2,000.00 |
`);
  assert.equal(r.lines.length, 2);
  assert.deepEqual(
    r.lines.map((l) => [l.day, l.description, l.amount, l.direction]),
    [['2026-08-12', 'SWIGGY BANGALORE', 450, 'debit'],
     ['2026-08-14', 'INDIAN OIL PETROL', 2000, 'debit']],
  );
  assert.equal(r.skipped.length, 0, 'the header and rule are furniture, not failures');
});

test('csv and tab-separated', () => {
  const csv = parseStatement('2026-08-12,SWIGGY,450.00\n2026-08-13,UBER,120');
  assert.equal(csv.lines.length, 2);
  assert.equal(csv.lines[1]?.description, 'UBER');

  const tsv = parseStatement('2026-08-12\tSWIGGY\t450.00');
  assert.equal(tsv.lines[0]?.amount, 450);
});

test('plain columns, the way a PDF copies out', () => {
  const r = parseStatement('12/08/2026   SWIGGY BANGALORE      450.00\n14/08/2026   INDIAN OIL     2,000.00');
  assert.equal(r.lines[0]?.day, '2026-08-12', 'day-first, as Indian statements print');
  assert.equal(r.lines[0]?.description, 'SWIGGY BANGALORE');
  assert.equal(r.lines[1]?.amount, 2000);
});

test('the date formats statements actually use', () => {
  const cases: [string, string][] = [
    ['2026-08-12 SHOP 100', '2026-08-12'],
    ['12-Aug-2026 SHOP 100', '2026-08-12'],
    ['12 August 2026 SHOP 100', '2026-08-12'],
    ['Aug 12, 2026 SHOP 100', '2026-08-12'],
    ['12-08-26 SHOP 100', '2026-08-12'],
    ['12.08.2026 SHOP 100', '2026-08-12'],
  ];
  for (const [input, expected] of cases) {
    const r = parseStatement(input);
    assert.equal(r.lines[0]?.day, expected, input);
  }
});

test('a date that could be read either way round is flagged, not silently picked', () => {
  // 05/06/2026 is 5 June in India and 6 May in the US. A statement reconciler
  // that quietly chose one would match the wrong rows for a whole month.
  const dmy = parseStatement('05/06/2026 SHOP 100');
  assert.equal(dmy.lines[0]?.day, '2026-06-05');
  assert.equal(dmy.lines[0]?.ambiguousDate, true);
  assert.equal(dmy.ambiguousDates, 1);

  const mdy = parseStatement('05/06/2026 SHOP 100', { dateOrder: 'mdy' });
  assert.equal(mdy.lines[0]?.day, '2026-05-06');

  // Past the 12th there is only one reading, whatever the setting says.
  const forced = parseStatement('25/06/2026 SHOP 100', { dateOrder: 'mdy' });
  assert.equal(forced.lines[0]?.day, '2026-06-25');
  assert.equal(forced.ambiguousDates, 0);
});

test('a running balance column is not mistaken for the transaction', () => {
  // Statements print the balance after each row. Taking the last number would
  // read every line as the balance and match nothing.
  const r = parseStatement('| 2026-08-12 | SWIGGY | 450.00 | 12,340.55 |');
  assert.equal(r.lines[0]?.amount, 450);
  assert.ok(!/12,340/.test(r.lines[0]?.description ?? ''), 'balance is not description either');
});

test('a number inside the description is not mistaken for the amount', () => {
  // "EMI 18/24" is an instalment counter, not a charge of 18. Scanning the
  // line for any number read it as one, and the real 2,620.20 charge then
  // showed up as an unexplained bank charge — the exact failure this page is
  // supposed to detect, manufactured out of nothing.
  const r = parseStatement('| 11/08/2026 | APPLE INDIA EMI 18/24 | 2,620.20 |');
  assert.equal(r.lines[0]?.amount, 2620.2);
  assert.equal(r.lines[0]?.description, 'APPLE INDIA EMI 18/24');

  // Same thing without table pipes.
  const spaced = parseStatement('11/08/2026   APPLE INDIA EMI 18/24   2,620.20');
  assert.equal(spaced.lines[0]?.amount, 2620.2);

  // And a reference number that happens to look like money.
  const ref = parseStatement('| 12/08/2026 | UPI REF 402312345678 SWIGGY | 450.00 |');
  assert.equal(ref.lines[0]?.amount, 450);
});

test('credits are recognised however the statement marks them', () => {
  const forms = [
    '2026-08-12 PAYMENT RECEIVED 5,000.00 Cr',
    '2026-08-12 REFUND AMAZON 5,000.00',
    '2026-08-12 SOMETHING -5,000.00',
    '2026-08-12 SOMETHING (5,000.00)',
  ];
  for (const f of forms) {
    const r = parseStatement(f);
    assert.equal(r.lines[0]?.direction, 'credit', f);
    assert.equal(r.lines[0]?.amount, 5000, f);
  }
  assert.equal(parseStatement('2026-08-12 SWIGGY 450.00 Dr').lines[0]?.direction, 'debit');
});

test('a line that cannot be read comes back in skipped, never dropped', () => {
  const r = parseStatement(`
2026-08-12 SWIGGY 450.00
STATEMENT CONTINUED OVERLEAF
2026-08-13 NO AMOUNT HERE
`);
  assert.equal(r.lines.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.skipped[0]?.why, 'no date found');
  assert.equal(r.skipped[1]?.why, 'no amount found');
  // The raw text is kept so the row can be found in the paste.
  assert.match(r.skipped[0]?.raw ?? '', /OVERLEAF/);
});

test('a year-less date uses the statement period', () => {
  const r = parseStatement('12 Aug SWIGGY 450.00', { assumeYear: 2026 });
  assert.equal(r.lines[0]?.day, '2026-08-12');
  // Without one there is nothing to assume, so it is reported rather than guessed.
  assert.equal(parseStatement('12 Aug SWIGGY 450.00').skipped.length, 1);
});

test('rupee symbols and Indian grouping', () => {
  const r = parseStatement('2026-08-12 SHOP ₹1,23,456.78');
  assert.equal(r.lines[0]?.amount, 123456.78);
  assert.equal(parseStatement('2026-08-12 SHOP Rs. 450').lines[0]?.amount, 450);
});

test('zero-value rows are set aside rather than counted', () => {
  const r = parseStatement('2026-08-12 ANNUAL FEE WAIVED 0.00');
  assert.equal(r.lines.length, 0);
  assert.equal(r.skipped[0]?.why, 'amount is zero');
});

test('the same paste always parses the same way', () => {
  const text = '| 2026-08-12 | SWIGGY | 450.00 |\n| 2026-08-14 | UBER | 120.50 |';
  const first = parseStatement(text);
  for (let i = 0; i < 10; i++) assert.deepEqual(parseStatement(text), first);
});

test('a statement that wraps each row across three lines', () => {
  /* A real Rupay statement, verbatim. Read line by line every row fails —
     the date line has no amount, the time and description lines have no date —
     and a whole statement parsed to nothing while reporting every line as
     unreadable. The pieces have to be stitched before anything else sees them. */
  const r = parseStatement(
    [
      '06 Aug 26 ',
      '03:53 pm',
      'VODAFONE IDEA LIMITED Rs. 179.00',
      '20 Aug 26 ',
      '08:00 pm',
      'Repayment - Thank You Rs. 1,553.42',
      '22 Aug 26 ',
      '03:06 pm',
      'Max Retail 4617 Rs. 1,799',
    ].join('\n'),
    { dateOrder: 'dmy', assumeYear: 2026 },
  );

  assert.equal(r.lines.length, 3);
  assert.equal(r.skipped.length, 0);

  assert.deepEqual(
    r.lines.map((l) => [l.day, l.amount, l.direction, l.description]),
    [
      ['2026-08-06', 179, 'debit', 'VODAFONE IDEA LIMITED'],
      ['2026-08-20', 1553.42, 'credit', 'Repayment - Thank You'],
      ['2026-08-22', 1799, 'debit', 'Max Retail 4617'],
    ],
  );
});

test('stitching stops at the next record rather than swallowing it', () => {
  // Two date lines in a row: the first never finds an amount, and must be
  // reported rather than absorbing the transaction that follows it.
  const r = parseStatement(
    ['06 Aug 26', '07 Aug 26', '03:53 pm', 'SHOP Rs. 100.00'].join('\n'),
    { dateOrder: 'dmy', assumeYear: 2026 },
  );
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0]?.day, '2026-08-07', 'the amount belongs to the SECOND date');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0]?.raw, '06 Aug 26');
});

test('stitching gives up rather than reaching indefinitely', () => {
  // A date line followed by junk must not hoover up the whole file looking
  // for an amount.
  const r = parseStatement(
    ['06 Aug 26', 'noise', 'more noise', 'yet more', 'and more', 'SHOP Rs. 100.00'].join('\n'),
    { dateOrder: 'dmy', assumeYear: 2026 },
  );
  assert.equal(r.lines.length, 0, 'the amount was too far away to belong to that date');
  assert.ok(r.skipped.length > 0);
});

/* ---------------------------------------------------------------------------
   The summary box.

   Line matching says whether every charge is accounted for. Only the summary
   says whether the BALANCE is right — a balance is wrong because of an earlier
   cycle, so this month's lines can all match while the total is still out.
   Every case here is taken from a real ICICI Coral statement.
   --------------------------------------------------------------------------- */

test('reads the four figures from the table layout', () => {
  // The PDF prints labels on one line and amounts beneath.
  const s = parseStatementSummary(`
STATEMENT SUMMARY
Previous Balance Purchases / Charges Cash Advances Payments / Credits
₹2,962.72 ₹6,842.25 ₹0.00 ₹2,962.72
Total Amount due
₹6,842.25
`);
  assert.ok(s);
  assert.equal(s.previousBalance, 2962.72);
  assert.equal(s.charges, 6842.25);
  assert.equal(s.payments, 2962.72);
  assert.equal(s.totalDue, 6842.25);
});

test('Cash Advances takes its own column rather than shifting the rest', () => {
  // It sits BETWEEN charges and payments. Skipping it as a label while its
  // amount stays in the row would read payments as 0.00.
  const s = parseStatementSummary(`
Previous Balance Purchases / Charges Cash Advances Payments / Credits
₹6,001.13 ₹2,620.20 ₹0.00 ₹6,001.13
Total Amount due ₹2,620.20
`);
  assert.ok(s);
  assert.equal(s.charges, 2620.20);
  assert.equal(s.payments, 6001.13, 'payments must not pick up the cash-advance column');
});

test('reads a one-label-per-line layout too', () => {
  // What a screenshot transcription tends to produce.
  const s = parseStatementSummary(`
Previous Balance: 4,372.70
Purchases / Charges: 2,647.30
Payments / Credits: 4,372.70
Total Amount Due: 2,647.30
`);
  assert.ok(s);
  assert.deepEqual(s, {
    previousBalance: 4372.70, charges: 2647.30, payments: 4372.70, totalDue: 2647.30,
  });
});

test('half a summary is no summary', () => {
  // Comparing a partial block against a full one silently reports a
  // difference that is an artefact of the parse, not of the money.
  assert.equal(parseStatementSummary('Previous Balance 1,000.00\nTotal Amount Due 2,000.00'), null);
  assert.equal(parseStatementSummary('just some transaction rows\n25/08/2026 SHOP 450.00'), null);
});

test('the total is taken from the statement, not derived', () => {
  // previous + charges - payments would be 1,100 here; the bank says 1,150
  // because of a fee the app cannot see. The bank's own number wins.
  const s = parseStatementSummary(`
Previous Balance Purchases / Charges Cash Advances Payments / Credits
1,000.00 600.00 0.00 500.00
Total Amount Due 1,150.00
`);
  assert.ok(s);
  assert.equal(s.totalDue, 1150.00);
});

/* ---------------------------------------------------------------------------
   The prompt and the parser have to agree.

   The prompt tells an assistant what shape to hand back for a statement the
   app cannot read itself — a screenshot, or a PDF it has no access to. Nothing
   stops that shape drifting away from what the parser accepts except a test
   that runs the one through the other.
   --------------------------------------------------------------------------- */

test('the example in the prompt parses to exactly what it shows', () => {
  const summary = parseStatementSummary(EXAMPLE);
  assert.ok(summary, 'the summary box the prompt asks for is readable');
  assert.deepEqual(summary, {
    previousBalance: 6842.25, charges: 4372.70, payments: 6842.25, totalDue: 4372.70,
  });

  const { lines, skipped } = parseStatement(EXAMPLE, { dateOrder: 'dmy' });
  assert.equal(skipped.length, 0, 'no transaction line is unreadable');
  assert.equal(lines.length, 4);

  // Amounts survive to the paisa, and CR is read as money coming back.
  assert.deepEqual(
    lines.map((l) => [l.day, l.amount, l.direction]),
    [
      ['2026-01-31', 30.00, 'debit'],
      ['2026-02-05', 649.19, 'debit'],
      ['2026-02-11', 73.39, 'debit'],
      ['2026-02-12', 6842.25, 'credit'],
    ],
  );
});

test('the prompt states the rules that keep the data trustworthy', () => {
  /* Not style policing: each of these is a way a model is "helpful" that
     silently corrupts money — and the reason the app re-checks the totals
     afterwards rather than trusting the output. */
  for (const rule of [/never round/i, /never guess/i, /do not total/i, /do not merge/i, /UNREADABLE/]) {
    assert.match(STATEMENT_PROMPT, rule);
  }
});
