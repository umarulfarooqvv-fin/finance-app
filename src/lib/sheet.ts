import { foldForSearch } from '@/lib/search-text';
import { formatDay, formatMonth, weekdayIndex, weekdayName } from '@/lib/time';
import type { Income, Transaction, TxKind } from '@/lib/types';

/* ===========================================================================
   Entries as a spreadsheet: one flat set of rows, and the things a
   spreadsheet does to them — filter by column, sort on several columns,
   group with subtotals, a status bar of totals, a pivot, and CSV out.

   Spending and money received live in two tables; here they are one sheet,
   told apart by Type, because "everything on the Fi account in March" is one
   question. Amounts stay positive with a direction — a spend and a salary are
   not the same sign of the same thing, and summing them together answers
   nothing — so the totals report Out and In separately.

   Pure: rows in, rows out. The page filters as you type on the client.
   =========================================================================== */

export type SheetType = 'Spend' | 'Card bill' | 'Lent' | 'Saved' | 'EMI' | 'Unsorted' | 'Income';

export const TYPE_OF: Record<TxKind, SheetType> = {
  spend: 'Spend',
  card_payment: 'Card bill',
  credit_given: 'Lent',
  investment: 'Saved',
  emi: 'EMI',
  unknown: 'Unsorted',
};

export type SheetRow = {
  id: string;
  /** "YYYY-MM-DD". */
  day: string;
  /** "HH:MM". */
  time: string;
  amount: number;
  flow: 'out' | 'in';
  type: SheetType;
  /** Paid from — or, for income, the account it arrived in. */
  method: string;
  /** Category — or, for income, its source. */
  category: string;
  remarks: string;
  tags: string[];
};

export function sheetRows(transactions: Transaction[], income: Income[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const t of transactions) {
    if (t.deleted || !t.ts || t.amount == null) continue;
    rows.push({
      id: t.id, day: t.ts.slice(0, 10), time: t.ts.slice(11, 16), amount: t.amount,
      flow: 'out', type: TYPE_OF[t.kind], method: t.method, category: t.category,
      remarks: t.remarks, tags: t.userTags,
    });
  }
  for (const i of income) {
    if (i.deleted || !i.ts || i.amount == null) continue;
    rows.push({
      id: i.id, day: i.ts.slice(0, 10), time: i.ts.slice(11, 16), amount: i.amount,
      flow: 'in', type: 'Income', method: i.account, category: i.source,
      remarks: i.remarks, tags: [],
    });
  }
  return rows.sort((a, b) => cmp(b.day + b.time, a.day + a.time));
}

/* --- Columns ------------------------------------------------------------- */

export type ColumnKey = 'day' | 'time' | 'weekday' | 'month' | 'amount' | 'type' | 'method' | 'category' | 'remarks' | 'tags';

export const COLUMNS: { key: ColumnKey; label: string; numeric?: boolean }[] = [
  { key: 'day', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'weekday', label: 'Weekday' },
  { key: 'month', label: 'Month' },
  { key: 'amount', label: 'Amount', numeric: true },
  { key: 'type', label: 'Type' },
  { key: 'method', label: 'Paid from' },
  { key: 'category', label: 'Category' },
  { key: 'remarks', label: 'Description' },
  { key: 'tags', label: 'Tags' },
];

export const DEFAULT_COLUMNS: ColumnKey[] = ['day', 'time', 'amount', 'type', 'method', 'category', 'remarks', 'tags'];

/** Fields with a short list of values: filterable by ticking, groupable, pivotable. */
export type FieldKey = 'month' | 'year' | 'weekday' | 'type' | 'method' | 'category' | 'tag' | 'day';

export const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'weekday', label: 'Weekday' },
  { key: 'type', label: 'Type' },
  { key: 'method', label: 'Paid from' },
  { key: 'category', label: 'Category' },
  { key: 'tag', label: 'Tag' },
];

export const NO_TAG = '(no tag)';

/** A row's value(s) for a field. Only Tag can have several. */
export function fieldValues(r: SheetRow, f: FieldKey): string[] {
  switch (f) {
    case 'day': return [r.day];
    case 'month': return [r.day.slice(0, 7)];
    case 'year': return [r.day.slice(0, 4)];
    case 'weekday': return [weekdayName(r.day)];
    case 'type': return [r.type];
    case 'method': return [r.method || '(none)'];
    case 'category': return [r.category || '(none)'];
    case 'tag': return r.tags.length ? r.tags : [NO_TAG];
  }
}

