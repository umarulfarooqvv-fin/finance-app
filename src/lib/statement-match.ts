import { daysBetween, type Day, type Instant } from '@/lib/time';
import { round2 } from '@/lib/money';
import type { Direction, StatementLine } from '@/lib/statement-parse';

/* ===========================================================================
   Matching a pasted statement against what the app recorded.

   The question this answers is "did the bank charge me anything I did not
   record?", so the output that matters most is the one nobody wants: the
   statement lines with no entry behind them.

   The hard part is that the two sides are not a row-for-row list. One app
   entry is often two real charges typed in together — a meal and its tip, a
   fuel fill and its surcharge — while the bank prints them separately. And
   the reverse happens too. So matching runs in passes, widest evidence first:

     1. EXACT      same day, same amount, same direction
     2. NEAR       same amount, within a few days - banks post late
     3. GROUPED    several on one side summing to one on the other

   Every pass only accepts a pairing that is UNIQUE IN BOTH DIRECTIONS. Where
   two candidates fit equally well the rows are left unmatched and reported as
   ambiguous, because a wrong pairing here does not merely look untidy: it
   hides a real bank charge behind a coincidence of amounts, which is the one
   error this whole page exists to catch.
   =========================================================================== */

export type AppEntry = {
  id: string;
  ts: Instant;
  day: Day;
  amount: number;
  description: string;
  direction: Direction;
  verified: boolean;
};

export type MatchKind = 'exact' | 'near' | 'grouped';

export type Match = {
  kind: MatchKind;
  statement: StatementLine[];
  app: AppEntry[];
  total: number;
  /** Largest gap in days between a statement row and an app row. */
  dayGap: number;
};

export type Reconciliation = {
  matches: Match[];
  /** On the statement, nothing in the app. The bank charged something extra. */
  statementOnly: StatementLine[];
  /** In the app, nothing on the statement. Recorded but never charged. */
  appOnly: AppEntry[];
  /** Rows where more than one pairing fitted equally well. */
  ambiguous: { statement: StatementLine[]; app: AppEntry[] }[];
  totals: {
    statementDebit: number;
    statementCredit: number;
    appDebit: number;
    appCredit: number;
    /** statement − app, by direction. Non-zero is the thing to explain. */
    debitDifference: number;
    creditDifference: number;
  };
};

export type MatchOptions = {
  /** How many days a bank may post a transaction late. */
  tolerance?: number;
  /** Largest number of rows that may be combined on either side. */
  maxGroup?: number;
};

const paise = (n: number) => Math.round(n * 100);

