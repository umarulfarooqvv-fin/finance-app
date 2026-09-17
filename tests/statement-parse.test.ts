import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseStatement } from '@/lib/statement-parse';

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
