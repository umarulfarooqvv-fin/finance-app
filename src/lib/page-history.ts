/* ===========================================================================
   Which pages get opened, for the ⌘K palette's Recent and Frequently used.

   Per device, in localStorage — this is a convenience about how one person
   moves around one phone or laptop, not data anybody else needs, and losing
   it costs a palette that falls back to its ordinary list.

   NO CLOCK. The app reads the time in exactly one place (time.nowIST), and
   ordering visits does not need it: each visit takes the next number in a
   sequence, and the highest numbers are the most recent.

   FREQUENCY FADES. Every visit shrinks every page's score a little before
   adding one to the page opened, so the ranking follows what is used NOW. A
   page used forty times in March and not since should not outrank the one
   opened daily this week; with a plain count it would, for months.
   =========================================================================== */

export type PageVisits = {
  /** The last sequence number handed out. */
  seq: number;
  pages: Record<string, { last: number; score: number }>;
};

export const EMPTY_VISITS: PageVisits = { seq: 0, pages: {} };

/** How much a score keeps per visit elsewhere. ~0.97 halves in ~23 visits. */
const FADE = 0.97;
/** Below this a page has faded out of the running and is dropped. */
const FORGET = 0.05;

export function recordVisit(state: PageVisits, href: string): PageVisits {
  // The page already last opened, opened again, is a refresh — or React
  // running an effect twice — not a second visit, and must not count as one.
  if (state.pages[href]?.last === state.seq && state.seq > 0) return state;
  const seq = state.seq + 1;
  const pages: PageVisits['pages'] = {};
  for (const [h, p] of Object.entries(state.pages)) {
    const score = p.score * FADE;
    if (score >= FORGET || h === href) pages[h] = { last: p.last, score };
  }
  pages[href] = { last: seq, score: (pages[href]?.score ?? 0) + 1 };
  return { seq, pages };
}

/** Most recently opened first, leaving out the page already on screen. */
export function recentPages(state: PageVisits, current: string | null, n: number): string[] {
  return Object.entries(state.pages)
    .filter(([h]) => h !== current)
    .sort(([, a], [, b]) => b.last - a.last)
    .slice(0, n)
    .map(([h]) => h);
}

/**
 * Most used first, leaving out the current page and anything already listed
 * as recent — the same page twice in a short list is a wasted row. Only pages
 * opened more than once count: one visit is "recent", not "frequent".
 */
export function frequentPages(
  state: PageVisits,
  exclude: readonly (string | null)[],
  n: number,
): string[] {
  return Object.entries(state.pages)
    .filter(([h, p]) => !exclude.includes(h) && p.score > 1.2)
    .sort(([, a], [, b]) => b.score - a.score || b.last - a.last)
    .slice(0, n)
    .map(([h]) => h);
}

/** Tolerant read: anything malformed is treated as no history at all. */
export function parseVisits(raw: string | null): PageVisits {
  if (!raw) return EMPTY_VISITS;
  try {
    const v = JSON.parse(raw) as PageVisits;
    if (typeof v?.seq !== 'number' || typeof v.pages !== 'object' || v.pages === null) return EMPTY_VISITS;
    return v;
  } catch {
    return EMPTY_VISITS;
  }
}
