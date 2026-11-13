import { round2 } from '@/lib/analytics';
import { matchesGroup } from '@/lib/family';
import type { Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   Splitting costs with friends — /splits.

   A SPLIT is one occasion: a trip, a dinner out. Anyone in it may pay for
   something; each expense is shared EQUALLY among the people it was for
   (everyone, unless only some of them ate). At the end it says who pays whom,
   in as few payments as possible, and each one is ticked off as it is paid.

   The owner's payments are entries in this ledger: picked one by one
   (`include` — usually the Credit Given entries he logs when he pays for the
   group first), or found by the split's tag or words (lib/family's
   matchesGroup — "Banglore Trip" finds every entry tagged with it). A
   friend's are typed in. One that matched by mistake can be left out.

   Settling up, each payment owed is either RECEIVED (the friend paid) or
   WRITTEN OFF (it will not come back — the owner's loss). Both close it; the
   page adds up what was recovered and what was lost.

   Stored as `splits` in app_config. NOTHING HERE CHANGES THE LEDGER: what
   the owner paid for the group stays a spend in his own accounts, and money a
   friend pays back is recorded here only.

   Pure: snapshot + splits in, balances and transfers out.
   =========================================================================== */

export const SPLITS_KEY = 'splits';
export const ME = 'me';

export type SplitPerson = { id: string; name: string };

export type SplitExpense = {
  id: string;
  payer: string;
  amount: number;
  day: Day;
  note?: string;
  /** Who it was for; everyone in the split when absent. */
  among?: string[];
};

/** Settling up: `from` paid `to` — or, written off, `to` gave up on it. */
export type SplitSettlement = {
  id: string; from: string; to: string; amount: number; day: Day;
  /** 'writeoff': never paid; it closes the debt and counts as a loss. */
  kind?: 'paid' | 'writeoff';
};

export type Split = {
  id: string;
  name: string;
  /** When it started — new splits are listed first. */
  day: Day;
  /** The friends; the owner is always in, as `me`. */
  people: SplitPerson[];
  /** Tags or words that pull the owner's entries in. */
  match: string[];
  expenses: SplitExpense[];
  settlements: SplitSettlement[];
  /** The owner's entries picked into it one by one, e.g. Credit Given ones. */
  include?: string[];
  /** The owner's entries that matched but are not part of it. */
  exclude?: string[];
};

export type SplitRow = {
  id: string;
  payer: string;
  amount: number;
  day: Day;
  note: string;
  among: string[];
  from: 'ledger' | 'typed';
};

export type SplitBalance = { person: string; paid: number; share: number; settled: number; balance: number };
export type Transfer = { from: string; to: string; amount: number };

export type SplitView = {
  split: Split;
  people: SplitPerson[];
  rows: SplitRow[];
  total: number;
  balances: SplitBalance[];
  /** What is left to pay, fewest payments first. */
  transfers: Transfer[];
  /** The owner's balance: above zero he gets money back, below he owes. */
  mine: number;
  /** Paid back to the owner, and written off by him — his loss. */
  recovered: number;
  lost: number;
};

const isDay = (v: unknown): v is Day => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** The stored splits, cleaned. */
export function splitsFrom(config: Record<string, unknown>): Split[] {
  const raw = config[SPLITS_KEY];
  if (!Array.isArray(raw)) return [];
  const out: Split[] = [];
  for (const s of raw) {
    const o = (s ?? {}) as Record<string, unknown>;
    if (!str(o['id']) || !str(o['name']) || !isDay(o['day'])) continue;
    const people = (Array.isArray(o['people']) ? o['people'] : [])
      .map((p) => ({ id: str((p as Record<string, unknown>)?.['id']), name: str((p as Record<string, unknown>)?.['name']) }))
      .filter((p) => p.id && p.name && p.id !== ME);
    const ids = new Set([ME, ...people.map((p) => p.id)]);
    const expenses: SplitExpense[] = [];
    for (const e of Array.isArray(o['expenses']) ? o['expenses'] : []) {
      const x = (e ?? {}) as Record<string, unknown>;
      const amount = Number(x['amount']);
      if (!str(x['id']) || !ids.has(str(x['payer'])) || !(amount > 0) || !isDay(x['day'])) continue;
      const among = strs(x['among']).filter((p) => ids.has(p));
      expenses.push({
        id: str(x['id']), payer: str(x['payer']), amount, day: x['day'],
        ...(str(x['note']) ? { note: str(x['note']) } : {}),
        ...(among.length ? { among } : {}),
      });
    }
    const settlements: SplitSettlement[] = [];
    for (const e of Array.isArray(o['settlements']) ? o['settlements'] : []) {
      const x = (e ?? {}) as Record<string, unknown>;
      const amount = Number(x['amount']);
      if (!str(x['id']) || !ids.has(str(x['from'])) || !ids.has(str(x['to'])) || !(amount > 0) || !isDay(x['day'])) continue;
      settlements.push({
        id: str(x['id']), from: str(x['from']), to: str(x['to']), amount, day: x['day'],
        ...(x['kind'] === 'writeoff' ? { kind: 'writeoff' as const } : {}),
      });
    }
    out.push({
      id: str(o['id']), name: str(o['name']), day: o['day'], people, match: strs(o['match']),
      expenses, settlements, include: strs(o['include']), exclude: strs(o['exclude']),
    });
  }
  return out;
}

/**
 * The fewest payments that settle everyone: the one who owes most pays the
 * one owed most, as much as both allow, until nobody is owed. Amounts under
 * half a rupee are left — not worth a payment.
 */
export function settleUp(balances: { person: string; balance: number }[]): Transfer[] {
  const owe = balances.filter((b) => b.balance < -0.005).map((b) => ({ p: b.person, v: -b.balance }));
  const get = balances.filter((b) => b.balance > 0.005).map((b) => ({ p: b.person, v: b.balance }));
  const out: Transfer[] = [];
  while (owe.length && get.length) {
    owe.sort((a, b) => b.v - a.v);
    get.sort((a, b) => b.v - a.v);
    const a = owe[0]!;
    const b = get[0]!;
    const amount = round2(Math.min(a.v, b.v));
    if (amount >= 0.5) out.push({ from: a.p, to: b.p, amount });
    a.v = round2(a.v - amount);
    b.v = round2(b.v - amount);
    if (a.v < 0.005) owe.shift();
    if (b.v < 0.005) get.shift();
  }
  return out;
}

export function splitView(snap: Snapshot, split: Split): SplitView {
  const people: SplitPerson[] = [{ id: ME, name: 'You' }, ...split.people];
  const everyone = people.map((p) => p.id);
  const excluded = new Set(split.exclude ?? []);
  const rows: SplitRow[] = [];

  const picked = new Set(split.include ?? []);
  if (split.match.length || picked.size) {
    for (const t of snap.transactions) {
      if (t.deleted || !t.ts || t.amount == null || excluded.has(t.id)) continue;
      if (!picked.has(t.id) && !(split.match.length && matchesGroup(t, split))) continue;
      rows.push({ id: t.id, payer: ME, amount: t.amount, day: t.ts.slice(0, 10), note: t.remarks || t.category, among: everyone, from: 'ledger' });
    }
  }
  for (const e of split.expenses) {
    rows.push({ id: e.id, payer: e.payer, amount: e.amount, day: e.day, note: e.note ?? '', among: e.among?.length ? e.among : everyone, from: 'typed' });
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const paid = new Map(everyone.map((p) => [p, 0]));
  const share = new Map(everyone.map((p) => [p, 0]));
  const settled = new Map(everyone.map((p) => [p, 0]));
  for (const r of rows) {
    paid.set(r.payer, (paid.get(r.payer) ?? 0) + r.amount);
    const part = r.amount / r.among.length;
    for (const p of r.among) share.set(p, (share.get(p) ?? 0) + part);
  }
  // Paying back counts like paying: the one who paid is owed less, the one paid is owed less too.
  for (const s of split.settlements) {
    settled.set(s.from, (settled.get(s.from) ?? 0) + s.amount);
    settled.set(s.to, (settled.get(s.to) ?? 0) - s.amount);
  }

  const balances = everyone.map((p) => {
    const pd = round2(paid.get(p) ?? 0);
    const sh = round2(share.get(p) ?? 0);
    const st = round2(settled.get(p) ?? 0);
    return { person: p, paid: pd, share: sh, settled: st, balance: round2(pd - sh + st) };
  });
  const toMe = (kind: 'paid' | 'writeoff') => round2(split.settlements
    .filter((x) => x.to === ME && (x.kind ?? 'paid') === kind)
    .reduce((sum, x) => sum + x.amount, 0));
  return {
    split, people, rows,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    balances,
    transfers: settleUp(balances),
    mine: balances.find((b) => b.person === ME)?.balance ?? 0,
    recovered: toMe('paid'),
    lost: toMe('writeoff'),
  };
}

/** Every entry already in some split — picked, or found by a tag — so it is not offered twice. */
export function entriesInSplits(snap: Snapshot, splits: Split[]): Set<string> {
  const out = new Set<string>();
  for (const s of splits) {
    for (const id of s.include ?? []) out.add(id);
    if (!s.match.length) continue;
    const excluded = new Set(s.exclude ?? []);
    for (const t of snap.transactions) if (!t.deleted && !excluded.has(t.id) && matchesGroup(t, s)) out.add(t.id);
  }
  return out;
}
