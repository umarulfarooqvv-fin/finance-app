import { dayOf, type Day, type Instant } from './time.ts';
import type { CardName, Income, Snapshot, Transaction } from './types.ts';

/* ===========================================================================
   Credit Given ledger (spec §3.6) — money Farooq fronted for other people.

   v2 grouped these rows by person but tracked repayment only as a manual
   status flag, so the "excluding credit" columns on the statement fell back to
   an approximation: subtract every credit-given charge in the window, repaid
   or not. That overstates the exclusion the moment somebody pays you back.

   This version allocates repayments against individual lendings, oldest first,
   which yields the one number the statement actually needs: for each lending,
   how much of it is still outstanding. Excluding exactly that amount makes the
   "excl. credit" columns true rather than approximate.

   FIFO is the right default: when somebody hands back money without saying
   which loan it settles, the oldest debt is the one being cleared.
   =========================================================================== */

export type Lending = {
  txId: string;
  person: string;
  ts: Instant;
  amount: number;
  /** Card the lending was charged to, when it was put on a card. */
  card: CardName | null;
  repaid: number;
  outstanding: number;
};

export type Repayment = {
  id: string;
  person: string;
  ts: Instant;
  amount: number;
  /** Where the money came back through, for the audit trail. */
  via: 'income' | 'transaction' | 'manual';
  note: string;
};

export type PersonLedger = {
  person: string;
  given: number;
  repaid: number;
  outstanding: number;
  lendings: Lending[];
  repayments: Repayment[];
  lastActivity: Instant | null;
  settled: boolean;
};

export type CreditLedger = {
  people: PersonLedger[];
  totalGiven: number;
  totalRepaid: number;
  totalOutstanding: number;
  /** Still-unrepaid lending charged to each card — what the statement excludes. */
  outstandingByCard: Record<string, number>;
  /** Per-lending outstanding, keyed by transaction id. */
  outstandingByTx: Record<string, number>;
};

/** Manual overrides stored in app_config: reassigns a row to a named person. */
export type CreditConfig = {
  /** txId -> canonical person name, when the parsed name was wrong. */
  assign?: Record<string, string>;
  /** Repayments recorded by hand, for cash that never hit an account. */
  manual?: { id: string; person: string; ts: Instant; amount: number; note?: string }[];
  /** Person names to treat as the same ledger, e.g. ["Ashiq", "Ashiq sudu"]. */
  aliases?: Record<string, string>;
};

/** Fold a name to a comparison key: case, punctuation and spacing insensitive. */
export function personKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonical(name: string, aliases: Record<string, string>): string {
  const key = personKey(name);
  for (const [from, to] of Object.entries(aliases)) {
    if (personKey(from) === key) return to;
  }
  return name.trim();
}

/** Does this income row look like somebody paying Farooq back? */
function isCreditReturn(row: Income): boolean {
  const hay = `${row.source ?? ''} ${row.remarks ?? ''}`;
  return /credit\s*(return|back|repay)|repay|returned|paid\s*back|settle/i.test(hay);
}

/**
 * Build the ledger. Pure: everything it needs arrives in `snapshot`.
 * `asOf` bounds the ledger in time so the net-worth trend can reconstruct what
 * was outstanding at the end of any past month.
 */
