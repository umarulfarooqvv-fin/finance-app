import { splitTags } from '@/lib/user-tags';
import { evaluateAmount } from '@/lib/calc';
import { foldForSearch } from '@/lib/search-text';
import { ALL_CATEGORIES, INCOME_SOURCES, isCard } from '@/lib/types';
import { isGpayStatement, parseGpayStatement } from '@/lib/gpay-statement';
import { isFederalStatement, parseFederalStatement, readBankRow, regularNeftSenders } from '@/lib/bank-statement';
import { resolveMethod, type BankMethods } from '@/lib/bank-methods';
import type { Day } from '@/lib/time';

/* ===========================================================================
   Reading a pasted batch of entries.

   The shape is the one lib/csv already uses for the archive —
   date | amount | method | category | description — so this app has one row
   shape rather than two that have to be remembered apart.

   NOTHING IS EVER DROPPED. A line that cannot be read comes back in `skipped`
   with the reason, and a line that reads but is incomplete comes back as a row
   with `issues` on it. Silently losing a line loses money, and a batch that
   quietly imports nineteen of twenty rows is worse than one that refuses:
   the missing row is discovered months later, if at all.

   A METHOD OR CATEGORY IT CANNOT MATCH IS LEFT EMPTY rather than guessed at.
   The table that follows makes the person fill it, which is the same rule the
   voice parser and the statement drafts already follow.
   =========================================================================== */

export type ImportIssue = 'no-method' | 'no-category' | 'unknown-method' | 'unknown-category';

export type ImportRow = {
  /** 1-based line in the pasted text, so a row can be found again. */
  line: number;
  /**
   * out — money spent: a transaction, method = what paid, category = what for.
   * in  — money received: INCOME, method = the account it landed in, category
   *       = the income source ("Credit Return", "Salary"…), or blank.
   */
  direction: 'out' | 'in';
  /** A reference the source printed — a UPI transaction id — so the same
      payment imported twice resolves to the same entry. */
  ref: string | null;
  /** Left unticked by default, with this reason: money between the owner's
      own accounts, which is neither spending nor income. */
  skip?: string | null;
  /** One line of explanation shown under the row. */
  hint?: string | null;
  raw: string;
  day: Day;
  /** "HH:MM:SS" when the date column carried a time, else null — and the
      caller supplies its usual noon. A payment screen prints "3:11 PM", and
      the moment a charge happened decides which statement it is on when it
      lands on a bill date. */
  time: string | null;
  amount: number;
  method: string;
  /** The method column exactly as written — "Federal CC XX16" — before it
      was resolved to one of this app's names. */
  methodRaw: string;
  category: string;
  /** The description, without its tags. */
  remarks: string;
  /** "[Banglore Trip]" written in the description — see lib/user-tags. */
  tags: string[];
  /** What still needs a person. Empty means ready to save. */
  issues: ImportIssue[];
};

export type ImportSkip = { line: number; raw: string; why: string };

export type ImportParse = {
  rows: ImportRow[];
  skipped: ImportSkip[];
};

/* Pipes first, because the prompt asks for them and a description may itself
   contain a comma. Tabs next, for a spreadsheet paste. Two-or-more spaces
   last, for text copied out of a PDF — a single space is not a separator,
   because descriptions have spaces in them. */
function splitFields(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((c) => c.trim());
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  return line.split(/\s{2,}/).map((c) => c.trim());
}

const DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$|^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/i;

/** "15:11", "3:11 PM", "03.11pm", "15:11:07" → "HH:MM:SS". Null if not a time. */
function toTime(text: string): string | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const twelve = m[4] !== undefined;
  let h = Number(twelve ? m[1] : m[5]);
  const min = Number(twelve ? m[2] : m[6]);
  const sec = Number((twelve ? m[3] : m[7]) ?? 0);
  if (twelve) {
    if (h < 1 || h > 12) return null;
    const pm = m[4]!.toLowerCase() === 'p';
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return `${pad(h)}:${pad(min)}:${pad(sec)}`;
}

