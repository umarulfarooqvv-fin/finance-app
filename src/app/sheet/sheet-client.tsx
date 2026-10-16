'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Download, Filter, Pencil, Search, Table2, X, Grid3x3,
} from 'lucide-react';
import { inputClass } from '@/components/ui/field';
import { Money, Panel, cx } from '@/components/ui/primitives';
import { Private } from '@/contexts/privacy-context';
import { SelectBox, SelectionControls, useSelection } from '@/components/ui/selection';
import { useEntryEditor } from '@/components/entry/entry-editor';
import { TagChips } from '@/components/entry/tag-input';
import { formatDayShort, formatMonth, weekdayName } from '@/lib/time';
import {
  COLUMNS, DEFAULT_COLUMNS, FIELDS, fieldLabel, filterRows, groupRows, pivot, sortRows, stats, toCsv, valueCounts,
  type ColumnKey, type FieldKey, type Measure, type SheetFilter, type SheetRow, type SheetStats, type SortRule,
} from '@/lib/sheet';

/* ===========================================================================
   The spreadsheet. Grouped by day unless another grouping is chosen — every
   list of entries in this app reads by date — and within a group, sorted by
   whatever the headers say. Click a header to sort; Shift-click to add a
   second sort. The funnel on a header filters that column by ticking values,
   the way a spreadsheet's filter does. Double-click a row to edit it.

   The view (columns, grouping, sorting) is remembered on this device; the
   filters are not, because a sheet that silently opens pre-filtered shows
   wrong totals with a straight face.
   =========================================================================== */

const VIEW_KEY = 'pfm:sheet-view';
const PAGE = 300;

/** Which column filters by ticking which field. */
const COLUMN_FIELD: Partial<Record<ColumnKey, FieldKey>> = {
  day: 'month', weekday: 'weekday', month: 'month', type: 'type', method: 'method', category: 'category', tags: 'tag',
};

type View = { columns: ColumnKey[]; groupBy: FieldKey; sort: SortRule[] };
const DEFAULT_VIEW: View = { columns: DEFAULT_COLUMNS, groupBy: 'day', sort: [] };

function readView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<View> | null;
    if (!v) return DEFAULT_VIEW;
    const cols = (v.columns ?? []).filter((c) => COLUMNS.some((x) => x.key === c));
    return {
      columns: cols.length ? cols : DEFAULT_COLUMNS,
      groupBy: FIELDS.some((f) => f.key === v.groupBy) ? v.groupBy! : 'day',
      sort: Array.isArray(v.sort) ? v.sort.filter((s) => COLUMNS.some((x) => x.key === s.key)) : [],
    };
  } catch { return DEFAULT_VIEW; }
}

/* --- A small popover: a button, and a panel under it until a tap outside. --- */
function Pop({ label, icon, active, children, align = 'left', wide, bare, title }: {
  label: ReactNode; icon?: ReactNode; active?: boolean; children: ReactNode; align?: 'left' | 'right'; wide?: boolean;
  /** A small borderless icon, for inside a column header. */
  bare?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={bare
          ? cx('grid h-5 w-5 place-items-center rounded', active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)] opacity-60 hover:opacity-100')
          : cx(
            'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-field)] border px-2 text-xs font-medium',
            active ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]',
          )}
      >
        {icon}{label}
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={cx(
            'absolute top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-pop)]',
            align === 'right' ? 'right-0' : 'left-0',
            wide ? 'w-72' : 'w-56',
          )}>
            {children}
          </div>
        </>
      ) : null}
    </span>
  );
}