export function reconcileStatement(
  lines: StatementLine[],
  entries: AppEntry[],
  opts: MatchOptions = {},
): Reconciliation {
  const tolerance = opts.tolerance ?? 4;
  const maxGroup = Math.max(2, Math.min(opts.maxGroup ?? 3, 5));

  const openLines = new Set(lines);
  const openEntries = new Set(entries);
  const matches: Match[] = [];
  const ambiguous: Reconciliation['ambiguous'] = [];

  const gap = (a: Day, b: Day) => Math.abs(daysBetween(a, b));

  /* --- Pass 1 and 2: one to one --------------------------------------- */
  for (const window of [0, tolerance]) {
    for (const line of [...openLines]) {
      if (!openLines.has(line)) continue;
      const fits = [...openEntries].filter(
        (e) =>
          e.direction === line.direction &&
          paise(e.amount) === paise(line.amount) &&
          gap(e.day, line.day) <= window,
      );
      if (fits.length === 0) continue;

      /* On the same day, candidates with the same amount and direction are
         interchangeable — two genuine 15-rupee teas on one afternoon is a real
         thing, and they must pair off one for one rather than both being
         refused for looking alike.

         Once dates differ that stops being true: one candidate three days
         before and another three days after are different rows, and choosing
         between them would be a coin toss. So a tie is only fatal when the
         window is wider than the day itself. */
      let chosen: AppEntry;
      if (window === 0) {
        chosen = fits[0]!;
      } else {
        const best = fits.length === 1 ? fits[0]! : nearest(fits, line.day, gap);
        if (best === null) continue;
        chosen = best;

        // And the entry must not be equally claimable by another statement row.
        const competing = [...openLines].filter(
          (l) =>
            l !== line &&
            l.direction === chosen.direction &&
            paise(l.amount) === paise(chosen.amount) &&
            gap(chosen.day, l.day) < gap(chosen.day, line.day),
        );
        if (competing.length > 0) continue;
      }

      openLines.delete(line);
      openEntries.delete(chosen);
      matches.push({
        kind: window === 0 ? 'exact' : 'near',
        statement: [line],
        app: [chosen],
        total: round2(line.amount),
        dayGap: gap(chosen.day, line.day),
      });
    }
  }

  /* --- Pass 3: several on one side summing to one on the other --------- */

  // Many app entries -> one statement line (the app merged what the bank split
  // apart is the other direction; this is the bank splitting what was typed in
  // as one).
  groupPass(
    [...openLines],
    () => [...openEntries],
    (line) => line,
    (e) => e,
    (line, group) => {
      openLines.delete(line);
      for (const e of group) openEntries.delete(e);
      matches.push({
        kind: 'grouped',
        statement: [line],
        app: group,
        total: round2(line.amount),
        dayGap: Math.max(...group.map((e) => gap(e.day, line.day))),
      });
    },
    (line, groups) => ambiguous.push({ statement: [line], app: groups.flat() }),
    tolerance, maxGroup, gap,
  );

  // One app entry -> many statement lines (two charges typed in as one).
  groupPass(
    [...openEntries],
    () => [...openLines],
    (e) => e,
    (line) => line,
    (entry, group) => {
      openEntries.delete(entry);
      for (const l of group) openLines.delete(l);
      matches.push({
        kind: 'grouped',
        statement: group,
        app: [entry],
        total: round2(entry.amount),
        dayGap: Math.max(...group.map((l) => gap(l.day, entry.day))),
      });
    },
    (entry, groups) => ambiguous.push({ statement: groups.flat(), app: [entry] }),
    tolerance, maxGroup, gap,
  );

  const statementOnly = [...openLines].sort((a, b) => (a.day < b.day ? -1 : 1));
  const appOnly = [...openEntries].sort((a, b) => (a.day < b.day ? -1 : 1));

  const sum = (xs: { amount: number; direction: Direction }[], d: Direction) =>
    round2(xs.filter((x) => x.direction === d).reduce((a, x) => a + x.amount, 0));

  const statementDebit = sum(lines, 'debit');
  const statementCredit = sum(lines, 'credit');
  const appDebit = sum(entries, 'debit');
  const appCredit = sum(entries, 'credit');

  return {
    matches: matches.sort((a, b) => (a.statement[0]!.day < b.statement[0]!.day ? -1 : 1)),
    statementOnly,
    appOnly,
    ambiguous,
    totals: {
      statementDebit, statementCredit, appDebit, appCredit,
      debitDifference: round2(statementDebit - appDebit),
      creditDifference: round2(statementCredit - appCredit),
    },
  };
}

/** The single closest candidate, or null when two are equally close. */
function nearest<T extends { day: Day }>(
  candidates: T[],
  to: Day,
  gap: (a: Day, b: Day) => number,
): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  let tied = false;
  for (const c of candidates) {
    const g = gap(c.day, to);
    if (g < bestGap) { best = c; bestGap = g; tied = false; }
    else if (g === bestGap) tied = true;
  }
  return tied ? null : best;
}

/**
 * For each item on one side, look for a combination on the other side that
 * sums to it exactly. Accepts only when exactly one combination fits.
 */
function groupPass<A extends { day: Day; amount: number; direction: Direction },
                   B extends { day: Day; amount: number; direction: Direction }>(
  targets: A[],
  pool: () => B[],
  _ta: (a: A) => A,
  _tb: (b: B) => B,
  accept: (target: A, group: B[]) => void,
  report: (target: A, groups: B[][]) => void,
  tolerance: number,
  maxGroup: number,
  gap: (a: Day, b: Day) => number,
): void {
  for (const target of targets) {
    const candidates = pool().filter(
      (c) => c.direction === target.direction && gap(c.day, target.day) <= tolerance,
    );
    if (candidates.length < 2) continue;

    const found = subsetsSummingTo(candidates, paise(target.amount), maxGroup);
    if (found.length === 1) accept(target, found[0]!);
    else if (found.length > 1) report(target, found);
  }
}