/** The date column, split into its date and an optional time after it. */
function splitDateTime(text: string): { date: string; time: string } {
  const t = text.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})[T\s]+(.+)$/.exec(t);
  if (iso) return { date: iso[1]!, time: iso[2]! };
  const [date = '', ...rest] = t.split(/\s+/);
  return { date, time: rest.join(' ') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A real calendar day, or null. Rejects 31 Feb rather than rolling it over. */
function toDay(text: string, dateOrder: 'dmy' | 'mdy'): Day | null {
  const t = text.trim();

  const iso = ISO.exec(t);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const m = DATE.exec(t);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  const [day, month] = dateOrder === 'dmy' ? [a, b] : [b, a];
  return valid(year, month, day);
}

function valid(y: number, m: number, d: number): Day | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rolling 31 Feb into 3 March would date an entry in the wrong month and
  // therefore on the wrong statement.
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Match a method or category loosely, so casing and punctuation do not matter. */
function match(value: string, allowed: readonly string[]): string | null {
  const q = foldForSearch(value);
  if (!q) return null;
  return allowed.find((a) => foldForSearch(a) === q) ?? null;
}

export function parseImport(
  text: string,
  opts: { dateOrder?: 'dmy' | 'mdy'; bankMethods?: BankMethods } = {},
): ImportParse {
  const dateOrder = opts.dateOrder ?? 'dmy';
  const bankMethods = opts.bankMethods ?? {};
  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];

  // A Google Pay statement (the PDF, or its text copied out) has its own
  // layout, and carries the direction and the UPI id a summary loses.
  if (isGpayStatement(text)) return fromGpay(text, bankMethods);
  // A bank's own account statement: every transaction on one account.
  if (isFederalStatement(text)) return fromFederal(text, bankMethods);

  splitRecords(text).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') return;

    const fields = splitFields(trimmed);
    if (fields.length < 2) {
      skipped.push({ line, raw, why: 'not enough columns' });
      return;
    }

    const [dateRaw = '', amountRaw = '', methodRaw = '', categoryRaw = '', ...rest] = fields;

    /* A header the assistant added anyway, or a spreadsheet's own. Detected by
       the date column failing AND the word looking like a label, so a genuine
       unreadable date is still reported rather than silently treated as
       furniture. */
    if (/^(date|day|timestamp)$/i.test(dateRaw)) return;

    const when = splitDateTime(dateRaw);
    const day = toDay(when.date, dateOrder);
    // A time that cannot be read costs the time, not the row: it falls back to
    // the caller's noon exactly as if none had been given.
    const time = when.time ? toTime(when.time) : null;
    if (!day) {
      skipped.push({ line, raw, why: `could not read the date "${dateRaw}"` });
      return;
    }

    /* The currency word a receipt prints — "Rs. 380", "INR 380" — is not part
       of the number. "₹" already passes; the words used to cost the whole row. */
    const plain = amountRaw.replace(/^\s*(?:rs\.?|inr)\s*/i, '').trim();

    /* A SIGN IS A DIRECTION, the way a bank or UPI history writes it:
       "-60.00" is sixty rupees going OUT and "+30.76" is money coming IN.
       Read literally, every "-" row was refused as a negative amount — a
       whole history at once — while the few "+" rows sailed through as
       spends, so cashback was about to be recorded as spending.

       So a leading minus is dropped and the row is a spend of that amount,
       and a leading plus is money RECEIVED: an income row, filed by source
       and account (see ImportRow.direction). No sign is a spend, as always. */
    const sign = /^[+\-\u2212]/.exec(plain)?.[0] ?? '';
    const direction: 'out' | 'in' = sign === '+' ? 'in' : 'out';
    const parsed = evaluateAmount(sign ? plain.slice(1) : plain);
    if (!parsed.ok) {
      skipped.push({ line, raw, why: `could not read the amount "${amountRaw}"` });
      return;
    }
    if (parsed.amount <= 0) {
      skipped.push({ line, raw, why: 'amount is zero or negative' });
      return;
    }

    const issues: ImportIssue[] = [];

    /* The method column may hold the BANK's own label — "Federal 2788" — rather
       than this app's name for the account, because that is what a UPI history
       prints. The configured mapping turns one into the other; an unmapped or
       ambiguous label is still reported rather than guessed at. */
    let method = '';
    if (methodRaw.trim() === '' || /^unreadable$/i.test(methodRaw)) {
      issues.push('no-method');
    } else {
      const hit = resolveMethod(methodRaw, bankMethods);
      if (hit) method = hit;
      else issues.push('unknown-method');
    }

    // Money received is filed by SOURCE, not by spending category.
    const allowed: readonly string[] = direction === 'in' ? INCOME_SOURCES : ALL_CATEGORIES;
    let category = '';
    if (categoryRaw.trim() === '' || /^unreadable$/i.test(categoryRaw)) {
      issues.push('no-category');
    } else {
      const hit = match(categoryRaw, allowed);
      if (hit) category = hit;
      // "Super Money" is not an income source: leave it to be chosen, not refused.
      else issues.push(direction === 'in' ? 'no-category' : 'unknown-category');
    }

    rows.push(settle({
      line,
      direction,
      ref: null,
      raw,
      day,
      time,
      amount: parsed.amount,
      method,
      methodRaw: methodRaw.trim(),
      category,
      // Everything after the four known columns, so a description containing a
      // pipe survives instead of being cut at it. A [Tag] in it is a tag.
      remarks: splitTags(rest.join(' | ')).text,
      tags: splitTags(rest.join(' | ')).tags,
      issues,
    }));
  });

  return { rows, skipped };
}

