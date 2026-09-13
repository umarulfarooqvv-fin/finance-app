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

export function parseStatement(text: string, opts: ParseOptions = {}): ParseResult {
  const out: StatementLine[] = [];
  const skipped: ParseResult['skipped'] = [];
  let ambiguousDates = 0;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1;
    const trimmed = rawLine.trim().replace(/^\||\|$/g, '').trim();
    if (!trimmed) return;
    if (/^[\s|:-]+$/.test(trimmed)) return; // a markdown rule

    const cells = splitCells(trimmed).filter((c) => c !== '');
    const flat = cells.join('  ');

    const date = findDate(flat, opts);
    if (!date) {
      if (looksLikeHeader(flat)) return;
      skipped.push({ line, raw: rawLine.trim(), why: 'no date found' });
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
        }
      }
    }

    if (found === null) {
      skipped.push({ line, raw: rawLine.trim(), why: 'no amount found' });
      return;
    }
    if (found.amount === 0) {
      skipped.push({ line, raw: rawLine.trim(), why: 'amount is zero' });
      return;
    }
    const amount = found.amount;
    const credit = found.credit;

    const description = cells
      .filter((c, idx) => idx !== usedIndex && !(date.consumed && c.includes(date.consumed)) && readAmountCell(c) === null)
      .join(' ')
      .replace(new RegExp(date.consumed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
      .replace(/\b(?:dr|cr|db)\b\.?/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,|-]+|[\s,|-]+$/g, '')
      .trim();

    const direction: Direction = credit || CREDIT_WORDS.test(flat) ? 'credit' : 'debit';
    if (date.ambiguous) ambiguousDates++;

    out.push({
      line,
      raw: rawLine.trim(),
      day: date.day,
      description,
      amount,
      direction,
      ambiguousDate: date.ambiguous,
    });
  });

  return { lines: out, skipped, ambiguousDates };
}
