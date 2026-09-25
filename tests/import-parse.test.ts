import { describe, expect, it } from 'vitest';
import { parseImport, readyToImport, unsortedCount } from '@/lib/import-parse';
import { IMPORT_EXAMPLE, IMPORT_PROMPT } from '@/lib/import-prompt';

describe('parseImport', () => {
  it('reads the shape the prompt asks for', () => {
    const { rows, skipped } = parseImport('14/09/2026 | 450.00 | Fi | Food | Hospital canteen');
    expect(skipped).toEqual([]);
    expect(rows[0]).toMatchObject({
      day: '2026-09-14',
      amount: 450,
      method: 'Fi',
      category: 'Food',
      remarks: 'Hospital canteen',
      issues: [],
    });
  });

  it('takes tabs and aligned columns as well as pipes', () => {
    const tabbed = parseImport('14/09/2026\t450\tFi\tFood\tCanteen');
    const spaced = parseImport('14/09/2026   450   Fi   Food   Canteen');
    for (const r of [tabbed, spaced]) {
      expect(r.skipped).toEqual([]);
      expect(r.rows[0]).toMatchObject({ amount: 450, method: 'Fi', category: 'Food' });
    }
  });

  /* A single space is not a separator: descriptions have spaces in them, and
     splitting on one would turn "Hospital canteen" into two columns. */
  it('does not split a description on its own spaces', () => {
    const { rows } = parseImport('14/09/2026  450  Fi  Food  Dad hospital pharmacy');
    expect(rows[0]!.remarks).toBe('Dad hospital pharmacy');
  });

  it('keeps a description that contains a pipe', () => {
    const { rows } = parseImport('14/09/2026 | 450 | Fi | Food | Lunch | Cafe Rio');
    expect(rows[0]!.remarks).toBe('Lunch | Cafe Rio');
  });

  it('matches a method or category however it was capitalised', () => {
    const { rows } = parseImport('14/09/2026 | 450 | fi | FOOD | Tea');
    expect(rows[0]).toMatchObject({ method: 'Fi', category: 'Food', issues: [] });
  });

  /* Left empty for a person, never guessed: a guessed category is averaged
     into a year of spending, where a flagged one gets fixed. */
  it('flags a missing method or category rather than inventing one', () => {
    const { rows } = parseImport('14/09/2026 | 300 | Cash |  | Parking');
    expect(rows[0]!.category).toBe('');
    expect(rows[0]!.issues).toContain('no-category');

    const both = parseImport('14/09/2026 | 300 |  |  | Parking');
    expect(both.rows[0]!.issues).toEqual(['no-method', 'no-category']);
  });

  it('flags a method or category it does not recognise', () => {
    const { rows } = parseImport('14/09/2026 | 300 | PayPal | Groceries2 | Thing');
    expect(rows[0]!.issues).toEqual(['unknown-method', 'unknown-category']);
    expect(rows[0]!.method).toBe('');
  });

  it('treats UNREADABLE as an empty field, not as a name', () => {
    const { rows } = parseImport('14/09/2026 | 300 | UNREADABLE | Food | Tea');
    expect(rows[0]!.method).toBe('');
    expect(rows[0]!.issues).toContain('no-method');
  });

  /* Nothing is ever dropped: a batch that quietly imports nineteen of twenty
     rows is worse than one that refuses. */
  it('reports an unreadable line instead of losing it', () => {
    const { rows, skipped } = parseImport(
      ['14/09/2026 | 450 | Fi | Food | Tea', 'what even is this', '| | |'].join('\n'),
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    // Each says what was actually wrong with IT, rather than one blanket
    // reason: a line with no separators has no columns to read a date from.
    expect(skipped[0]).toMatchObject({ line: 2, why: 'not enough columns' });
    expect(skipped[1]!.why).toMatch(/date/);
  });

  it('refuses a date that is not a real day', () => {
    const { skipped } = parseImport('31/02/2026 | 450 | Fi | Food | Tea');
    expect(skipped[0]!.why).toMatch(/date/);
  });

  it('reads month-first when told to', () => {
    expect(parseImport('09/14/2026 | 450 | Fi | Food | Tea', { dateOrder: 'mdy' }).rows[0]!.day)
      .toBe('2026-09-14');
    // The same text read day-first is not a real date, and says so.
    expect(parseImport('09/14/2026 | 450 | Fi | Food | Tea').skipped).toHaveLength(1);
  });

  it('accepts an ISO date and a two-digit year', () => {
    expect(parseImport('2026-09-14 | 450 | Fi | Food | Tea').rows[0]!.day).toBe('2026-09-14');
    expect(parseImport('14/09/26 | 450 | Fi | Food | Tea').rows[0]!.day).toBe('2026-09-14');
  });

  it('adds up an amount written as a sum', () => {
    expect(parseImport('14/09/2026 | 450+230 | Fi | Food | Two teas').rows[0]!.amount).toBe(680);
  });

  it('refuses a zero or negative amount rather than saving one', () => {
    expect(parseImport('14/09/2026 | 0 | Fi | Food | Tea').skipped).toHaveLength(1);
    expect(parseImport('14/09/2026 | -50 | Fi | Food | Tea').skipped).toHaveLength(1);
  });

  it('skips a header row without reporting it as broken', () => {
    const { rows, skipped } = parseImport(
      ['Date | Amount | Method | Category | Description', '14/09/2026 | 450 | Fi | Food | Tea'].join('\n'),
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('ignores blank lines', () => {
    const { rows, skipped } = parseImport('\n\n14/09/2026 | 450 | Fi | Food | Tea\n\n');
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);
  });
});

/* The prompt and the parser have to agree, or the app hands out instructions
   for a format it will then refuse. */
describe('the prompt and the parser agree', () => {
  it('parses its own worked example', () => {
    const { rows, skipped } = parseImport(IMPORT_EXAMPLE);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.amount)).toEqual([450, 1250, 300, 649.19]);
    // The parking line deliberately has no category, to show the blank case.
    expect(rows[2]!.issues).toEqual(['no-category']);
    // It does NOT block the batch: it goes in unfiled and flagged.
    expect(readyToImport(rows)).toBe(true);
    expect(unsortedCount(rows)).toBe(1);
  });

  it('shows the hospital case the feature exists for', () => {
    const { rows } = parseImport(IMPORT_EXAMPLE);
    const hospital = rows.filter((r) => /hospital/i.test(r.remarks));
    expect(hospital.length).toBeGreaterThan(1);
    // One occasion, one wording, different categories.
    expect(new Set(hospital.map((r) => r.category)).size).toBeGreaterThan(1);
  });

  it('offers only methods and categories the app accepts', () => {
    for (const m of ['Fi', 'Cash', 'ICICI']) expect(IMPORT_PROMPT).toContain(m);
    for (const c of ['Food', 'Medicine', 'Family']) expect(IMPORT_PROMPT).toContain(c);
  });

  it('tells the assistant not to guess', () => {
    for (const rule of ['Never round', 'Do not guess', 'UNREADABLE', 'Do not invent']) {
      expect(IMPORT_PROMPT).toContain(rule);
    }
  });
});

describe('readyToImport', () => {
  it('is false when there is nothing to import', () => {
    expect(readyToImport([])).toBe(false);
  });

  it('is true for a complete row', () => {
    expect(readyToImport(parseImport('14/09/2026 | 450 | Fi | Food | Tea').rows)).toBe(true);
  });

  /* Without a method the money lands on no card and no account, so the row
     would be recorded and still wrong everywhere it matters. */
  it('is false while a method is missing', () => {
    expect(readyToImport(parseImport('14/09/2026 | 450 |  | Food | Tea').rows)).toBe(false);
  });

  /* A missing category only means not-yet-filed. Refusing the batch over it
     is how the expense ends up recorded nowhere at all. */
  it('is true with no category, and says how many are unfiled', () => {
    const { rows } = parseImport(
      ['14/09/2026 | 450 | Fi | Food | Tea', '14/09/2026 | 300 | Cash |  | Parking'].join('\n'),
    );
    expect(readyToImport(rows)).toBe(true);
    expect(unsortedCount(rows)).toBe(1);
  });
});

/* --- Bank labels in the method column ------------------------------------ */

/* A UPI history prints the account the way the BANK names it. Without the
   mapping every such row arrives with no method, and a row with no method
   lands on no card and no account. */
describe('a pasted bank label', () => {
  const bankMethods = {
    'Federal 2788': 'Fi',
    'Utkarsh XX24': 'Super Money',
    'CSB XX06': 'Edge',
    'Federal XX16': 'Scapia',
  };

  it('resolves to the account it maps to', () => {
    const { rows } = parseImport('12/09/2026 | 1580 | Federal 2788 | Medicine | Hospital', { bankMethods });
    expect(rows[0]).toMatchObject({ method: 'Fi', issues: [] });
  });

  it('keeps two accounts at one bank apart', () => {
    const { rows } = parseImport(
      ['12/09/2026 | 100 | Federal 2788 | Food | A', '12/09/2026 | 200 | Federal XX16 | Food | B'].join('\n'),
      { bankMethods },
    );
    expect(rows.map((r) => r.method)).toEqual(['Fi', 'Scapia']);
  });

  /* Three Federal accounts means "Federal" alone is unanswerable, and picking
     one would be a coin toss with money on it. */
  it('flags an ambiguous bank rather than choosing one', () => {
    const { rows } = parseImport('12/09/2026 | 100 | Federal | Food | A', { bankMethods });
    expect(rows[0]!.method).toBe('');
    expect(rows[0]!.issues).toContain('unknown-method');
  });

  it('still accepts a method written the app’s own way', () => {
    expect(parseImport('12/09/2026 | 100 | Fi | Food | A', { bankMethods }).rows[0]!.method).toBe('Fi');
  });

  it('flags a bank nobody has mapped', () => {
    const { rows } = parseImport('12/09/2026 | 100 | HDFC 1234 | Food | A', { bankMethods });
    expect(rows[0]!.issues).toContain('unknown-method');
  });

  it('works with no mapping configured at all', () => {
    expect(parseImport('12/09/2026 | 100 | Fi | Food | A').rows[0]!.method).toBe('Fi');
    expect(parseImport('12/09/2026 | 100 | Federal 2788 | Food | A').rows[0]!.method).toBe('');
  });
});

/* A payment screen describes the card ("Federal CC XX16") where a mapping
   written by hand names it ("Federal XX16"). Same card; the kind words should
   not stop the match — but the account number still has to agree. */
describe('a bank label that says what kind of account it is', () => {
  const bankMethods = {
    'Federal 2788': 'Fi',
    'Federal 3838': 'Jupiter',
    'Federal XX16': 'Scapia',
  };

  it('finds the card through "CC"', () => {
    const { rows } = parseImport('22/09/2026 | 380 | Federal CC XX16 | Medicine | Arafa Medical', { bankMethods });
    expect(rows[0]).toMatchObject({ method: 'Scapia', issues: [] });
  });

  it('finds it through "Bank" and "Credit Card" too, and the other way round', () => {
    expect(parseImport('22/09/2026 | 1 | Federal Bank Credit Card XX16 | Food | x', { bankMethods }).rows[0]!.method)
      .toBe('Scapia');
    const reversed = { 'Federal CC XX16': 'Scapia' };
    expect(parseImport('22/09/2026 | 1 | Federal XX16 | Food | x', { bankMethods: reversed }).rows[0]!.method)
      .toBe('Scapia');
  });

  it('does not let the kind words stand in for the account number', () => {
    // "Federal CC" names no account; three Federal accounts are mapped.
    const { rows } = parseImport('22/09/2026 | 380 | Federal CC | Medicine | x', { bankMethods });
    expect(rows[0]).toMatchObject({ method: '', issues: ['unknown-method'] });
  });
});


/* The moment on a payment screen — "September 22 at 3:11 PM" — decides which
   statement a charge on a bill date belongs to. Noon is only the fallback. */
describe('a time in the date column', () => {
  it('is read in 24-hour and 12-hour forms', () => {
    const at = (d: string) => parseImport(`${d} | 1 | Fi | Food | x`).rows[0];
    expect(at('22/09/2026 15:11')).toMatchObject({ day: '2026-09-22', time: '15:11:00' });
    expect(at('22/09/2026 3:11 PM')).toMatchObject({ day: '2026-09-22', time: '15:11:00' });
    expect(at('22/09/2026 03.11pm')).toMatchObject({ time: '15:11:00' });
    expect(at('22/09/2026 12:05 AM')).toMatchObject({ time: '00:05:00' });
    expect(at('22/09/2026 12:05 PM')).toMatchObject({ time: '12:05:00' });
    expect(at('2026-09-22T15:11:07')).toMatchObject({ day: '2026-09-22', time: '15:11:07' });
  });

  it('is absent, not invented, when only a date was given', () => {
    expect(parseImport('22/09/2026 | 1 | Fi | Food | x').rows[0]).toMatchObject({ time: null });
  });

  it('costs only the time, never the row, when it cannot be read', () => {
    for (const bad of ['22/09/2026 25:00', '22/09/2026 13:05 PM', '22/09/2026 soon']) {
      const { rows, skipped } = parseImport(`${bad} | 1 | Fi | Food | x`);
      expect(skipped).toEqual([]);
      expect(rows[0]).toMatchObject({ day: '2026-09-22', time: null });
    }
  });
});

describe('an amount written the way a receipt prints it', () => {
  it('ignores the currency, however it is written', () => {
    for (const a of ['₹380', 'Rs 380', 'Rs.380', 'rs. 380', 'INR 380']) {
      const { rows, skipped } = parseImport(`22/09/2026 | ${a} | Fi | Medicine | x`);
      expect(skipped, a).toEqual([]);
      expect(rows[0]!.amount, a).toBe(380);
    }
  });
});
