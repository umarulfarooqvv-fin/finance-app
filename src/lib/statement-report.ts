import { byTag, isSpend, round2, type Breakdown } from '@/lib/analytics';
import { analyseCard } from '@/lib/card-analysis';
import { creditLedger } from '@/lib/credit';
import { cycleOverridesFrom, type Cycle } from '@/lib/cycles';
import { cardDetail, statementHistory } from '@/lib/statement';
import {
  addDays, dayOf, daysBetween, weekdayIndex, type Day, type Instant,
} from '@/lib/time';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   One card statement, explained.

   Nothing here is a new definition. Spending, lending, categories and tags come
   from analyseCard; what has been returned comes from the credit ledger's FIFO
   allocation; the bill's own arithmetic comes from the statement history. A
   report that re-derived any of them would sooner or later give a different
   answer from the page beside it, and then neither could be believed.

   The one idea the report adds is that the lent part of a bill is a different
   thing from the spent part: it is somebody else's, it comes back, and until it
   does it is the thing worth chasing. So every lending on the statement is
   listed with whether it has been repaid — and a repayment that was received
   but never recorded, or recorded but never linked to a person, is exactly what
   leaves it looking unpaid, so both are surfaced.

   Pure: a snapshot in, plain data out.
   =========================================================================== */

export type LendingStatus = 'returned' | 'partly' | 'waiting';

export type ReportLending = {
  txId: string;
  ts: Instant;
  person: string;
  remarks: string;
  amount: number;
  repaid: number;
  outstanding: number;
  status: LendingStatus;
  /** Days since it was lent, for one that has not come back; null once it has. */
  daysWaiting: number | null;
};

export type ReportReturn = {
  id: string;
  ts: Instant;
  amount: number;
  /** The account it arrived in, when it was recorded as income. */
  account: string;
  note: string;
};

export type ReportPerson = {
  person: string;
  /** This statement's lendings to them. */
  lendings: ReportLending[];
  lent: number;
  repaid: number;
  outstanding: number;
  /** Everything they have ever been lent / returned / still owe, on any card. */
  allTime: { given: number; repaid: number; outstanding: number };
  /** Their repayments, newest first. */
  returns: ReportReturn[];
  /** Every lending of theirs not yet repaid, oldest first — the order a
      repayment settles them in. */
  queue: { txId: string; ts: Instant; remarks: string; outstanding: number }[];
};

export type UnlinkedReturn = {
  id: string;
  ts: Instant;
  amount: number;
  source: string;
  note: string;
};

export type StatementSummaryRow = {
  statementEnd: Day;
  charges: number;
  own: number;
  lent: number;
  closing: number;
};

export type StatementReport = {
  card: string;
  /** Every statement that can be reported on, newest first. */
  statements: { statementEnd: Day; label: string }[];
  cycle: Cycle;
  /** The bill. */
  bill: {
    opening: number;
    charges: number;
    payments: number;
    closing: number;
    /** What the bank said, when its statement has been recorded. */
    bank: { due: number; diff: number } | null;
    /** How much of this bill is still unpaid, and whether it is all paid. */
    unpaid: number;
    paidInFull: boolean;
  };
  /** What the charges were, in plain parts. They add up to `charges`. */
  parts: { own: number; lent: number; other: number };
  /** Of what was lent on this statement: returned / still to come. */
  lentSplit: { returned: number; waiting: number };
  /** Your own spending only. */
  categories: Breakdown[];
  tags: Breakdown[];
  largest: { id: string; ts: Instant; remarks: string; category: string; amount: number; lent: boolean }[];
  days: {
    series: { day: Day; total: number }[];
    count: number;
    spendingDays: number;
    perDay: number;
    busiest: { day: Day; total: number } | null;
  };
  weekdays: Breakdown[];
  people: ReportPerson[];
  /** Money received that looks like a repayment but is not linked to anyone. */
  unlinked: UnlinkedReturn[];
  /** The last few statements side by side, newest last. */
  recent: StatementSummaryRow[];
  /** This statement against the one before it. */
  versus: {
    previous: Day;
    charges: number;
    own: number;
    lent: number;
    closing: number;
    categories: { key: string; now: number; before: number }[];
  } | null;
};