export function creditLedger(snapshot: Snapshot, asOf?: Instant): CreditLedger {
  const cfg = (snapshot.config['credit_status'] as CreditConfig | undefined) ?? {};
  const aliases = cfg.aliases ?? {};
  const assign = cfg.assign ?? {};
  const within = (ts: Instant | null): ts is Instant => ts !== null && (!asOf || ts <= asOf);

  // --- Lendings ------------------------------------------------------------
  const lendings: Lending[] = [];
  for (const t of snapshot.transactions) {
    if (t.deleted || t.kind !== 'credit_given') continue;
    if (!within(t.ts) || t.amount == null || t.amount <= 0) continue;
    const named = assign[t.id] ?? t.tags.person ?? 'Unassigned';
    lendings.push({
      txId: t.id,
      person: canonical(named, aliases),
      ts: t.ts,
      amount: t.amount,
      card: t.cardAffected,
      repaid: 0,
      outstanding: t.amount,
    });
  }

  // --- Repayments ----------------------------------------------------------
  const repayments: Repayment[] = [];

  for (const inc of snapshot.income) {
    if (inc.deleted || !within(inc.ts) || inc.amount == null || inc.amount <= 0) continue;
    if (!isCreditReturn(inc)) continue;
    const who = matchPerson(`${inc.source} ${inc.remarks}`, lendings, aliases);
    if (!who) continue;
    repayments.push({
      id: inc.id, person: who, ts: inc.ts, amount: inc.amount,
      via: 'income', note: inc.remarks || inc.source,
    });
  }

  for (const t of snapshot.transactions) {
    if (t.deleted || !within(t.ts) || t.amount == null || t.amount <= 0) continue;
    // A "Credit Return" category row is money coming back in.
    if (t.category !== 'Credit Return') continue;
    const who = matchPerson(t.remarks, lendings, aliases);
    if (!who) continue;
    repayments.push({
      id: t.id, person: who, ts: t.ts, amount: t.amount,
      via: 'transaction', note: t.remarks,
    });
  }

  for (const man of cfg.manual ?? []) {
    if (!within(man.ts) || !(man.amount > 0)) continue;
    repayments.push({
      id: man.id, person: canonical(man.person, aliases), ts: man.ts,
      amount: man.amount, via: 'manual', note: man.note ?? 'Recorded by hand',
    });
  }

  // --- Allocate, oldest lending first --------------------------------------
  const byPerson = new Map<string, PersonLedger>();
  const ledgerFor = (person: string): PersonLedger => {
    const key = personKey(person);
    let l = byPerson.get(key);
    if (!l) {
      l = { person, given: 0, repaid: 0, outstanding: 0, lendings: [], repayments: [], lastActivity: null, settled: false };
      byPerson.set(key, l);
    }
    return l;
  };

  for (const l of lendings.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))) {
    ledgerFor(l.person).lendings.push(l);
  }
  for (const r of repayments.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))) {
    ledgerFor(r.person).repayments.push(r);
  }

  for (const l of byPerson.values()) {
    let pool = l.repayments.reduce((a, r) => a + r.amount, 0);
    for (const lending of l.lendings) {
      const applied = Math.min(pool, lending.amount);
      lending.repaid = applied;
      lending.outstanding = round2(lending.amount - applied);
      pool -= applied;
    }
    l.given = round2(l.lendings.reduce((a, x) => a + x.amount, 0));
    l.repaid = round2(l.repayments.reduce((a, x) => a + x.amount, 0));
    // Repayments beyond what was lent leave the balance at zero, not negative:
    // the surplus is a gift or a mis-tagged row, never a debt Farooq owes.
    l.outstanding = round2(Math.max(0, l.given - l.repaid));
    l.settled = l.outstanding <= 0.005;
    const stamps = [...l.lendings.map((x) => x.ts), ...l.repayments.map((x) => x.ts)].sort();
    l.lastActivity = stamps.length ? (stamps[stamps.length - 1] as Instant) : null;
  }

  const people = [...byPerson.values()].sort((a, b) => b.outstanding - a.outstanding || a.person.localeCompare(b.person));

  const outstandingByCard: Record<string, number> = {};
  const outstandingByTx: Record<string, number> = {};
  for (const l of people) {
    for (const lending of l.lendings) {
      outstandingByTx[lending.txId] = lending.outstanding;
      if (lending.card && lending.outstanding > 0) {
        outstandingByCard[lending.card] = round2((outstandingByCard[lending.card] ?? 0) + lending.outstanding);
      }
    }
  }

  return {
    people,
    totalGiven: round2(people.reduce((a, p) => a + p.given, 0)),
    totalRepaid: round2(people.reduce((a, p) => a + p.repaid, 0)),
    totalOutstanding: round2(people.reduce((a, p) => a + p.outstanding, 0)),
    outstandingByCard,
    outstandingByTx,
  };
}

/**
 * Find which debtor a repayment refers to by looking for a known name in the
 * text. Longest name first, so "Ashiq sudu" wins over a bare "Ashiq".
 */
function matchPerson(text: string, lendings: Lending[], aliases: Record<string, string>): string | null {
  const hay = personKey(text ?? '');
  if (!hay) return null;
  const names = [...new Set(lendings.map((l) => l.person))].sort((a, b) => b.length - a.length);
  for (const n of names) {
    const key = personKey(n);
    if (key.length >= 3 && hay.includes(key)) return canonical(n, aliases);
  }
  return null;
}

/** Total still owed to Farooq on a given day — used by the net-worth trend. */
export function creditOutstandingAt(snapshot: Snapshot, day: Day): number {
  return creditLedger(snapshot, `${day}T23:59:59`).totalOutstanding;
}

export function creditDayOf(ts: Instant): Day {
  return dayOf(ts);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { Transaction };
