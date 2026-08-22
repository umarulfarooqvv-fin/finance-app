import { daysInMonth, fromCivil, type Instant } from '@/lib/time';
import { CARD_NAMES, SPEND_CATEGORIES, isCard, type CardDirection, type CardName, type Tags, type TxKind } from '@/lib/types';

/* ===========================================================================
   Turning a raw row into meaning.

   Three jobs, kept separate so each is testable on its own:
     1. parseTimestamp — three historical formats coexist in the source data
     2. parseTags      — semantics Farooq embeds in free-text remarks
     3. classify       — what kind of money movement the row represents

   Rule 3 is the heart of the system. Getting it wrong misstates debt, so it is
   written to be readable rather than clever, and every branch is covered by a
   test against the real sheet fixture.
   =========================================================================== */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* Format A — the Google Form's custom display format. Note the CENTISECOND
   field after seconds, and the 2-digit year meaning 20YY. A time of exactly
   12:00:00:00 AM is the form's convention for "date only, no time given".
   e.g. " 08, March 26 at 03:58:47:71 PM" */
const FMT_A = /^\s*(\d{1,2}),\s+([A-Za-z]+)\s+(\d{2})\s+at\s+(\d{1,2}):(\d{2}):(\d{2}):(\d{2})\s*(AM|PM)\s*$/i;

/* Format B — plain Sheets serial format, 24-hour. The sheet switched to this
   on 21-May-2026. e.g. "5/21/2026 14:13:19" (US order: month first) */
const FMT_B = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/;

/* Format C — the display format covering almost the whole 2023-2024 history,
   with a redundant weekday. Missing this once caused the entire history import
   to land with ts = NULL. e.g. "06-July-2024,  Saturday" */
const FMT_C = /^\s*(\d{1,2})-([A-Za-z]+)-(\d{4})\s*(?:,\s*[A-Za-z]+\s*)?$/;

export type ParsedTime = { ts: Instant; dateOnly: boolean };

/**
 * A regex match is not proof of a real date: "32/13/2026" matches the shape of
 * format B perfectly. Every branch below validates the parts against the
 * calendar before building an Instant, so an impossible date is rejected as
 * unparseable rather than stored as the nonsense string "2026-32-13".
 */
function validParts(y: number, m: number, d: number, hh: number, mi: number, ss: number): boolean {
  return (
    y >= 1970 && y <= 2200 &&
    m >= 1 && m <= 12 &&
    d >= 1 && d <= daysInMonth(y, m) &&
    hh >= 0 && hh <= 23 &&
    mi >= 0 && mi <= 59 &&
    ss >= 0 && ss <= 59
  );
}

/**
 * Parse any of the three source timestamp formats into IST wall-clock.
 * Returns null when nothing matches — callers flag the row for review rather
 * than guessing, because a wrong date silently moves money between months.
 */
export function parseTimestamp(raw: string | null | undefined): ParsedTime | null {
  if (!raw || !raw.trim()) return null;

  const a = raw.match(FMT_A);
  if (a) {
    const [, dd, monthName, yy, hh, mi, ss, cc, ampm] = a;
    const m = MONTHS[(monthName ?? '').toLowerCase()];
    if (!m) return null;
    const isPM = (ampm ?? '').toUpperCase() === 'PM';
    // "12:00:00:00 AM" exactly = the date-only convention, not midnight data.
    const dateOnly = hh === '12' && mi === '00' && ss === '00' && cc === '00' && !isPM;
    const hour = (Number(hh) % 12) + (isPM ? 12 : 0);
    const y = 2000 + Number(yy);
    const d = Number(dd);
    const hOut = dateOnly ? 0 : hour;
    if (!validParts(y, m, d, hOut, Number(mi), Number(ss))) return null;
    return { ts: fromCivil({ y, m, d, hh: hOut, mm: Number(mi), ss: Number(ss) }), dateOnly };
  }

  const b = raw.match(FMT_B);
  if (b) {
    const [, mo, dd, yyyy, hh, mi, ss] = b;
    const parts = {
      y: Number(yyyy), m: Number(mo), d: Number(dd),
      hh: Number(hh), mm: Number(mi), ss: Number(ss ?? 0),
    };
    if (!validParts(parts.y, parts.m, parts.d, parts.hh, parts.mm, parts.ss)) return null;
    return { ts: fromCivil(parts), dateOnly: false };
  }

  const c = raw.match(FMT_C);
  if (c) {
    const [, dd, monthName, yyyy] = c;
    const m = MONTHS[(monthName ?? '').toLowerCase()];
    if (!m) return null;
    const y = Number(yyyy);
    const d = Number(dd);
    if (!validParts(y, m, d, 0, 0, 0)) return null;
    return { ts: fromCivil({ y, m, d, hh: 0, mm: 0, ss: 0 }), dateOnly: true };
  }

  return null;
}

/* --- Remarks conventions ---------------------------------------------------
   Free text, but Farooq writes it consistently enough to mine:
     "(Trip Ponnani to Ernakulam)"  -> trip grouping
     "(Cirqle)"                     -> freelance business
     "Sheya's 18/24 Emi"            -> EMI item + instalment counter
     "... payment cleared"          -> a repayment event
*/

/**
 * An n/m instalment counter. Bounded deliberately: a bare `\d+/\d+` also
 * matches dates ("5/21"), fractions and ratios, which would invent EMIs out of
 * ordinary remarks.
 */
const EMI_COUNTER = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/;

/**
 * Plausible instalment plan lengths. Lenders sell round tenors — every EMI in
 * the real history runs to /24 — whereas the denominator of a date written in
 * passing ("paid on 5/21") lands on arbitrary numbers. Requiring a standard
 * tenor is what separates the two, since the shape alone cannot.
 *
 * A remark that says "EMI" outright is trusted regardless of tenor, so an
 * unusual plan still parses when it is named as one.
 */
