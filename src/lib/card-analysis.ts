import { byCategory, isSpend, round2, type Breakdown } from '@/lib/analytics';
import { creditLedger } from '@/lib/credit';
import { foldForSearch } from '@/lib/search-text';
import { endOfDay, monthKey, startOfDay, type Day } from '@/lib/time';
import type { Snapshot, Transaction, TxKind } from '@/lib/types';

/* ===========================================================================
   What a card was actually used for.

   The card page answers "what do I owe". This answers the different question
   underneath it: where did those charges GO, and is any of it coming back.

   THE SPLIT THAT MATTERS MOST is between spending and lending. A card can be
   at its limit entirely on money that is owed back, and a page that totals
   both together tells its owner they overspent when they did not. The kind
   breakdown leads for exactly that reason, and the category breakdown counts
   spend ONLY — the app's definition of spend, which already excludes bill
   payments, lending and transfers into savings.

   Nothing here is a new definition. Categories come from analytics, repayment
   from the credit ledger's FIFO allocation. A second opinion about how much
   was lent would be a second answer to a question that already has one.
   =========================================================================== */

export type KindShare = Breakdown & { kind: TxKind };

export type CardCreditPerson = {
  person: string;
  given: number;
  repaid: number;
  outstanding: number;
  settled: boolean;
};

export type RepeatCharge = {
  name: string;
  count: number;
  total: number;
  /** Mean per occurrence, which is what a subscription is recognised by. */
  each: number;
};

export type CardAnalysis = {
  card: string;
  from: Day;
  to: Day;
  /** Every charge that raised the balance, whatever it was for. */
  charges: { total: number; count: number };
  /** Payments and refunds that lowered it. */
  repaid: { total: number; count: number };
  /** Charges split by what kind of thing they were. */
  byKind: KindShare[];
  /** Consumption only, by category. */
  spend: { total: number; count: number };
  byCategory: Breakdown[];
  /** Biggest charges first — the question "what is this balance made of". */
  largest: Transaction[];
  /** What the card itself cost: its surcharges and the tax on them. */
  cost: { surcharge: number; taxes: number; total: number; share: number };
  /** Lending charged to THIS card, and whether it has come back. */
  credit: {
    given: number;
    repaid: number;
    outstanding: number;
    people: CardCreditPerson[];
  };
  /** Month by month, so a trend is visible rather than inferred. */
  monthly: { month: string; spend: number; lent: number; charges: number }[];
  /** Charges that recur under the same description. */
  repeats: RepeatCharge[];
};

const KIND_LABEL: Record<TxKind, string> = {
  spend: 'Spending',
  credit_given: 'Lent to others',
  investment: 'Savings & investment',
  emi: 'Instalments',
  card_payment: 'Bill payment',
  unknown: 'Needs review',
};

export function kindLabel(kind: TxKind): string {
  return KIND_LABEL[kind] ?? kind;
}

const LARGEST = 12;
const REPEATS = 10;
/** A description has to appear at least this often to be a pattern. */
const REPEAT_MIN = 2;

