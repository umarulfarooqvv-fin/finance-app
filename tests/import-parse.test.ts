import { describe, expect, it } from 'vitest';
import { parseImport, readyToImport } from '@/lib/import-parse';
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
    expect(readyToImport(rows)).toBe(false);
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
  it('is false while anything is missing, and false when empty', () => {
    expect(readyToImport([])).toBe(false);
    const { rows } = parseImport('14/09/2026 | 450 | Fi | Food | Tea');
    expect(readyToImport(rows)).toBe(true);
  });
});
