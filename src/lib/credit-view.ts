import type { CreditLedger } from '@/lib/credit';
import { foldForSearch } from '@/lib/search-text';
import type { Instant } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   Credit given, searchable — by person or by what the money was for.

   The ledger (lib/credit) answers "who owes me"; this answers the question
   asked of it in practice: "how much have I lent Ashiq, and for what?", or
   "how much went on other people's food, and how much came back?". Each
   lending carries its own FIFO-allocated repaid/outstanding, so a search on a
   DESCRIPTION can total exactly the lendings it matched — not the whole
   person's balance.

   Pure: the ledger and the snapshot in, plain rows out, so the page can ship
   them to the client and filter as you type.
   =========================================================================== */

export type CreditEntry = {
  id: string;
  ts: Instant;
  amount: number;
  repaid: number;
  outstanding: number;
  /** What it was for — the remarks as entered. */
  remarks: string;
  /** Paid from: a card or an account. */
  method: string;
};

export type CreditBack = { id: string; ts: Instant; amount: number; note: string };

export type CreditPerson = {
  person: string;
  entries: CreditEntry[];
  repayments: CreditBack[];
};

export type CreditTotals = { count: number; lent: number; back: number; outstanding: number };

export type CreditGroup = {
  /** A person's name, or a description. */
  label: string;
  /** People in the group — one for a person, any number for a description. */
  people: string[];
  entries: (CreditEntry & { person: string })[];
  repayments: (CreditBack & { person: string })[];
  totals: CreditTotals;
  last: Instant | null;
};

export type CreditStatus = 'open' | 'all';
export type CreditGroupBy = 'person' | 'description';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function creditPeople(ledger: CreditLedger, snap: Snapshot): CreditPerson[] {
  const tx = new Map(snap.transactions.map((t) => [t.id, t]));
  return ledger.people.map((p) => ({
    person: p.person,
    entries: p.lendings.map((l) => {
      const t = tx.get(l.txId);
      return {
        id: l.txId, ts: l.ts, amount: l.amount, repaid: r2(l.repaid), outstanding: l.outstanding,
        remarks: t?.remarks?.trim() ?? '', method: t?.method ?? '',
      };
    }),
    repayments: p.repayments.map((x) => ({ id: x.id, ts: x.ts, amount: x.amount, note: x.note })),
  }));
}

/**
 * A description as a grouping key: case and spacing folded, a "[Tag]" dropped,
 * so "Food for Ashiq" and "food for ashiq " are one line.
 */
export function describe(remarks: string): string {
  return remarks.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() || '(no description)';
}

/**
 * Filter and group.
 *
 * A query that matches a PERSON keeps everything of theirs. Otherwise it keeps
 * the lendings whose description matches (and repayments whose note does), so
 * "food" totals what was lent for food across everyone.
 *
 * Totals: `back` is what came back against the kept lendings — the part of
 * each one the ledger has settled — so lent − back = outstanding holds for
 * every group, person or description alike.
 */
export function viewCredit(
  people: CreditPerson[],
  opts: { q?: string; status?: CreditStatus; groupBy?: CreditGroupBy },
): { groups: CreditGroup[]; totals: CreditTotals } {
  const q = foldForSearch(opts.q ?? '');
  const status = opts.status ?? 'open';
  const groupBy = opts.groupBy ?? 'person';

  const kept: { person: string; entries: CreditEntry[]; repayments: CreditBack[] }[] = [];
  for (const p of people) {
    const whole = !q || foldForSearch(p.person).includes(q);
    let entries = whole ? p.entries : p.entries.filter((e) => foldForSearch(e.remarks).includes(q));
    const repayments = whole ? p.repayments : p.repayments.filter((x) => foldForSearch(x.note).includes(q));
    if (status === 'open') entries = entries.filter((e) => e.outstanding > 0.005);
    if (entries.length === 0) continue;
    kept.push({ person: p.person, entries, repayments: status === 'open' && !whole ? [] : repayments });
  }

  const groups = new Map<string, CreditGroup>();
  const groupFor = (key: string, label: string): CreditGroup => {
    let g = groups.get(key);
    if (!g) {
      g = { label, people: [], entries: [], repayments: [], totals: { count: 0, lent: 0, back: 0, outstanding: 0 }, last: null };
      groups.set(key, g);
    }
    return g;
  };

  for (const p of kept) {
    if (groupBy === 'person') {
      const g = groupFor(p.person, p.person);
      g.people.push(p.person);
      g.entries.push(...p.entries.map((e) => ({ ...e, person: p.person })));
      g.repayments.push(...p.repayments.map((x) => ({ ...x, person: p.person })));
    } else {
      for (const e of p.entries) {
        const label = describe(e.remarks);
        const g = groupFor(foldForSearch(label), label);
        if (!g.people.includes(p.person)) g.people.push(p.person);
        g.entries.push({ ...e, person: p.person });
      }
    }
  }

  const all: CreditTotals = { count: 0, lent: 0, back: 0, outstanding: 0 };
  for (const g of groups.values()) {
    for (const e of g.entries) {
      g.totals.count += 1;
      g.totals.lent += e.amount;
      g.totals.back += e.repaid;
      g.totals.outstanding += e.outstanding;
    }
    g.totals = { count: g.totals.count, lent: r2(g.totals.lent), back: r2(g.totals.back), outstanding: r2(g.totals.outstanding) };
    // Newest first inside a group, for reading by day.
    g.entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    g.repayments.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const stamps = [...g.entries.map((e) => e.ts), ...g.repayments.map((x) => x.ts)].sort();
    g.last = stamps.length ? (stamps[stamps.length - 1] as Instant) : null;
    all.count += g.totals.count;
    all.lent += g.totals.lent;
    all.back += g.totals.back;
    all.outstanding += g.totals.outstanding;
  }

  return {
    groups: [...groups.values()],
    totals: { count: all.count, lent: r2(all.lent), back: r2(all.back), outstanding: r2(all.outstanding) },
  };
}