/** Every combination of 2..maxSize items whose amounts sum exactly to `goal`. */
export function subsetsSummingTo<T extends { amount: number }>(
  items: T[],
  goal: number,
  maxSize: number,
): T[][] {
  const out: T[][] = [];
  const current: T[] = [];

  const walk = (start: number, remaining: number) => {
    // Bail early: more than a handful of answers means the data cannot
    // distinguish them, and enumerating the rest helps nobody.
    if (out.length > 4) return;
    if (current.length >= 2 && remaining === 0) { out.push([...current]); return; }
    if (current.length >= maxSize || remaining < 0) return;
    for (let i = start; i < items.length; i++) {
      const item = items[i]!;
      current.push(item);
      walk(i + 1, remaining - paise(item.amount));
      current.pop();
    }
  };

  walk(0, goal);
  return out;
}

/* ===========================================================================
   Reading a statement line for what it IS, not just what it costs.

   An unmatched line has two very different meanings. "SWIGGY 450" with no
   entry behind it is a purchase somebody forgot to log. "ANNUAL MEMBERSHIP
   FEE 590" with no entry behind it is the bank charging for something, and
   that is the line worth arguing about.

   Both are unmatched; only one is a finding. So the unmatched list is split
   by what the description says it is, rather than being left as one pile to
   read through.
   =========================================================================== */

export type ChargeKind = 'fee' | 'tax' | 'interest' | 'emi' | 'reversal' | null;

export type ChargeFlag = { kind: Exclude<ChargeKind, null>; label: string };

/* Ordered: the first pattern that matches wins.

   Reversal leads, because it INVERTS everything after it — "REVERSAL OF LATE
   FEE" and "ANNUAL FEE WAIVED" are the bank giving money back, and reading
   either as a fee would list a refund among the charges to dispute.

   Tax comes next, so "GST ON LATE FEE" reads as tax rather than fee: the tax
   is the part the bank added on top, and which half is which matters. */
const CHARGE_PATTERNS: { kind: Exclude<ChargeKind, null>; label: string; re: RegExp }[] = [
  {
    kind: 'reversal',
    label: 'Reversal',
    re: /\b(?:reversal|revers\w*|refund\w*|cashback|waiver|waived|credited\s*back)\b/i,
  },
  { kind: 'tax', label: 'Tax', re: /\b(?:i?gst|cgst|sgst|utgst|service\s*tax|vat|cess)\b/i },
  { kind: 'interest', label: 'Interest', re: /\b(?:interest|finance\s*charge|revolv\w*|carry\s*forward)\b/i },
  {
    kind: 'fee',
    label: 'Fee',
    re: /\b(?:annual|joining|renewal|membership|late\s*(?:payment|fee)|over\s*limit|overlimit|cash\s*advance|convenience|processing|handling|surcharge|markup|mark-?up|penalt\w*|charge[sd]?|fee[s]?)\b/i,
  },
  { kind: 'emi', label: 'EMI', re: /\b(?:emi|instal?ment|instalment)\b/i },
];

/** What kind of line this is, judged from its description. Null = ordinary spend. */
export function chargeFlag(description: string): ChargeFlag | null {
  const text = description ?? '';
  for (const p of CHARGE_PATTERNS) {
    if (p.re.test(text)) return { kind: p.kind, label: p.label };
  }
  return null;
}

/** True for the kinds that mean "the bank added this", not "you bought this". */
export function isBankCharge(description: string): boolean {
  const flag = chargeFlag(description);
  return flag !== null && flag.kind !== 'emi' && flag.kind !== 'reversal';
}

/* ===========================================================================
   Suggesting what an unmatched line might pair with.

   Automatic matching deliberately refuses anything it is not certain of. That
   leaves a pile the person has to resolve by hand, and hunting for "which of
   these forty rows adds up to 2,620.20" is the tedious part. These are the
   candidates worth looking at first — ranked, with the reason stated, so the
   suggestion can be judged rather than trusted.
   =========================================================================== */

