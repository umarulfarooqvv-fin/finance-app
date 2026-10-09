import { foldForSearch } from '@/lib/search-text';

/* ===========================================================================
   Tags — an occasion that cuts across categories.

   A trip, a hospital stay, a wedding: the spends belong to Food, Fuel and
   Medicine, and the question asked afterwards is "what did the whole thing
   cost". A tag answers it. One entry can carry several, and a tag once made
   is offered again everywhere an entry is written.

   STORED IN THE REMARKS, as "Dinner [Banglore Trip]". That is deliberate:
     - it is what the person typed, which is the only thing this app trusts
       (derived columns are re-read on every load — see snapshot.ts)
     - it travels unchanged through the Shortcut, the Google Sheet, a CSV
       and bulk import, none of which know a "tags" column exists
     - no migration, and nothing to fall out of step with the row
   Square brackets were unused in 2,700 rows of history; round brackets are
   everyday notes ("(GST)", "(Phone for his mom)") and are left alone.

   On load the snapshot splits each entry into its text and its tags, so the
   rest of the app shows "Dinner" with a "Banglore Trip" chip and never the
   brackets. Anything that writes an entry joins them back.

   Pure: strings in, strings out.
   =========================================================================== */

/** Long enough for "Dad hospital — Malabar, Sept"; short enough to be a chip. */
export const TAG_MAX = 40;

const MARKER = /\[([^[\]]*)\]/g;

/** A tag as it will be stored, or null if nothing usable is left. */
export function normaliseTag(raw: string): string | null {
  const t = String(raw ?? '')
    .replace(/[[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAG_MAX)
    .trim();
  return t ? t : null;
}

/** Two spellings of one tag — "banglore trip", "Banglore  Trip" — share a key. */
export function tagKey(tag: string): string {
  return foldForSearch(tag).replace(/\s+/g, ' ').trim();
}

/** Tags in order, without repeats; the first spelling of each wins. */
export function uniqueTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = normaliseTag(raw);
    if (!t) continue;
    const k = tagKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** "Dinner [Banglore Trip]" → { text: "Dinner", tags: ["Banglore Trip"] }. */
export function splitTags(remarks: string | null | undefined): { text: string; tags: string[] } {
  const raw = String(remarks ?? '');
  const found: string[] = [];
  const text = raw
    .replace(MARKER, (_, inner: string) => {
      found.push(inner);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, tags: uniqueTags(found) };
}

/** The other way: text plus tags, as stored. */
export function joinTags(text: string, tags: Iterable<string>): string {
  const clean = splitTags(text); // a tag typed into the text itself is kept, not doubled
  const all = uniqueTags([...clean.tags, ...tags]);
  return [clean.text, ...all.map((t) => `[${t}]`)].filter(Boolean).join(' ');
}

export function hasTag(remarks: string, tag: string): boolean {
  const k = tagKey(tag);
  return splitTags(remarks).tags.some((t) => tagKey(t) === k);
}

export function addTag(remarks: string, tag: string): string {
  const { text, tags } = splitTags(remarks);
  return joinTags(text, [...tags, tag]);
}

export function removeTag(remarks: string, tag: string): string {
  const k = tagKey(tag);
  const { text, tags } = splitTags(remarks);
  return joinTags(text, tags.filter((t) => tagKey(t) !== k));
}

/** Rename in place; a rename onto a tag the entry already has merges them. */
export function renameTag(remarks: string, from: string, to: string): string {
  const k = tagKey(from);
  const { text, tags } = splitTags(remarks);
  if (!tags.some((t) => tagKey(t) === k)) return joinTags(text, tags);
  return joinTags(text, tags.map((t) => (tagKey(t) === k ? to : t)));
}

/**
 * Turn an old round-bracket label into a tag: "Dinner (Banglore Trip)" →
 * "Dinner [Banglore Trip]". Only that exact label, however it was cased;
 * every other bracket in the remarks is someone's note and stays.
 */
export function labelToTag(remarks: string, label: string, tag: string): string {
  const k = tagKey(label);
  let hit = false;
  const stripped = String(remarks ?? '').replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    if (tagKey(inner) !== k) return whole;
    hit = true;
    return ' ';
  });
  return hit ? addTag(stripped, tag) : remarks;
}

/** Round-bracket labels in the remarks: candidates to become tags. */
export function bracketLabels(remarks: string): string[] {
  const out: string[] = [];
  for (const m of String(remarks ?? '').matchAll(/\(([^()]*)\)/g)) {
    const t = normaliseTag(m[1] ?? '');
    // Sums, counters and amounts ("199", "4/6", "60000-20000") are not occasions.
    if (t && /[a-z]{3}/i.test(t) && !/^\d+\s*\/\s*\d+$/.test(t)) out.push(t);
  }
  return out;
}

/**
 * Remarks as the Google Sheet would have written them, for MATCHING only.
 * The sheet never learned about tags: it says "Dinner (Banglore Trip)" or
 * just "Dinner" where the app now holds "Dinner [Banglore Trip]". Both sides
 * drop their tags — the app's [markers], and the sheet's (labels) that name a
 * tag the app knows — so a tag never makes a sync think a row changed.
 */
export function comparableRemarks(remarks: string, knownTagKeys: ReadonlySet<string>): string {
  return splitTags(remarks).text
    .replace(/\(([^()]*)\)/g, (whole, inner: string) => (knownTagKeys.has(tagKey(inner)) ? ' ' : whole))
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sheet's (labels) that name a known tag, in the app's spelling. */
export function knownLabelTags(remarks: string, known: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const m of String(remarks ?? '').matchAll(/\(([^()]*)\)/g)) {
    const hit = known.get(tagKey(m[1] ?? ''));
    if (hit) out.push(hit);
  }
  return out;
}
