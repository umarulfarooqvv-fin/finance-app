import { daysInMonth, type Day } from '@/lib/time';

/* ===========================================================================
   Reading a bank or credit-card statement that was pasted in as text.

   The paste comes from wherever the user got it — a PDF copied by hand, or a
   model asked to pull the rows out of one. So the shape is not known in
   advance, and the parser has to cope with markdown tables, CSV, TSV and
   plain columns without being told which it is.

   ONE RULE ABOVE ALL: A LINE IS EITHER UNDERSTOOD OR REPORTED, NEVER GUESSED.
   Every line that does not yield a date and an amount comes back in
   `skipped`, visible on screen. A statement reconciler that silently dropped
   a row would report "nothing unexpected" precisely when something was.

   Ambiguous dates are the other trap. 05/06/2026 is the 5th of June in India
   and the 6th of May in the United States, and a model transcribing a
   statement may emit either. The order is therefore a setting, defaulting to
   day-first, and the count of lines that were genuinely ambiguous is
   surfaced so the choice can be checked rather than assumed.
   =========================================================================== */

export type Direction = 'debit' | 'credit';

export type StatementLine = {
  /** 1-based position in the pasted text, so a row can be found again. */
  line: number;
  raw: string;
  day: Day;
  description: string;
  /** Always positive; `direction` carries the sign. */
  amount: number;
  direction: Direction;
  /** True when the date could have been read either way round. */
  ambiguousDate: boolean;
};

export type ParseResult = {
  lines: StatementLine[];
  /** Lines that could not be read, with the reason. Shown, never discarded. */
  skipped: { line: number; raw: string; why: string }[];
  ambiguousDates: number;
};

export type ParseOptions = {
  /** How to read 05/06/2026. Indian statements are day-first. */
  dateOrder?: 'dmy' | 'mdy';
  /** Used when a line carries no year, e.g. "12 Aug". */
  assumeYear?: number;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): boolean {
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function makeDay(y: number, m: number, d: number): Day | null {
  return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Two digits of year, the way statements print them. */
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

type FoundDate = { day: Day; ambiguous: boolean; consumed: string };

/** Pull the first thing that looks like a date out of a line. */
export function findDate(text: string, opts: ParseOptions): FoundDate | null {
  // ISO first: unambiguous, and what a model most often emits.
  const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    const day = makeDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (day) return { day, ambiguous: false, consumed: iso[0] };
  }

  // "12 Aug 2026", "12-Aug-26", "12 August"
  const named = text.match(/\b(\d{1,2})[\s-]*([A-Za-z]{3,9})\.?[\s,-]*(\d{2,4})?\b/);
  if (named) {
    const m = MONTHS[(named[2] ?? '').toLowerCase()];
    if (m) {
      const y = named[3] ? fullYear(Number(named[3])) : opts.assumeYear;
      if (y) {
        const day = makeDay(y, m, Number(named[1]));
        if (day) return { day, ambiguous: false, consumed: named[0] };
      }
    }
  }

  // "Aug 12, 2026"
  const namedFirst = text.match(/\b([A-Za-z]{3,9})\.?[\s-]+(\d{1,2})[\s,-]*(\d{2,4})?\b/);
  if (namedFirst) {
    const m = MONTHS[(namedFirst[1] ?? '').toLowerCase()];
    if (m) {
      const y = namedFirst[3] ? fullYear(Number(namedFirst[3])) : opts.assumeYear;
      if (y) {
        const day = makeDay(y, m, Number(namedFirst[2]));
        if (day) return { day, ambiguous: false, consumed: namedFirst[0] };
      }
    }
  }

  // Numeric: 12/08/2026, 12-08-26, and the ambiguous ones.
  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = fullYear(Number(numeric[3]));
    const order = opts.dateOrder ?? 'dmy';

    /* Only genuinely ambiguous when BOTH could be a month. When one is past
       the 12th the reading is forced, whatever the setting says. */
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    const first = order === 'dmy' ? makeDay(y, b, a) : makeDay(y, a, b);
    const fallback = order === 'dmy' ? makeDay(y, a, b) : makeDay(y, b, a);
    const day = first ?? fallback;
    if (day) return { day, ambiguous: ambiguous && first !== null, consumed: numeric[0] };
  }

  return null;
}

/* An amount on its own, which is what a statement's amount COLUMN contains.
   Anchored at both ends deliberately: a number buried in a description is not
   an amount, and scanning a whole line for digits read "APPLE INDIA EMI 18/24"
   as a charge of 18. */
const AMOUNT_CELL =
  /^[\s\u20b9]*(?:rs\.?|inr)?\s*(-?)(\(?)([\d,]+(?:\.\d{1,2})?)(\)?)\s*(dr|cr|db)?\.?\s*$/i;

