/* ===========================================================================
   The next one in a series.

   Most of what gets typed into this ledger has been typed before, very nearly.
   "Sheya's 23/24 Emi" becomes "Sheya's 24/24 Emi" a month later; "Ipad Mini
   18/24" becomes "Ipad Mini 19/24". Retyping it by hand is where a series
   quietly breaks — an instalment skipped, a number repeated, a name spelled
   two ways — and a broken series cannot be totalled or chased.

   So a past remark can be offered with its counter already moved on. This is
   a SUGGESTION for a form, never a write: the number it proposes is the
   obvious one, not a verified one, and a month with two instalments or none
   is a real thing a person has to decide about.

   It only ever advances what the text itself makes explicit. A remark with no
   counter and no month comes back null rather than guessed at.
   =========================================================================== */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Re-applies the casing of the word being replaced, so JULY → AUGUST. */
function likeCase(sample: string, word: string): string {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample[0] === sample[0]?.toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

/**
 * The same remark, one period on, or null when it says nothing to advance.
 *
 * A COUNTER WINS OVER A MONTH. "EMI 3/12 for March" is one instalment of
 * twelve that happens to name a month; moving the month and leaving 3/12
 * would produce a remark claiming to be the same instalment twice.
 *
 * A finished series returns null. 24/24 has no 25th, and offering one would
 * invite an instalment that does not exist onto a bill.
 */
export function nextInSeries(remark: string): string | null {
  const text = remark ?? '';

  const counter = text.match(/(\d+)(\s*\/\s*)(\d+)/);
  if (counter) {
    const n = Number(counter[1]);
    const total = Number(counter[3]);
    if (n >= total) return null;
    const padded = counter[1]!.length > 1 && counter[1]!.startsWith('0')
      ? String(n + 1).padStart(counter[1]!.length, '0')
      : String(n + 1);
    return (
      text.slice(0, counter.index!) +
      padded + counter[2] + counter[3] +
      text.slice(counter.index! + counter[0].length)
    );
  }

  /* A month name, with the year carried when December rolls over and a year
     is actually written. Inventing a year that was never there would turn
     "Rent December" into "Rent January 2027" on a remark that named no year. */
  const month = text.match(
    new RegExp(`\\b(${MONTHS.join('|')}|${SHORT.join('|')})\\b(\\s*)(\\d{4})?`, 'i'),
  );
  if (month) {
    const word = month[1]!;
    const lower = word.toLowerCase();
    const idx = MONTHS.indexOf(lower) >= 0 ? MONTHS.indexOf(lower) : SHORT.indexOf(lower);
    if (idx >= 0) {
      const isShort = SHORT.indexOf(lower) >= 0 && MONTHS.indexOf(lower) < 0;
      const nextIdx = (idx + 1) % 12;
      const nextWord = likeCase(word, isShort ? SHORT[nextIdx]! : MONTHS[nextIdx]!);
      const year = month[3] ? String(Number(month[3]) + (nextIdx === 0 ? 1 : 0)) : '';
      return (
        text.slice(0, month.index!) +
        nextWord + (month[3] ? month[2] + year : '') +
        text.slice(month.index! + month[0].length)
      );
    }
  }

  return null;
}

/** True when a remark names a position in a series — used to explain the offer. */
export function isSeries(remark: string): boolean {
  return nextInSeries(remark) !== null;
}