export type Suggestion = {
  app: AppEntry[];
  /** Summed amount of the suggested side. */
  total: number;
  /** statement amount − suggested total. Zero means it reconciles exactly. */
  difference: number;
  /** Days between the statement line and the nearest entry suggested. */
  dayGap: number;
  reason: string;
};

/**
 * Candidates for one unmatched statement line, best first.
 *
 * Looks for an exact single match first, then combinations that sum to it,
 * then near-misses — a near-miss is worth showing because a 2-rupee gap
 * usually means a rounding difference or a tip, not a different transaction.
 */
export function suggestFor(
  line: StatementLine,
  candidates: AppEntry[],
  opts: { tolerance?: number; maxGroup?: number; limit?: number } = {},
): Suggestion[] {
  const tolerance = opts.tolerance ?? 7;
  const maxGroup = Math.max(2, Math.min(opts.maxGroup ?? 3, 4));
  const limit = opts.limit ?? 5;

  const gap = (e: AppEntry) => Math.abs(daysBetween(e.day, line.day));
  const inWindow = candidates.filter((e) => e.direction === line.direction && gap(e) <= tolerance);
  const target = paise(line.amount);
  const out: Suggestion[] = [];

  // 1. One entry, exactly the same amount.
  for (const e of inWindow) {
    if (paise(e.amount) === target) {
      out.push({
        app: [e], total: round2(e.amount), difference: 0, dayGap: gap(e),
        reason: gap(e) === 0 ? 'same amount, same day' : `same amount, ${gap(e)}d apart`,
      });
    }
  }

  // 2. Several entries summing to it — the split case.
  for (const group of subsetsSummingTo(inWindow, target, maxGroup)) {
    out.push({
      app: group,
      total: round2(group.reduce((a, e) => a + e.amount, 0)),
      difference: 0,
      dayGap: Math.max(...group.map(gap)),
      reason: `${group.length} entries adding up exactly`,
    });
  }

  /* 3. Near misses, but only when nothing exact was found. Offering a
        2-rupee-off row beside a perfect match would invite the wrong pick. */
  if (out.length === 0) {
    const near = inWindow
      .map((e) => ({ e, diff: round2(line.amount - e.amount) }))
      .filter((x) => Math.abs(x.diff) > 0 && Math.abs(x.diff) <= Math.max(5, line.amount * 0.02))
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));

    for (const { e, diff } of near) {
      out.push({
        app: [e], total: round2(e.amount), difference: diff, dayGap: gap(e),
        reason: `${diff > 0 ? 'short by' : 'over by'} ${Math.abs(diff).toFixed(2)}`,
      });
    }
  }

  // Closest in time first among equally exact answers; fewer rows beats more.
  return out
    .sort((a, b) =>
      Math.abs(a.difference) - Math.abs(b.difference) ||
      a.app.length - b.app.length ||
      a.dayGap - b.dayGap)
    .slice(0, limit);
}

/* ===========================================================================
   Which rows could be a spend that actually happened on this card.

   Used to build the "paid with something else" list: everything in the cycle
   window that is not on this card, and could plausibly be moved onto it.

   Pure and separately tested because two of the three clauses are easy to get
   wrong in a way nothing else would catch.
   =========================================================================== */

export type CandidateRow = {
  method: string;
  /** The card whose balance this row moves, if any. */
  cardAffected: string | null;
  kind: string;
};

export function couldBelongToCard(row: CandidateRow, card: string): boolean {
  // Already on the card. Nothing to correct.
  if (row.method === card) return false;

  /* Already counted against this card even though it was paid from somewhere
     else — paying THIS card's bill from Fi is the case. Such a row is in the
     card's own entry list, so admitting it here would put one id in two
     columns at once and offer a move onto the card it already belongs to. */
  if (row.cardAffected === card) return false;

  /* A bill payment is not a purchase. Re-filing "Coral's bill, paid from Fi"
     onto Edge would not fix a misfiled spend; it would assert that Edge paid
     Coral's bill. These are few — five in the live 6 Sep window — and large,
     68,456.03 of the 183,495.53 that would otherwise be listed, so leaving
     them in quietly wrecks the total shown beside the list. */
  if (row.kind === 'card_payment') return false;

  return true;
}