export function analyseCard(
  snapshot: Snapshot,
  card: string,
  from: Day,
  to: Day,
): CardAnalysis {
  const lo = startOfDay(from);
  const hi = endOfDay(to);

  const onCard = snapshot.transactions.filter(
    (t) => !t.deleted && t.ts && t.amount != null && t.cardAffected === card && t.ts >= lo && t.ts <= hi,
  );

  const charges = onCard.filter((t) => t.cardDirection === 'debt+');
  const credits = onCard.filter((t) => t.cardDirection === 'debt-');

  const chargeTotal = round2(charges.reduce((a, t) => a + (t.amount ?? 0), 0));

  /* Kind shares are measured against CHARGES, not against everything on the
     card. Including the bill payment would put "Bill payment 48%" at the top
     of a list meant to say where the money went. */
  const kindSums = new Map<TxKind, { total: number; count: number }>();
  for (const t of charges) {
    const cur = kindSums.get(t.kind) ?? { total: 0, count: 0 };
    cur.total += t.amount ?? 0;
    cur.count += 1;
    kindSums.set(t.kind, cur);
  }
  const byKind: KindShare[] = [...kindSums.entries()]
    .map(([kind, v]) => ({
      kind,
      key: kindLabel(kind),
      total: round2(v.total),
      count: v.count,
      share: chargeTotal > 0 ? v.total / chargeTotal : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const spendRows = charges.filter(isSpend);
  const spendTotal = round2(spendRows.reduce((a, t) => a + (t.amount ?? 0), 0));

  const sumOf = (cat: string) =>
    round2(charges.filter((t) => t.category === cat).reduce((a, t) => a + (t.amount ?? 0), 0));
  const surcharge = sumOf('Surcharge');
  const taxes = sumOf('Taxes');

  /* Lending is read from the ledger rather than re-summed here, so "still
     owed" means the same thing on this page as on the Ledgers page. A lending
     is attributed to the card it was CHARGED to. */
  const ledger = creditLedger(snapshot);
  const people: CardCreditPerson[] = [];
  for (const p of ledger.people) {
    const mine = p.lendings.filter((l) => l.card === card && l.ts >= lo && l.ts <= hi);
    if (mine.length === 0) continue;
    const given = round2(mine.reduce((a, l) => a + l.amount, 0));
    const out = round2(mine.reduce((a, l) => a + l.outstanding, 0));
    people.push({
      person: p.person,
      given,
      repaid: round2(given - out),
      outstanding: out,
      settled: out < 0.005,
    });
  }
  people.sort((a, b) => b.outstanding - a.outstanding || b.given - a.given);

  const creditGiven = round2(people.reduce((a, p) => a + p.given, 0));
  const creditOut = round2(people.reduce((a, p) => a + p.outstanding, 0));

  /* Month by month. Built from a map rather than a date walk so a card with a
     gap in its history has no phantom zero months in the middle — and so the
     series cannot disagree with the totals above it. */
  const months = new Map<string, { spend: number; lent: number; charges: number }>();
  for (const t of charges) {
    const m = monthKey(t.ts!);
    const cur = months.get(m) ?? { spend: 0, lent: 0, charges: 0 };
    cur.charges += t.amount ?? 0;
    if (t.kind === 'spend') cur.spend += t.amount ?? 0;
    if (t.kind === 'credit_given') cur.lent += t.amount ?? 0;
    months.set(m, cur);
  }
  const monthly = [...months.entries()]
    .map(([month, v]) => ({
      month,
      spend: round2(v.spend),
      lent: round2(v.lent),
      charges: round2(v.charges),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  /* Descriptions that come back. Folded so a curled apostrophe or a changed
     capital does not split one pattern into two. An instalment is left out:
     "Ipad Mini 18/24" and "19/24" are the same commitment under different
     names, and the EMI tracker already groups them properly. */
  const repeatSums = new Map<string, { name: string; count: number; total: number }>();
  for (const t of charges) {
    if (t.tags.emi) continue;
    const name = (t.remarks ?? '').trim();
    if (!name) continue;
    const key = foldForSearch(name);
    const cur = repeatSums.get(key) ?? { name, count: 0, total: 0 };
    cur.name = name;
    cur.count += 1;
    cur.total += t.amount ?? 0;
    repeatSums.set(key, cur);
  }
  const repeats = [...repeatSums.values()]
    .filter((r) => r.count >= REPEAT_MIN)
    .map((r) => ({ name: r.name, count: r.count, total: round2(r.total), each: round2(r.total / r.count) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, REPEATS);

  return {
    card,
    from,
    to,
    charges: { total: chargeTotal, count: charges.length },
    repaid: {
      total: round2(credits.reduce((a, t) => a + (t.amount ?? 0), 0)),
      count: credits.length,
    },
    byKind,
    spend: { total: spendTotal, count: spendRows.length },
    byCategory: byCategory(spendRows),
    largest: [...charges].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, LARGEST),
    cost: {
      surcharge,
      taxes,
      total: round2(surcharge + taxes),
      share: chargeTotal > 0 ? (surcharge + taxes) / chargeTotal : 0,
    },
    credit: { given: creditGiven, repaid: round2(creditGiven - creditOut), outstanding: creditOut, people },
    monthly,
    repeats,
  };
}