const RECENT = 6;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const shortMonth = (d: Day) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function statementReport(
  snap: Snapshot,
  cardName: string,
  statementEnd?: string,
): StatementReport | null {
  const card = snap.cards.find((c) => c.name === cardName);
  if (!card) return null;

  const today = dayOf(snap.loadedAt);
  const overrides = cycleOverridesFrom(snap.config);
  const ledger = creditLedger(snap);
  // statementHistory runs oldest first (it is a table); the report thinks newest first.
  const history = statementHistory(snap, card, today, ledger.outstandingByTx, overrides, 14).reverse();
  if (history.length === 0) return null;

  const at = Math.max(0, history.findIndex((h) => h.cycle.statementEnd === statementEnd));
  const row = history[at]!;
  const newer = at > 0 ? history[at - 1]! : null;
  const older = history[at + 1] ?? null;
  const cycle = row.cycle;

  const a = analyseCard(snap, card.name, cycle.cycleStart, cycle.periodEnd);
  const kindTotal = (k: string) => a.byKind.find((x) => x.kind === k)?.total ?? 0;
  const own = a.spend.total;
  const lent = round2(kindTotal('credit_given'));
  const other = round2(a.charges.total - own - lent);

  /* --- What is still unpaid on this bill ------------------------------------
     The latest bill: what the card page calls "on this bill". An older one:
     what the NEXT bill carried in, which is exactly what its payments left
     over. */
  const unpaid = newer
    ? round2(Math.max(0, newer.carriedIn))
    : round2(Math.max(0, cardDetail(snap, card, today).row.remainingDueBill));

  // --- Every lending on this statement, with its status ---------------------
  const txById = new Map(snap.transactions.map((t) => [t.id, t]));
  const incomeById = new Map(snap.income.map((i) => [i.id, i]));
  const lo = `${cycle.cycleStart}T00:00:00`;
  const hi = `${cycle.periodEnd}T23:59:59`;

  const people: ReportPerson[] = [];
  for (const p of ledger.people) {
    const mine = p.lendings.filter((l) => l.card === card.name && l.ts >= lo && l.ts <= hi);
    if (mine.length === 0) continue;
    const lendings: ReportLending[] = mine
      .map((l) => ({
        txId: l.txId,
        ts: l.ts,
        person: p.person,
        remarks: (txById.get(l.txId)?.remarks ?? '').trim(),
        amount: l.amount,
        repaid: round2(l.repaid),
        outstanding: round2(l.outstanding),
        status: (l.outstanding < 0.005 ? 'returned' : l.repaid > 0.005 ? 'partly' : 'waiting') as LendingStatus,
        daysWaiting: l.outstanding < 0.005 ? null : Math.max(0, daysBetween(dayOf(l.ts), today)),
      }))
      .sort((x, y) => (x.ts < y.ts ? -1 : 1));
    const given = round2(lendings.reduce((s, l) => s + l.amount, 0));
    const out = round2(lendings.reduce((s, l) => s + l.outstanding, 0));
    people.push({
      person: p.person,
      lendings,
      lent: given,
      repaid: round2(given - out),
      outstanding: out,
      allTime: { given: p.given, repaid: p.repaid, outstanding: p.outstanding },
      returns: [...p.repayments]
        .sort((x, y) => (x.ts < y.ts ? 1 : -1))
        .slice(0, 6)
        .map((r) => ({
          id: r.id,
          ts: r.ts,
          amount: r.amount,
          account: incomeById.get(r.id)?.account ?? (r.via === 'manual' ? 'Recorded by hand' : ''),
          note: r.note,
        })),
      queue: p.lendings
        .filter((l) => l.outstanding > 0.005)
        .sort((x, y) => (x.ts < y.ts ? -1 : 1))
        .map((l) => ({
          txId: l.txId,
          ts: l.ts,
          remarks: (txById.get(l.txId)?.remarks ?? '').trim(),
          outstanding: round2(l.outstanding),
        })),
    });
  }
  people.sort((x, y) => y.outstanding - x.outstanding || y.lent - x.lent);

  const returned = round2(people.reduce((s, p) => s + p.repaid, 0));
  const waiting = round2(people.reduce((s, p) => s + p.outstanding, 0));

  // --- Own spending, day by day ---------------------------------------------
  const ownRows = a.chargeRows.filter(isSpend);
  const byDay = new Map<Day, number>();
  const byWeekday = new Array<number>(7).fill(0);
  const weekdayCount = new Array<number>(7).fill(0);
  for (const t of ownRows) {
    const d = dayOf(t.ts as Instant);
    byDay.set(d, (byDay.get(d) ?? 0) + (t.amount ?? 0));
    const w = weekdayIndex(d);
    byWeekday[w]! += t.amount ?? 0;
    weekdayCount[w]! += 1;
  }
  const last = cycle.periodEnd < today ? cycle.periodEnd : today;
  const series: { day: Day; total: number }[] = [];
  for (let d: Day = cycle.cycleStart; d <= last; d = addDays(d, 1)) {
    series.push({ day: d, total: round2(byDay.get(d) ?? 0) });
  }
  const busiest = series.reduce<{ day: Day; total: number } | null>(
    (best, s) => (s.total > (best?.total ?? 0) ? s : best), null,
  );

  const weekdays: Breakdown[] = WEEKDAYS.map((name, i) => ({
    key: name,
    total: round2(byWeekday[i]!),
    count: weekdayCount[i]!,
    share: own > 0 ? byWeekday[i]! / own : 0,
  }));

  const largest = [...a.chargeRows]
    .filter((t) => t.cardDirection === 'debt+')
    .sort((x, y) => (y.amount ?? 0) - (x.amount ?? 0))
    .slice(0, 8)
    .map((t: Transaction) => ({
      id: t.id,
      ts: t.ts as Instant,
      remarks: (t.remarks ?? '').trim(),
      category: t.category,
      amount: t.amount ?? 0,
      lent: t.kind === 'credit_given',
    }));

  // --- Unlinked returns ------------------------------------------------------
  const unlinked: UnlinkedReturn[] = ledger.unattached
    .slice(0, 12)
    .map((u) => ({ id: u.id, ts: u.ts, amount: u.amount, source: u.source, note: u.note }));

  // --- The last few statements, and this one against the one before ---------
  const windowOf = (c: Cycle) => analyseCard(snap, card.name, c.cycleStart, c.periodEnd);
  const recent: StatementSummaryRow[] = history
    .slice(at, at + RECENT)
    .map((h) => {
      const x = h === row ? a : windowOf(h.cycle);
      const l = x.byKind.find((k) => k.kind === 'credit_given')?.total ?? 0;
      return {
        statementEnd: h.cycle.statementEnd,
        charges: x.charges.total,
        own: x.spend.total,
        lent: round2(l),
        closing: h.closing,
      };
    })
    .reverse();

  let versus: StatementReport['versus'] = null;
  if (older) {
    const p = windowOf(older.cycle);
    const before = new Map(p.byCategory.map((c) => [c.key, c.total]));
    const keys = new Set([...a.byCategory.slice(0, 6).map((c) => c.key), ...p.byCategory.slice(0, 3).map((c) => c.key)]);
    versus = {
      previous: older.cycle.statementEnd,
      charges: p.charges.total,
      own: p.spend.total,
      lent: round2(p.byKind.find((k) => k.kind === 'credit_given')?.total ?? 0),
      closing: older.closing,
      categories: [...keys]
        .map((key) => ({ key, now: a.byCategory.find((c) => c.key === key)?.total ?? 0, before: before.get(key) ?? 0 }))
        .sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before))
        .slice(0, 6),
    };
  }

  return {
    card: card.name,
    statements: history.map((h) => ({ statementEnd: h.cycle.statementEnd, label: shortMonth(h.cycle.statementEnd) })),
    cycle,
    bill: {
      opening: row.opening,
      charges: row.spends,
      payments: row.payments,
      closing: row.closing,
      bank: row.bank ? { due: row.bank.due, diff: row.bank.diff.due } : null,
      unpaid,
      paidInFull: unpaid < 0.005,
    },
    parts: { own, lent, other },
    lentSplit: { returned, waiting },
    categories: a.byCategory,
    tags: byTag(ownRows),
    largest,
    days: {
      series,
      count: series.length,
      spendingDays: series.filter((s) => s.total > 0).length,
      perDay: series.length ? round2(own / series.length) : 0,
      busiest,
    },
    weekdays,
    people,
    unlinked,
    recent,
    versus,
  };
}

/**
 * What a return of `amount` would settle, in the order the credit ledger
 * settles things: the person's oldest unpaid lending first. Shown BEFORE
 * anything is saved, because paying back "the new one" while an older one is
 * open settles the older one — and a person should see that, not find it out.
 *
 * Whatever is left after every open lending is cleared is `extra`: more than
 * they owed, which the ledger does not treat as a debt of yours.
 */
export function planReturn(
  queue: { txId: string; ts: Instant; remarks: string; outstanding: number }[],
  amount: number,
): { lines: (typeof queue[number] & { apply: number; full: boolean })[]; extra: number } {
  let left = Math.round(amount * 100);
  const lines: { txId: string; ts: Instant; remarks: string; outstanding: number; apply: number; full: boolean }[] = [];
  for (const q of queue) {
    if (left <= 0) break;
    const owed = Math.round(q.outstanding * 100);
    const apply = Math.min(left, owed);
    left -= apply;
    lines.push({ ...q, apply: apply / 100, full: apply >= owed });
  }
  return { lines, extra: left / 100 };
}