/** Loose scan, used only when a line has no column structure at all. */
const AMOUNT_ANYWHERE = /(?:\u20b9|rs\.?|inr)?\s*-?\(?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\)?|(?:\u20b9|rs\.?|inr)\s*-?\(?\d+(?:\.\d{1,2})?\)?|-?\(?\d+\.\d{2}\)?/gi;

export type FoundAmount = { amount: number; direction: Direction; consumed: string };

function readAmountCell(cell: string): { amount: number; credit: boolean } | null {
  const m = cell.match(AMOUNT_CELL);
  if (!m) return null;
  const n = Number((m[3] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const credit = m[1] === '-' || m[2] === '(' || (m[5] ?? '').toLowerCase() === 'cr';
  return { amount: Math.abs(Math.round(n * 100) / 100), credit };
}

/** Split a row into columns, however the paste happens to delimit them. */
export function splitCells(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((c) => c.trim());
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  if (line.includes(',') && !/\d,\d{2,3}\b/.test(line.replace(/\.\d+/g, ''))) {
    // Commas only delimit when they are not the thousands separators.
    return line.split(',').map((c) => c.trim());
  }
  return [line.trim()];
}

const CREDIT_WORDS = /\b(?:refund|reversal|payment\s+received|repayment|cashback|received|credited)\b/i;

const HEADER_WORDS = /\b(date|description|particulars|narration|amount|debit|credit|balance|transaction)\b/gi;

/* A header row, as opposed to a line that merely mentions one of these words:
   at least TWO of them and no digits anywhere. One keyword was too loose — it
   swallowed any unreadable line containing "amount", and a line the parser
   cannot read has to be reported, not quietly treated as furniture. */
function looksLikeHeader(text: string): boolean {
  if (/\d/.test(text)) return false;
  const hits = new Set((text.match(HEADER_WORDS) ?? []).map((w) => w.toLowerCase()));
  return hits.size >= 2;
}

/* ---------------------------------------------------------------------------
   The summary box is not unreadable, it is simply not a transaction.

   The paste now carries it deliberately — it is where the balance check comes
   from — and its three lines have no date, so without this every paste would
   report "3 lines could not be read" about the part it was asked for. A
   warning that fires on correct input trains the reader to ignore the one that
   matters.
   --------------------------------------------------------------------------- */

const SUMMARY_LABEL =
  /previous\s+balance|opening\s+balance|purchases?\s*\/?\s*charges?|cash\s+advances?|payments?\s*\/?\s*credits?|total\s+amount\s+due|total\s+due|amount\s+payable|statement\s+summary|minimum\s+amount/i;

/** Only amounts, separators and currency marks — the row under a label line. */
const AMOUNTS_ONLY = /^[\s₹rs.,|\d()+-]*$/i;

function isSummaryLine(text: string, prevWasSummary: boolean): boolean {
  if (SUMMARY_LABEL.test(text)) return true;
  // The amounts belonging to a label line directly above, which on their own
  // would be indistinguishable from a malformed transaction.
  return prevWasSummary && text.trim() !== '' && AMOUNTS_ONLY.test(text);
}

/* ===========================================================================
   Statements that put one transaction across several lines.

   A real Rupay statement prints each row as three:

       06 Aug 26
       03:53 pm
       VODAFONE IDEA LIMITED Rs. 179.00

   Read line by line every one of those fails on its own — the first has a date
   and no amount, the other two have no date at all — so a whole statement
   parsed to nothing and reported 88 unreadable lines. The pieces have to be
   stitched back together before anything else looks at them.

   The rule is narrow on purpose: a line carrying a DATE BUT NO AMOUNT may
   absorb the following lines until one supplies an amount, and it stops at the
   first line that starts a new record or after three tries. Anything greedier
   would swallow a genuinely unreadable row into its neighbour, which is the
   one outcome worse than reporting it.
   =========================================================================== */

/** Would the main parser find an amount on this line? */
function hasAmount(text: string): boolean {
  const cells = splitCells(text).filter((c) => c !== '');
  if (cells.some((c) => readAmountCell(c) !== null)) return true;
  return [...text.matchAll(AMOUNT_ANYWHERE)].some((m) => /\d/.test(m[0]));
}

const tidy = (raw: string) => raw.trim().replace(/^\||\|$/g, '').trim();

type LogicalRow = { line: number; raw: string; text: string };

/** Fold wrapped rows into one logical row each, keeping the original line number. */
export function joinWrappedRows(rawLines: string[], opts: ParseOptions): LogicalRow[] {
  const out: LogicalRow[] = [];

  for (let i = 0; i < rawLines.length; ) {
    const trimmed = tidy(rawLines[i] ?? '');
    if (!trimmed || /^[\s|:-]+$/.test(trimmed)) { i++; continue; }

    const startsRecord = findDate(trimmed, opts) !== null;

    if (startsRecord && !hasAmount(trimmed)) {
      const parts = [trimmed];
      let j = i + 1;
      let complete = false;

      while (j < rawLines.length && parts.length <= 3) {
        const next = tidy(rawLines[j] ?? '');
        if (!next) { j++; continue; }
        // A line with its own date is the next transaction, not a continuation.
        if (findDate(next, opts) !== null) break;
        parts.push(next);
        j++;
        if (hasAmount(next)) { complete = true; break; }
      }

      if (complete) {
        out.push({ line: i + 1, raw: parts.join(' '), text: parts.join('  ') });
        i = j;
        continue;
      }
      // Nothing completed it — report the original line as it stands.
    }

    out.push({ line: i + 1, raw: trimmed, text: trimmed });
    i++;
  }

  return out;
}

export function parseStatement(text: string, opts: ParseOptions = {}): ParseResult {
  const out: StatementLine[] = [];
  const skipped: ParseResult['skipped'] = [];
  // Whether the previous line was part of the summary box, so the amounts
  // row beneath its labels is recognised as belonging to it.
  let inSummary = false;
  let ambiguousDates = 0;

  joinWrappedRows(text.split(/\r?\n/), opts).forEach((row) => {
    const { line } = row;
    const trimmed = row.text;
    const rawLine = row.raw;

    const cells = splitCells(trimmed).filter((c) => c !== '');
    const flat = cells.join('  ');

    const date = findDate(flat, opts);
    if (!date) {
      if (looksLikeHeader(flat)) return;
      if (isSummaryLine(flat, inSummary)) { inSummary = true; return; }
      inSummary = false;
      skipped.push({ line, raw: rawLine, why: 'no date found' });
      return;
    }

    /* Amounts come from CELLS, never from scanning the text. Statements print
       a running balance after the movement, so when several columns are pure
       amounts the FIRST is the transaction and the rest is the balance. */
    const amountCells: { index: number; value: { amount: number; credit: boolean } }[] = [];
    cells.forEach((c, idx) => {
      if (date.consumed && c.includes(date.consumed)) return;
      const v = readAmountCell(c);
      if (v) amountCells.push({ index: idx, value: v });
    });

    let found: { amount: number; credit: boolean } | null = null;
    let usedIndex = -1;
    /* The token the loose scan consumed. When a row has no column structure the
       amount sits inside the same cell as the merchant name, so the description
       has to have that exact text removed or it reads
       "VODAFONE IDEA LIMITED Rs. 179.00". */
    let usedToken = '';

    if (amountCells.length > 0) {
      found = amountCells[0]!.value;
      usedIndex = amountCells[0]!.index;
    } else {
      /* No column structure at all, e.g. "2026-08-12 SHOP 100". Prefer a token
         that is unmistakably money — grouped, or carrying two decimals — and
         only then fall back to the LAST bare number on the line. Scanning for
         any number anywhere read "APPLE INDIA EMI 18/24" as a charge of 18. */
      const rest = flat.replace(date.consumed, ' ');
      const moneyish = [...rest.matchAll(AMOUNT_ANYWHERE)].map((m) => m[0].trim()).filter((t) => /\d/.test(t));
      const token =
        moneyish[0] ??
        rest.trim().split(/\s+/).filter((t) => /^[\u20b9]?-?\(?\d+(?:\.\d{1,2})?\)?$/.test(t)).pop();
      if (token) {
        const n = Number(token.replace(/[\u20b9,()\s]|rs\.?|inr/gi, ''));
        if (Number.isFinite(n)) {
          found = { amount: Math.abs(Math.round(n * 100) / 100), credit: token.startsWith('-') || token.includes('(') };
          usedToken = token;
        }
      }
    }

    if (found === null) {
      skipped.push({ line, raw: rawLine, why: 'no amount found' });
      return;
    }
    if (found.amount === 0) {
      skipped.push({ line, raw: rawLine, why: 'amount is zero' });
      return;
    }
    const amount = found.amount;
    const credit = found.credit;

    /* Drop the cell the date came out of — but only when the date is ALL it
       held. A row with no column structure at all is a single cell holding the
       date, the merchant and the amount together, and testing for "contains
       the date" threw that whole cell away, leaving every such row with a
       blank description. The date is stripped from what survives a few lines
       below anyway, which is what makes keeping the cell safe.

       This is the shape an assistant hands back when asked to transcribe a
       statement — "21/08/2026 ANTHROPIC* CLAUDE SUB 2,312.16", single spaces
       throughout — so it is not an edge case, it is the common one. */
    const withoutDate = (c: string) =>
      date.consumed ? c.split(date.consumed).join(' ').trim() : c.trim();

    const description = cells
      .filter((c, idx) => idx !== usedIndex && withoutDate(c) !== '' && readAmountCell(c) === null)
      .join(' ')
      .replace(new RegExp(date.consumed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
      .replace(
        usedToken ? new RegExp(usedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /(?!)/g,
        ' ',
      )
      // The currency word left behind once its number is gone.
      .replace(/\b(?:rs|inr)\b\.?/gi, ' ')
      .replace(/\b(?:dr|cr|db)\b\.?/gi, ' ')
      /* A statement that wraps its rows puts the transaction TIME on its own
         line, which ends up glued to the front of the description once the
         row is stitched back together. It is not part of the merchant name. */
      .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,|-]+|[\s,|-]+$/g, '')
      .trim();

    const direction: Direction = credit || CREDIT_WORDS.test(flat) ? 'credit' : 'debit';
    if (date.ambiguous) ambiguousDates++;

    out.push({
      line,
      raw: rawLine,
      day: date.day,
      description,
      amount,
      direction,
      ambiguousDate: date.ambiguous,
    });
  });

  return { lines: out, skipped, ambiguousDates };
}

/* ===========================================================================
   The four figures in a statement's summary box.

   Matching lines against entries answers "is every charge accounted for". It
   cannot answer "is the balance right", because a wrong balance is inherited
   from an EARLIER cycle — the lines of this one all match and the total is
   still out. That is exactly how 106.40 rode along on a Coral bill for seven
   months: every line reconciled, the opening balance did not.

   Banks print the answer at the top of every statement:

     Previous Balance   Purchases/Charges   Cash Advances   Payments/Credits
        2,962.72            6,842.25            0.00           2,962.72

   Reading it turns four separate comparisons into one glance, and the FIRST
   month where the opening balance disagrees is the month the error entered.

   Labels vary by bank, so matching is on the words that carry meaning rather
   than an exact phrase, and the amounts may follow either on the same line or
   on the next — the layout differs between a PDF copy and a screenshot
   transcription. A block that does not yield all four is no block: half a
   summary silently compared against a full one is worse than none.
   =========================================================================== */

export type StatementSummary = {
  previousBalance: number;
  charges: number;
  payments: number;
  /** What the bank says is owed. Usually previous + charges - payments, but it
      is taken from the statement rather than derived, because a fee the app
      cannot see would make the derivation quietly wrong. */
  totalDue: number;
};

const LABELS: Record<keyof StatementSummary, RegExp> = {
  previousBalance: /previous\s+balance|opening\s+balance|balance\s+b\/?f/i,
  charges: /purchases?\s*\/?\s*charges?|new\s+spends?|total\s+spends?|debits?/i,
  payments: /payments?\s*\/?\s*credits?|payments?\s+received|credits?/i,
  totalDue: /total\s+amount\s+due|total\s+due|closing\s+balance|amount\s+payable/i,
};

/** Every amount on a line, in order, ignoring currency marks and separators. */
function amountsOn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:^|[^\d.])(\d[\d,]*\.\d{2}|\d[\d,]{2,})(?![\d.])/g)) {
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function parseStatementSummary(text: string): StatementSummary | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found: Partial<StatementSummary> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    /* A label line carrying several labels is the header of a table whose
       amounts are on the row beneath — the common PDF layout. Read them
       positionally, in the order the labels appear, so "Cash Advances" in the
       middle consumes its own column instead of shifting the rest. */
    const here = (Object.keys(LABELS) as (keyof StatementSummary)[])
      .map((k) => ({ k, at: line.search(LABELS[k]) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at);

    if (here.length >= 2) {
      const cash = /cash\s+advances?/i.test(line) ? line.search(/cash\s+advances?/i) : -1;
      const cols = [...here.map((x) => ({ k: x.k as keyof StatementSummary | null, at: x.at }))];
      if (cash >= 0) cols.push({ k: null, at: cash });
      cols.sort((a, b) => a.at - b.at);

      const nums = amountsOn(line).length >= cols.length
        ? amountsOn(line)
        : amountsOn(lines[i + 1] ?? '');
      if (nums.length >= cols.length) {
        cols.forEach((c, n) => { if (c.k && found[c.k] === undefined) found[c.k] = nums[n]!; });
        continue;
      }
    }

    // One label, its amount on the same line or the next.
    for (const k of Object.keys(LABELS) as (keyof StatementSummary)[]) {
      if (found[k] !== undefined || !LABELS[k].test(line)) continue;
      const n = amountsOn(line)[0] ?? amountsOn(lines[i + 1] ?? '')[0];
      if (n !== undefined) found[k] = n;
    }
  }

  const complete =
    found.previousBalance !== undefined && found.charges !== undefined &&
    found.payments !== undefined && found.totalDue !== undefined;
  return complete ? (found as StatementSummary) : null;
}
