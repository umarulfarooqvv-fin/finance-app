/* ===========================================================================
   Folding text so a search finds what a person meant.

   This ledger's rows came from a Google Sheet, which silently curls an
   apostrophe as it is typed: the stored remark is "Sheya’s 23/24 Emi" with a
   RIGHT SINGLE QUOTATION MARK, while the keyboard in front of anyone
   searching for it produces "Sheya's" with an apostrophe. They are different
   characters, so a plain substring match finds nothing and the row looks
   deleted rather than merely unfindable.

   The same goes for a dash the sheet turned into an en dash, and for the
   accents that arrive with a merchant name pasted from a statement.

   Folding is for MATCHING ONLY. What is stored and shown is always the text as
   it was written — correcting someone's punctuation for them is not this
   app's business, and a remark rewritten on read could never be searched for
   by what is actually in the database.
   =========================================================================== */

const QUOTES = /[‘’ʼ´`]/g;   // ' ' ʼ ´ `
const DOUBLE = /[“”]/g;                      // " "
const DASHES = /[‐-―−]/g;               // ‐ – — − and friends

/**
 * A comparable form of some text: lower case, straight punctuation, no
 * accents, single spaces.
 *
 * Never store or display the result.
 */
export function foldForSearch(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    // Strip combining marks, so "café" and "cafe" are the same search.
    .replace(/[̀-ͯ]/g, '')
    .replace(QUOTES, "'")
    .replace(DOUBLE, '"')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `haystack` contains `needle`, both folded. Empty needle matches. */
export function looseIncludes(haystack: string, needle: string): boolean {
  const q = foldForSearch(needle);
  return q === '' || foldForSearch(haystack).includes(q);
}