/** How a field's value is shown: "2026-03" reads "Mar 2026". */
export function fieldLabel(f: FieldKey, v: string): string {
  if (f === 'month' && /^\d{4}-\d{2}$/.test(v)) return formatMonth(v);
  if (f === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDay(v);
  return v;
}

/** Dates newest first, weekdays Monday first, everything else by the caller. */
function naturalOrder(f: FieldKey): ((a: string, b: string) => number) | null {
  if (f === 'day' || f === 'month' || f === 'year') return (a, b) => cmp(b, a);
  if (f === 'weekday') {
    const idx = (n: string) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].findIndex((w) => n.startsWith(w));
    return (a, b) => idx(a) - idx(b);
  }
  return null;
}

/* --- Filter -------------------------------------------------------------- */

export type SheetFilter = {
  /** Free text over description, category, paid from, tags and the amount. */
  q?: string;
  /** Per-field allowed values; absent or empty = any. */
  values?: Partial<Record<FieldKey, string[]>>;
  /** Inclusive day range. */
  from?: string;
  to?: string;
  min?: number | null;
  max?: number | null;
};

export function filterRows(rows: SheetRow[], f: SheetFilter): SheetRow[] {
  const q = foldForSearch(f.q ?? '');
  const sets = Object.entries(f.values ?? {})
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => [k as FieldKey, new Set(v)] as const);
  return rows.filter((r) => {
    if (f.from && r.day < f.from) return false;
    if (f.to && r.day > f.to) return false;
    if (f.min != null && r.amount < f.min) return false;
    if (f.max != null && r.amount > f.max) return false;
    for (const [k, set] of sets) {
      if (!fieldValues(r, k).some((v) => set.has(v))) return false;
    }
    if (q) {
      const hay = foldForSearch(`${r.remarks} ${r.category} ${r.method} ${r.type} ${r.tags.join(' ')} ${r.amount}`);
      if (!q.split(' ').every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Every value a field takes in these rows, with how many rows have it. */
export function valueCounts(rows: SheetRow[], f: FieldKey): { value: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) for (const v of fieldValues(r, f)) n.set(v, (n.get(v) ?? 0) + 1);
  const order = naturalOrder(f);
  return [...n].map(([value, count]) => ({ value, count }))
    .sort((a, b) => (order ? order(a.value, b.value) : b.count - a.count || a.value.localeCompare(b.value)));
}

/* --- Sort ---------------------------------------------------------------- */

export type SortRule = { key: ColumnKey; dir: 'asc' | 'desc' };

function sortValue(r: SheetRow, k: ColumnKey): string | number {
  switch (k) {
    case 'amount': return r.amount;
    case 'weekday': return weekdayIndex(r.day);
    case 'month': return r.day.slice(0, 7);
    case 'tags': return r.tags.join(', ').toLowerCase();
    case 'day': return r.day + r.time;
    default: return String(r[k] ?? '').toLowerCase();
  }
}

function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Several rules, first one wins; ties fall back to newest first. */
export function sortRows(rows: SheetRow[], rules: SortRule[]): SheetRow[] {
  return [...rows].sort((a, b) => {
    for (const r of rules) {
      const c = cmp(sortValue(a, r.key), sortValue(b, r.key));
      if (c !== 0) return r.dir === 'asc' ? c : -c;
    }
    return cmp(b.day + b.time, a.day + a.time);
  });
}

/* --- Totals -------------------------------------------------------------- */

export type SheetStats = {
  count: number;
  /** Everything that went out: spends, bills, lending, savings. */
  out: number;
  /** Money received. */
  in: number;
  /** Spend by the app's definition — consumed money only. */
  spent: number;
  avg: number;
  min: number;
  max: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function stats(rows: SheetRow[]): SheetStats {
  let out = 0, inn = 0, spent = 0, sum = 0;
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    if (r.flow === 'in') inn += r.amount; else out += r.amount;
    if (r.type === 'Spend') spent += r.amount;
    sum += r.amount;
    if (r.amount < min) min = r.amount;
    if (r.amount > max) max = r.amount;
  }
  const count = rows.length;
  return {
    count, out: r2(out), in: r2(inn), spent: r2(spent),
    avg: count ? r2(sum / count) : 0,
    min: count ? min : 0,
    max: count ? max : 0,
  };
}

/* --- Group --------------------------------------------------------------- */

export type SheetGroup = { key: string; label: string; rows: SheetRow[]; stats: SheetStats };

/**
 * Rows under a heading per value, with subtotals. A row with two tags sits
 * under both when grouped by tag — that is what each occasion cost — so the
 * group subtotals can add up to more than the grand total, which is always
 * computed from the rows themselves.
 */
export function groupRows(rows: SheetRow[], by: FieldKey, order: 'natural' | 'total' = 'natural'): SheetGroup[] {
  const m = new Map<string, SheetRow[]>();
  for (const r of rows) {
    for (const v of fieldValues(r, by)) {
      const list = m.get(v);
      if (list) list.push(r); else m.set(v, [r]);
    }
  }
  const groups = [...m].map(([key, rs]) => ({ key, label: fieldLabel(by, key), rows: rs, stats: stats(rs) }));
  const nat = naturalOrder(by);
  return groups.sort((a, b) =>
    order === 'natural' && nat ? nat(a.key, b.key) : (b.stats.out + b.stats.in) - (a.stats.out + a.stats.in));
}

/* --- Pivot --------------------------------------------------------------- */

export type Measure = 'sum' | 'count' | 'avg';

export type Pivot = {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  /** `${row}\u0000${col}` → value. */
  cells: Map<string, number>;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  grand: number;
};

const TOTAL = '\u0001';

export function pivot(rows: SheetRow[], rowBy: FieldKey, colBy: FieldKey | null, measure: Measure): Pivot {
  type Acc = { sum: number; n: number };
  const acc = new Map<string, Acc>();
  const add = (k: string, amount: number) => {
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += amount; a.n += 1;
    acc.set(k, a);
  };
  const rowKeys = new Map<string, number>();
  const colKeys = new Map<string, number>();
  for (const r of rows) {
    const cols = colBy ? fieldValues(r, colBy) : [TOTAL];
    for (const rv of fieldValues(r, rowBy)) {
      rowKeys.set(rv, (rowKeys.get(rv) ?? 0) + r.amount);
      add(`${rv}\u0000${TOTAL}`, r.amount);
      for (const cv of cols) {
        if (colBy) {
          colKeys.set(cv, (colKeys.get(cv) ?? 0) + r.amount);
          add(`${rv}\u0000${cv}`, r.amount);
        }
      }
    }
    for (const cv of cols) if (colBy) add(`${TOTAL}\u0000${cv}`, r.amount);
    add(`${TOTAL}\u0000${TOTAL}`, r.amount);
  }
  const val = (a: Acc | undefined) =>
    !a ? 0 : measure === 'count' ? a.n : measure === 'avg' ? r2(a.sum / a.n) : r2(a.sum);

  const order = (f: FieldKey, m: Map<string, number>) => {
    const nat = naturalOrder(f);
    return [...m].sort((a, b) => (nat ? nat(a[0], b[0]) : b[1] - a[1])).map(([key]) => ({ key, label: fieldLabel(f, key) }));
  };
  const rowList = order(rowBy, rowKeys);
  const colList = colBy ? order(colBy, colKeys) : [];

  const cells = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const r of rowList) {
    rowTotals.set(r.key, val(acc.get(`${r.key}\u0000${TOTAL}`)));
    for (const c of colList) {
      const a = acc.get(`${r.key}\u0000${c.key}`);
      if (a) cells.set(`${r.key}\u0000${c.key}`, val(a));
    }
  }
  for (const c of colList) colTotals.set(c.key, val(acc.get(`${TOTAL}\u0000${c.key}`)));
  return { rows: rowList, cols: colList, cells, rowTotals, colTotals, grand: val(acc.get(`${TOTAL}\u0000${TOTAL}`)) };
}

/* --- CSV ----------------------------------------------------------------- */

function cell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  // Text a spreadsheet would run as a formula gets a leading apostrophe;
  // anything it would split is quoted.
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function displayValue(r: SheetRow, k: ColumnKey): string | number {
  switch (k) {
    case 'weekday': return weekdayName(r.day);
    case 'month': return formatMonth(r.day.slice(0, 7));
    case 'tags': return r.tags.join(', ');
    case 'amount': return r.flow === 'in' ? r.amount : -r.amount;
    default: return r[k];
  }
}

/** Money out is negative in the file, so a SUM in the spreadsheet is the net. */
export function toCsv(rows: SheetRow[], columns: ColumnKey[]): string {
  const head = columns.map((k) => COLUMNS.find((c) => c.key === k)!.label);
  const lines = [head.map(cell).join(',')];
  for (const r of rows) lines.push(columns.map((k) => cell(displayValue(r, k))).join(','));
  return lines.join('\r\n');
}