const STANDARD_TENORS = new Set([3, 4, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 48, 60]);
const SAYS_EMI = /\bemi\b|\binstal?ments?\b/i;

export function parseTags(remarks: string | null | undefined): Tags {
  const tags: Tags = {};
  if (!remarks) return tags;

  const trip = remarks.match(/\(\s*Trip\s+([^)]+)\)/i);
  if (trip?.[1]) tags.trip = trip[1].trim();

  if (/cirqle/i.test(remarks)) tags.cirqle = true;

  const emi = remarks.match(EMI_COUNTER);
  const n = emi ? Number(emi[1]) : 0;
  const m = emi ? Number(emi[2]) : 0;
  const plausibleTenor = STANDARD_TENORS.has(m) || SAYS_EMI.test(remarks);
  if (emi && plausibleTenor && n >= 1 && n <= m) {
    tags.emi = { n, m };
    // The item name is what immediately precedes the counter:
    //   "Sheya's 18/24 Emi"  -> Sheya
    //   "Ipad Mini 15/24"    -> Ipad Mini
    // Only the last few words are taken. A remark can be a whole sentence that
    // happens to end near a counter, and using the entire prefix turned one
    // plan's name into a 20-word paragraph.
    const name = remarks
      .slice(0, emi.index)
      .replace(/['’]s?\s*$/i, '')
      .replace(/\bemi\b/gi, ' ')
      .trim()
      .split(/\s+/)
      .slice(-3)
      .join(' ')
      .trim();
    if (name) tags.emiName = name;
    // Instalments split into principal + the card's surcharge and tax rows.
    if (/charge|surcharge/i.test(remarks)) tags.emiComponent = 'surcharge';
    else if (/\btax(es)?\b/i.test(remarks)) tags.emiComponent = 'tax';
    else tags.emiComponent = 'principal';
  } else if (/\bemi\b/i.test(remarks)) {
    tags.emi = true;
  }

  if (/\b(cleared|repayment|repaid)\b/i.test(remarks)) tags.cleared = true;

  return tags;
}

/**
 * The debtor's name on a Credit Given row. Best-effort: strip the bookkeeping
 * words and take what is left. Never blocks — an unmatched name just groups
 * under its own key and can be reassigned by hand in the ledger.
 */
export function parsePerson(remarks: string | null | undefined): string | null {
  if (!remarks) return null;
  const cleaned = remarks
    .replace(/\(\s*Trip[^)]*\)/gi, ' ')
    .replace(/\(\s*Cirqle\s*\)/gi, ' ')
    .replace(/\b(credit|given|to|for|payment|cleared|repayment|repaid|cash|gpay|upi|paid)\b/gi, ' ')
    .replace(/[0-9₹.,/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

export type Classification = {
  kind: TxKind;
  cardAffected: CardName | null;
  cardDirection: CardDirection | null;
  tags: Tags;
};

/**
 * Decide what a row means (spec §2.2).
 *
 * The decisive question is what the CATEGORY says, not the method:
 *   - category is a card name        -> a payment TO that card, clearing a bill
 *   - category is "Credit Card"      -> same, but the target card is in remarks
 *                                       (an older convention still in history)
 *   - category is Investment/Savings -> a transfer into an instrument
 *   - category is "Credit Given"     -> lent out; an outflow, but excludable
 *   - category is a spend category   -> consumption
 *
 * The METHOD then decides whether debt is created: paying by card adds to that
 * card's balance ('debt+'); paying by bank or cash settles immediately.
 */
export function classify(input: { method: string; category: string; remarks: string }): Classification {
  const method = (input.method ?? '').trim();
  const category = (input.category ?? '').trim();
  const remarks = (input.remarks ?? '').trim();
  const tags = parseTags(remarks);
  const paidByCard = isCard(method);

  // A spend charged to a card increases that card's debt.
  const chargeToCard = (): { cardAffected: CardName | null; cardDirection: CardDirection | null } =>
    paidByCard
      ? { cardAffected: method as CardName, cardDirection: 'debt+' }
      : { cardAffected: null, cardDirection: null };

  if (isCard(category)) {
    // Paying a card bill. The money came FROM `method` (usually Fi, sometimes
    // Perks points, occasionally another card) and lands ON `category`.
    return { kind: 'card_payment', cardAffected: category, cardDirection: 'debt-', tags };
  }

  if (category === 'Credit Card') {
    // Legacy convention: the paid card is named inside the remarks, e.g.
    // "Edge Credit Card Bill Payment".
    const target = CARD_NAMES.find((n) => remarks.toLowerCase().includes(n.toLowerCase())) ?? null;
    return { kind: 'card_payment', cardAffected: target, cardDirection: target ? 'debt-' : null, tags };
  }

  if (category === 'Investment' || category === 'Savings') {
    return { kind: 'investment', ...chargeToCard(), tags };
  }

  if (category === 'Credit Given') {
    const person = parsePerson(remarks);
    return { kind: 'credit_given', ...chargeToCard(), tags: person ? { ...tags, person } : tags };
  }

  if ((SPEND_CATEGORIES as readonly string[]).includes(category)) {
    // An instalment row is still a spend on the card; the emi kind is reserved
    // for rows that carry a counter but no recognisable spend category.
    return { kind: 'spend', ...chargeToCard(), tags };
  }

  // Unrecognised. If it at least looks like an instalment, say so; otherwise
  // leave it unknown so it shows up for review instead of being counted.
  if (tags.emi) return { kind: 'emi', ...chargeToCard(), tags };
  return { kind: 'unknown', ...chargeToCard(), tags };
}
