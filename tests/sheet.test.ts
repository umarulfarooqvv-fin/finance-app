import { describe, expect, it } from 'vitest';
import { filterRows, groupRows, pivot, sortRows, stats, toCsv, type SheetRow } from '@/lib/sheet';

const row = (id: string, day: string, amount: number, over: Partial<SheetRow> = {}): SheetRow => ({
  id, day, time: '10:00', amount, flow: 'out', type: 'Spend', method: 'Scapia', category: 'Food',
  remarks: '', tags: [], ...over,
});

const ROWS: SheetRow[] = [
  row('a', '2026-09-01', 100, { remarks: 'Tea' }),
  row('b', '2026-09-01', 300, { category: 'Fuel', method: 'Fi', tags: ['Trip'] }),
  row('c', '2026-10-02', 50, { remarks: 'Snacks', tags: ['Trip', 'Work'] }),
  row('d', '2026-10-03', 5000, { type: 'Card bill', category: 'Scapia', method: 'Fi' }),
  row('e', '2026-10-05', 45000, { flow: 'in', type: 'Income', category: 'Salary', method: 'Fi' }),
];

describe('the sheet', () => {
  it('filters by ticked values, text, range and amount', () => {
    expect(filterRows(ROWS, { values: { method: ['Fi'] } }).map((r) => r.id)).toEqual(['b', 'd', 'e']);
    expect(filterRows(ROWS, { values: { tag: ['Work'] } }).map((r) => r.id)).toEqual(['c']);
    expect(filterRows(ROWS, { values: { tag: ['(no tag)'] } })).toHaveLength(3);
    expect(filterRows(ROWS, { q: 'snack' }).map((r) => r.id)).toEqual(['c']);
    expect(filterRows(ROWS, { from: '2026-10-01', max: 1000 }).map((r) => r.id)).toEqual(['c']);
  });

  it('sorts on several columns', () => {
    const s = sortRows(ROWS.slice(0, 3), [{ key: 'category', dir: 'asc' }, { key: 'amount', dir: 'desc' }]);
    expect(s.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('totals out, in and spent apart', () => {
    expect(stats(ROWS)).toMatchObject({ count: 5, out: 5450, in: 45000, spent: 450, min: 50, max: 45000 });
  });

  it('groups by month newest first, a two-tag row under both tags', () => {
    expect(groupRows(ROWS, 'month').map((g) => g.label)).toEqual(['Oct 2026', 'Sep 2026']);
    const tags = groupRows(ROWS, 'tag');
    expect(tags.find((g) => g.key === 'Trip')!.stats.out).toBe(350);
    expect(tags.find((g) => g.key === 'Work')!.stats.count).toBe(1);
  });

  it('pivots with row, column and grand totals', () => {
    const p = pivot(ROWS.filter((r) => r.type === 'Spend'), 'category', 'month', 'sum');
    expect(p.rows.map((r) => r.key)).toEqual(['Fuel', 'Food']);
    expect(p.cells.get('Food\u00002026-09')).toBe(100);
    expect(p.rowTotals.get('Food')).toBe(150);
    expect(p.colTotals.get('2026-10')).toBe(50);
    expect(p.grand).toBe(450);
  });

  it('writes a CSV a spreadsheet can sum, and defuses formulas', () => {
    const csv = toCsv([row('x', '2026-10-01', 10, { remarks: '=cmd, "x"' }), ROWS[4]!], ['day', 'amount', 'remarks']);
    expect(csv.split('\r\n')).toEqual(['Date,Amount,Description', '2026-10-01,-10,"\'=cmd, ""x"""', '2026-10-05,45000,']);
  });
});