/** Excel-style: tick the values to keep, with counts, and a search for long lists. */
function ValuePicker({ field, rows, chosen, onChange }: {
  field: FieldKey; rows: SheetRow[]; chosen: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const all = useMemo(() => valueCounts(rows, field), [rows, field]);
  const shown = all.filter((v) => !q || fieldLabel(field, v.value).toLowerCase().includes(q.toLowerCase()));
  const set = new Set(chosen);
  return (
    <div>
      {all.length > 8 ? (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a value" className={cx(inputClass(), 'mb-2 py-1 text-xs')} />
      ) : null}
      <div className="mb-1 flex gap-3 px-1 text-[11px]">
        <button type="button" className="font-medium text-[var(--color-accent)]" onClick={() => onChange(shown.map((v) => v.value))}>Only these</button>
        <button type="button" className="font-medium text-[var(--color-ink-2)]" onClick={() => onChange([])}>Clear</button>
      </div>
      <ul>
        {shown.map((v) => (
          <li key={v.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--color-raised)]">
              <input
                type="checkbox"
                checked={set.has(v.value)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, v.value] : chosen.filter((c) => c !== v.value))}
              />
              <span className="min-w-0 flex-1 truncate">{fieldLabel(field, v.value)}</span>
              <span className="num text-[10px] text-[var(--color-ink-3)]">{v.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBar({ s, label }: { s: SheetStats; label: string }) {
  const item = (k: string, v: ReactNode) => (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[var(--color-ink-3)]">{k}</span>{v}
    </span>
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
      <span className="font-semibold">{label}</span>
      {item('Count', <span className="num">{s.count.toLocaleString('en-IN')}</span>)}
      {item('Out', <Money value={s.out} size="sm" />)}
      {s.in > 0 ? item('In', <Money value={s.in} size="sm" tone="credit" />) : null}
      {item('Spent', <Money value={s.spent} size="sm" />)}
      {item('Avg', <Money value={s.avg} size="sm" tone="muted" />)}
      {item('Min', <Money value={s.min} size="sm" tone="muted" />)}
      {item('Max', <Money value={s.max} size="sm" tone="muted" />)}
    </div>
  );
}

function Cell({ r, k }: { r: SheetRow; k: ColumnKey }) {
  switch (k) {
    case 'day': return <span className="whitespace-nowrap">{formatDayShort(r.day)}</span>;
    case 'time': return <span className="num text-[var(--color-ink-3)]">{r.time}</span>;
    case 'weekday': return <>{weekdayName(r.day)}</>;
    case 'month': return <span className="whitespace-nowrap">{formatMonth(r.day.slice(0, 7))}</span>;
    case 'amount': return <Money value={r.amount} size="sm" tone={r.flow === 'in' ? 'credit' : 'neutral'} />;
    case 'type': return <span className={cx('whitespace-nowrap', r.flow === 'in' && 'text-[var(--color-pos)]')}>{r.type}</span>;
    case 'tags': return <TagChips tags={r.tags} />;
    case 'remarks': return <span className="block max-w-[22rem] truncate" title={r.remarks}>{r.remarks}</span>;
    default: return <span className="whitespace-nowrap">{r[k]}</span>;
  }
}

export function SheetClient({ rows: allRows, today }: { rows: SheetRow[]; today: string }) {
  const editor = useEntryEditor();
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  useEffect(() => { setView(readView()); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* per-device nicety only */ }
  }, [view, ready]);

  // Pre-logged future entries (EMIs, renewals) are hidden unless asked for,
  // as on Entries — otherwise next year's instalments head the sheet.
  const [upcoming, setUpcoming] = useState(false);
  const futureCount = useMemo(() => allRows.filter((r) => r.day > today).length, [allRows, today]);
  const rows = useMemo(() => (upcoming ? allRows : allRows.filter((r) => r.day <= today)), [allRows, upcoming, today]);

  const [mode, setMode] = useState<'table' | 'pivot'>('table');
  const [filter, setFilter] = useState<SheetFilter>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const sorted = useMemo(() => sortRows(filtered, view.sort), [filtered, view.sort]);
  const groups = useMemo(() => groupRows(sorted, view.groupBy), [sorted, view.groupBy]);
  const total = useMemo(() => stats(filtered), [filtered]);

  const ids = useMemo(() => sorted.map((r) => r.id), [sorted]);
  const sel = useSelection(ids, { keys: true, scope: ids });
  const selStats = useMemo(
    () => (sel.count ? stats(filtered.filter((r) => sel.has(r.id))) : null),
    [sel, filtered],
  );

  const setValues = (f: FieldKey, v: string[]) =>
    setFilter((x) => ({ ...x, values: { ...x.values, [f]: v } }));

  const sortBy = (k: ColumnKey, add: boolean) => setView((v) => {
    const cur = v.sort.find((s) => s.key === k);
    const nextDir = !cur ? (k === 'amount' || k === 'day' ? 'desc' : 'asc') : cur.dir === 'asc' ? 'desc' : null;
    const others = v.sort.filter((s) => s.key !== k);
    const rule = nextDir ? [{ key: k, dir: nextDir } as SortRule] : [];
    return { ...v, sort: add ? [...others, ...rule] : rule };
  });

  // Active filters as chips, each removable.
  const chips: { label: string; clear: () => void }[] = [];
  if (filter.q) chips.push({ label: `“${filter.q}”`, clear: () => setFilter((x) => ({ ...x, q: '' })) });
  for (const f of FIELDS) {
    const v = filter.values?.[f.key];
    if (v?.length) {
      chips.push({
        label: `${f.label}: ${v.slice(0, 2).map((x) => fieldLabel(f.key, x)).join(', ')}${v.length > 2 ? ` +${v.length - 2}` : ''}`,
        clear: () => setValues(f.key, []),
      });
    }
  }
  if (filter.from || filter.to) chips.push({ label: `${filter.from || '…'} → ${filter.to || '…'}`, clear: () => setFilter((x) => ({ ...x, from: '', to: '' })) });
  if (filter.min != null || filter.max != null) chips.push({ label: `₹${filter.min ?? 0} – ${filter.max ?? '∞'}`, clear: () => setFilter((x) => ({ ...x, min: null, max: null })) });

  function exportCsv() {
    const chosen = sel.count ? sorted.filter((r) => sel.has(r.id)) : sorted;
    const blob = new Blob([toCsv(chosen, view.columns)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `entries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Render a page of rows at a time — thousands of table rows on a phone is slow.
  let budget = limit;
  const visibleGroups = groups.map((g) => {
    if (collapsed.has(g.key) || budget <= 0) return { g, rows: [] as SheetRow[], cut: budget <= 0 };
    const rs = g.rows.slice(0, budget);
    budget -= rs.length;
    return { g, rows: rs, cut: false };
  });
  const hiddenRows = sorted.length - Math.min(limit, sorted.length);
  // Grouped by day, each heading already says the date — the column would
  // repeat it on every row, in width a phone does not have.
  const cols = COLUMNS.filter((c) => view.columns.includes(c.key) && !(c.key === 'day' && view.groupBy === 'day'));

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]" aria-hidden="true" />
            <input
              type="search"
              value={filter.q ?? ''}
              onChange={(e) => setFilter((x) => ({ ...x, q: e.target.value }))}
              placeholder="Search every column"
              aria-label="Search every column"
              className={cx(inputClass(), 'h-9 py-1 pl-9')}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Pop title="Filters" label={<span className="hidden sm:inline">Filters</span>} icon={<Filter className="h-3.5 w-3.5" />} active={chips.length > 0} wide>
            <div className="flex flex-col gap-3 p-1 text-xs">
              {futureCount > 0 ? (
                <label className="flex items-center gap-2 text-[var(--color-ink-2)]">
                  <input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} />
                  Include {futureCount} pre-logged future {futureCount === 1 ? 'entry' : 'entries'}
                </label>
              ) : null}
              <div>
                <div className="mb-1 font-medium text-[var(--color-ink-3)]">Dates</div>
                <div className="flex items-center gap-1.5">
                  <input type="date" value={filter.from ?? ''} onChange={(e) => setFilter((x) => ({ ...x, from: e.target.value }))} className={cx(inputClass(), 'py-1 text-xs')} aria-label="From" />
                  <span>→</span>
                  <input type="date" value={filter.to ?? ''} onChange={(e) => setFilter((x) => ({ ...x, to: e.target.value }))} className={cx(inputClass(), 'py-1 text-xs')} aria-label="To" />
                </div>
              </div>
              <div>
                <div className="mb-1 font-medium text-[var(--color-ink-3)]">Amount</div>
                <div className="flex items-center gap-1.5">
                  <input inputMode="decimal" placeholder="Min" value={filter.min ?? ''} onChange={(e) => setFilter((x) => ({ ...x, min: e.target.value === '' ? null : Number(e.target.value) || 0 }))} className={cx(inputClass(), 'py-1 text-xs')} aria-label="Minimum amount" />
                  <span>–</span>
                  <input inputMode="decimal" placeholder="Max" value={filter.max ?? ''} onChange={(e) => setFilter((x) => ({ ...x, max: e.target.value === '' ? null : Number(e.target.value) || 0 }))} className={cx(inputClass(), 'py-1 text-xs')} aria-label="Maximum amount" />
                </div>
              </div>
              {(['type', 'method', 'category', 'tag', 'month', 'year', 'weekday'] as FieldKey[]).map((f) => (
                <details key={f}>
                  <summary className="cursor-pointer font-medium text-[var(--color-ink-2)]">
                    {FIELDS.find((x) => x.key === f)!.label}
                    {filter.values?.[f]?.length ? <span className="text-[var(--color-accent)]"> · {filter.values[f]!.length}</span> : null}
                  </summary>
                  <div className="mt-1">
                    <ValuePicker field={f} rows={rows} chosen={filter.values?.[f] ?? []} onChange={(v) => setValues(f, v)} />
                  </div>
                </details>
              ))}
            </div>
          </Pop>

          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
            <span className="hidden sm:inline">Group by</span>
            <select aria-label="Group by" value={view.groupBy} onChange={(e) => { setView((v) => ({ ...v, groupBy: e.target.value as FieldKey })); setCollapsed(new Set()); }}
              className="h-8 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 text-xs text-[var(--color-ink)]">
              {FIELDS.map((f) => <option key={f.key} value={f.key}>By {f.label.toLowerCase()}</option>)}
            </select>
          </label>

          <Pop title="Columns" label={<span className="hidden sm:inline">Columns</span>} icon={<Columns3 className="h-3.5 w-3.5" />}>
            {COLUMNS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--color-raised)]">
                <input
                  type="checkbox"
                  checked={view.columns.includes(c.key)}
                  disabled={view.columns.length === 1 && view.columns.includes(c.key)}
                  onChange={(e) => setView((v) => ({
                    ...v,
                    columns: e.target.checked
                      ? COLUMNS.map((x) => x.key).filter((k) => k === c.key || v.columns.includes(k))
                      : v.columns.filter((k) => k !== c.key),
                  }))}
                />
                {c.label}
              </label>
            ))}
            <button type="button" className="mt-1 px-1 text-[11px] font-medium text-[var(--color-accent)]" onClick={() => setView(DEFAULT_VIEW)}>
              Reset the view
            </button>
          </Pop>

          <button type="button" onClick={exportCsv} title="Download as CSV"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-line)] px-2 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV{sel.count ? ` (${sel.count})` : ''}
          </button>
          <div role="group" aria-label="View" className="inline-flex h-8 items-center rounded-[var(--radius-field)] border border-[var(--color-line)] p-0.5">
            {([['table', 'Table', <Table2 key="t" className="h-3.5 w-3.5" />], ['pivot', 'Pivot', <Grid3x3 key="p" className="h-3.5 w-3.5" />]] as const).map(([v, text, icon]) => (
              <button key={v} type="button" aria-pressed={mode === v} aria-label={text} title={text} onClick={() => setMode(v)}
                className={cx('inline-flex items-center gap-1 rounded-[calc(var(--radius-field)-2px)] px-2.5 py-1 text-xs font-medium',
                  mode === v ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-ink-2)]')}>
                {icon}<span className="hidden sm:inline">{text}</span>
              </button>
            ))}
          </div>
        </div>

        {chips.length || view.sort.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <button key={c.label} type="button" onClick={c.clear}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                {c.label} <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
            {view.sort.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setView((v) => ({ ...v, sort: v.sort.filter((x) => x.key !== s.key) }))}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-ink-2)]">
                {i === 0 ? 'Sorted' : 'then'} {COLUMNS.find((c) => c.key === s.key)!.label} {s.dir === 'asc' ? '↑' : '↓'} <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
            {chips.length ? (
              <button type="button" onClick={() => setFilter({})} className="text-[11px] font-medium text-[var(--color-ink-2)] hover:underline">Clear filters</button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 border-t border-[var(--color-line)] pt-2">
          <StatusBar s={selStats ?? total} label={selStats ? 'Selected' : chips.length ? 'Filtered' : 'All'} />
        </div>
      </Panel>

      {mode === 'pivot' ? <PivotPanel rows={filtered} /> : (
        <Panel className="mt-4" padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <SelectionControls sel={sel} total={ids.length} noun="entry" nouns="entries" shortcuts />
            <button type="button" className="text-[11px] font-medium text-[var(--color-accent)]"
              onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.key)))}>
              {collapsed.size ? 'Expand all' : 'Collapse all'}
            </button>
          </div>
          <div className="max-h-[calc(100dvh-12rem)] overflow-auto border-t border-[var(--color-line)]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
                <tr>
                  <th className="w-8 border-b border-[var(--color-line)] px-2 py-2" />
                  {cols.map((c) => {
                    const s = view.sort.findIndex((x) => x.key === c.key);
                    const rule = view.sort[s];
                    const field = COLUMN_FIELD[c.key];
                    return (
                      <th key={c.key} className={cx('whitespace-nowrap border-b border-[var(--color-line)] px-2 py-2 font-medium text-[var(--color-ink-3)]', c.numeric ? 'text-right' : 'text-left')}>
                        <span className={cx('inline-flex items-center gap-1', c.numeric && 'flex-row-reverse')}>
                          <button
                            type="button"
                            onClick={(e) => sortBy(c.key, e.shiftKey)}
                            title="Sort — Shift-click to add a second sort"
                            className={cx('inline-flex items-center gap-0.5 hover:text-[var(--color-ink)]', rule && 'text-[var(--color-accent)]')}
                          >
                            {c.label}
                            {rule ? (rule.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            {rule && view.sort.length > 1 ? <sup>{s + 1}</sup> : null}
                          </button>
                          {field ? (
                            <Pop bare title={`Filter ${c.label}`} label="" icon={<Filter className="h-3 w-3" aria-hidden="true" />} active={Boolean(filter.values?.[field]?.length)} align={c.key === 'tags' ? 'right' : 'left'}>
                              <ValuePicker field={field} rows={rows} chosen={filter.values?.[field] ?? []} onChange={(v) => setValues(field, v)} />
                            </Pop>
                          ) : null}
                        </span>
                      </th>
                    );
                  })}
                  <th className="w-8 border-b border-[var(--color-line)]" />
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map(({ g, rows: rs, cut }) => cut ? null : (
                  <GroupRows key={g.key} label={g.label} st={g.stats} span={cols.length + 2}
                    open={!collapsed.has(g.key)}
                    onToggle={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                    {rs.map((r) => (
                      <tr
                        key={`${g.key}-${r.id}`}
                        onDoubleClick={() => editor?.edit(r.id)}
                        className={cx('border-b border-[var(--color-line)] hover:bg-[var(--color-raised)]', sel.has(r.id) && 'bg-[var(--color-accent-soft)]')}
                      >
                        <td className="px-2 py-1.5"><SelectBox sel={sel} k={r.id} label={`Select ${r.remarks || r.category}`} /></td>
                        {cols.map((c) => (
                          <td key={c.key} className={cx('px-2 py-1.5', c.numeric && 'text-right')}><Cell r={r} k={c.key} /></td>
                        ))}
                        <td className="px-1">
                          {editor ? (
                            <button type="button" onClick={() => editor.edit(r.id)} aria-label={`Edit ${r.remarks || r.category}`}
                              className="grid h-6 w-6 place-items-center rounded text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]">
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--color-ink-3)]">Nothing matches these filters.</p>
            ) : null}
          </div>
          {hiddenRows > 0 ? (
            <div className="border-t border-[var(--color-line)] p-2 text-center">
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-xs font-medium text-[var(--color-accent)]">
                Show {Math.min(PAGE, hiddenRows).toLocaleString('en-IN')} more of {hiddenRows.toLocaleString('en-IN')}
              </button>
            </div>
          ) : null}
          <p className="px-3 py-2 text-[10px] text-[var(--color-ink-3)]">
            Click a header to sort, Shift-click to sort by a second column too. Double-click a row, or
            its pencil, to edit it. Tick rows to total just those; CSV exports the ticked rows, or
            everything shown. In the CSV, money out is negative so a SUM is the net.
          </p>
        </Panel>
      )}
    </>
  );
}

function GroupRows({ label, st, span, open, onToggle, children }: {
  label: string; st: SheetStats; span: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <>
      <tr className="bg-[var(--color-raised)]">
        <td colSpan={span} className="px-2 py-1.5">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className="min-w-0 flex-1 truncate"><Private>{label}</Private></span>
            <span className="font-normal text-[var(--color-ink-3)]">{st.count}</span>
            <Money value={st.out} size="sm" className="font-semibold" />
            {st.in > 0 ? <Money value={st.in} size="sm" tone="credit" className="font-semibold" /> : null}
          </button>
        </td>
      </tr>
      {open ? children : null}
    </>
  );
}

function PivotPanel({ rows }: { rows: SheetRow[] }) {
  const [rowBy, setRowBy] = useState<FieldKey>('category');
  const [colBy, setColBy] = useState<FieldKey | ''>('month');
  const [measure, setMeasure] = useState<Measure>('sum');
  const [spendOnly, setSpendOnly] = useState(true);
  const base = useMemo(() => (spendOnly ? rows.filter((r) => r.type === 'Spend') : rows), [rows, spendOnly]);
  const p = useMemo(() => pivot(base, rowBy, colBy || null, measure), [base, rowBy, colBy, measure]);
  const fmt = (v: number | undefined) => v == null ? <span className="text-[var(--color-ink-3)]">·</span>
    : measure === 'count' ? <span className="num">{v.toLocaleString('en-IN')}</span> : <Money value={v} size="sm" />;
  const select = (value: string, on: (v: string) => void, opts: [string, string][], label: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
      {label}
      <select value={value} onChange={(e) => on(e.target.value)} className="rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs text-[var(--color-ink)]">
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
  const fieldOpts = FIELDS.map((f) => [f.key, f.label] as [string, string]);

  return (
    <Panel className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {select(rowBy, (v) => setRowBy(v as FieldKey), fieldOpts, 'Rows')}
        {select(colBy, (v) => setColBy(v as FieldKey | ''), [['', '(none)'], ...fieldOpts], 'Columns')}
        {select(measure, (v) => setMeasure(v as Measure), [['sum', 'Total'], ['count', 'Count'], ['avg', 'Average']], 'Show')}
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          <input type="checkbox" checked={spendOnly} onChange={(e) => setSpendOnly(e.target.checked)} />
          Spending only
        </label>
      </div>
      <div className="max-h-[70dvh] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
            <tr>
              <th className="sticky left-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-2 text-left font-medium text-[var(--color-ink-3)]">
                {FIELDS.find((f) => f.key === rowBy)!.label}
              </th>
              {p.cols.map((c) => (
                <th key={c.key} className="whitespace-nowrap border-b border-[var(--color-line)] px-2 py-2 text-right font-medium text-[var(--color-ink-3)]">{c.label}</th>
              ))}
              <th className="border-b border-[var(--color-line)] px-2 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.key} className="border-b border-[var(--color-line)] hover:bg-[var(--color-raised)]">
                <td className="sticky left-0 max-w-[12rem] truncate bg-[var(--color-surface)] px-2 py-1.5"><Private>{r.label}</Private></td>
                {p.cols.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-right">{fmt(p.cells.get(`${r.key}\u0000${c.key}`))}</td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{fmt(p.rowTotals.get(r.key))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="sticky left-0 bg-[var(--color-surface)] px-2 py-2">Total</td>
              {p.cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-2 py-2 text-right">{fmt(p.colTotals.get(c.key))}</td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 text-right">{fmt(p.grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-[var(--color-ink-3)]">
        Uses the rows the filters above leave. &ldquo;Spending only&rdquo; counts money consumed — not
        card bills, lending or savings — the same definition as the rest of the app.
        {rowBy === 'tag' || colBy === 'tag' ? ' An entry with two tags counts under both.' : ''}
      </p>
    </Panel>
  );
}