/* A whole batch pasted as ONE line — what an assistant's answer becomes when
   its line breaks are lost on the way — reads as a single row with a
   paragraph for a description. Each record starts with a date and a pipe, so
   a line holding several is cut back into one per record. */
const RECORD_START = /\s+(?=\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?\s*\|)/gi;

function splitRecords(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const parts = line.split(RECORD_START);
    return parts.length > 1 ? parts : [line];
  });
}

/**
 * Money received onto a CARD is not income: it is a refund that lowers the
 * card's balance. This app records that as the card's bill paid from Perks
 * (as the fuel-surcharge waivers are), so such a row becomes exactly that.
 */
function settle(row: ImportRow): ImportRow {
  if (row.direction !== 'in' || !row.method || !isCard(row.method)) return row;
  return {
    ...row,
    direction: 'out',
    category: row.method,
    method: 'Perks',
    remarks: row.remarks ? `Refund: ${row.remarks}` : 'Refund',
    issues: row.issues.filter((x) => x !== 'no-category' && x !== 'unknown-category'),
  };
}

function fromGpay(text: string, bankMethods: BankMethods): ImportParse {
  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];
  parseGpayStatement(text).forEach((m, i) => {
    const issues: ImportIssue[] = [];
    const method = m.account ? resolveMethod(m.account, bankMethods) : null;
    if (!m.account) issues.push('no-method');
    else if (!method) issues.push('unknown-method');
    issues.push('no-category');
    rows.push(settle({
      line: i + 1,
      direction: m.direction,
      ref: m.ref,
      raw: `${m.day} ${m.time ?? ''} | ${m.direction === 'in' ? '+' : '-'}${m.amount} | ${m.account} | ${m.party}`,
      day: m.day,
      time: m.time,
      amount: m.amount,
      method: method ?? '',
      methodRaw: m.account,
      category: '',
      remarks: m.party,
      tags: [],
      issues,
    }));
  });
  if (rows.length === 0) {
    skipped.push({ line: 1, raw: text.slice(0, 120), why: 'looked like a Google Pay statement, but no payments could be read' });
  }
  return { rows, skipped };
}

function fromFederal(text: string, bankMethods: BankMethods): ImportParse {
  const st = parseFederalStatement(text);
  const label = st.account ? `Federal ${st.account}` : 'Federal';
  const account = resolveMethod(label, bankMethods);
  const salaryFrom = regularNeftSenders(st.rows);
  const skipped: ImportSkip[] = [];
  if (st.unreconciled > 0) {
    skipped.push({
      line: 0, raw: `${st.unreconciled} rows`,
      why: 'some amounts did not match the change in balance — check those rows against the PDF',
    });
  }
  const rows = st.rows.map((r, i): ImportRow => {
    const read = readBankRow(r, { salaryFrom });
    return settle({
      line: i + 1,
      direction: r.direction,
      ref: `${r.day}:${r.ref}`,
      skip: read.skip,
      hint: read.hint,
      raw: `${r.day} | ${r.direction === 'in' ? '+' : '-'}${r.amount} | ${label} | ${r.particulars}`,
      day: r.day,
      time: null,
      amount: r.amount,
      method: account ?? '',
      methodRaw: label,
      category: read.category,
      remarks: read.label,
      tags: [],
      issues: [...(account ? [] : (['unknown-method'] as ImportIssue[])), ...(read.category ? [] : (['no-category'] as ImportIssue[]))],
    });
  });
  return { rows, skipped };
}

/**
 * True when every row can be saved.
 *
 * A METHOD IS REQUIRED; a category is not. Without a method the money lands
 * on no card and no account, so the row would be recorded and still be wrong
 * everywhere it matters. A missing category only means the expense is not
 * filed yet: it still counts against the card, it is flagged for review, and
 * it can be sorted later — which is far better than refusing the batch and
 * leaving the expense recorded nowhere at all.
 */
export function readyToImport(rows: ImportRow[]): boolean {
  // Money received also needs its source: income without one cannot be saved.
  return rows.length > 0 && rows.every((r) => r.method !== '' && (r.direction === 'out' || r.category !== ''));
}

/** Rows that will go in unfiled, so the page can say how many before saving. */
export function unsortedCount(rows: ImportRow[]): number {
  return rows.filter((r) => r.direction === 'out' && r.category === '').length;
}