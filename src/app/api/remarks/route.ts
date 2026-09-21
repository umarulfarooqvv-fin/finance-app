import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getSnapshot } from '@/lib/snapshot';
import { frequentPairs, type EntryPair } from '@/lib/entry-hints';
import { dayOf } from '@/lib/time';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   What has been typed into this ledger before.

   The entry form's remarks field is where consistency is won or lost. The same
   expense typed "Kseb bill", "KSEB Bill Payment" and "kseb electricity" is
   three things to every total on every page, and nobody notices until a
   category looks wrong months later.

   So the form can search what is already there. REMARKS ONLY, with the
   category and method each was filed under — no amounts, no dates beyond the
   last time it was used, because the form has no use for those and this reply
   should carry the least that does the job.

   It also returns the METHOD AND CATEGORY PAIRINGS used most, recency
   weighted, for the two dropdowns above the remarks field. Same request,
   because both are read from one snapshot and a second round trip to answer
   half of the same question is a second thing to fail.

   Session-guarded: these are the user's own descriptions, which name people
   and places and are nobody else's business.
   =========================================================================== */

export type RemarkSuggestion = {
  remarks: string;
  category: string;
  method: string;
  /** How many entries share this exact remark — the house style, by weight. */
  used: number;
  /** The most recent day it was used, so the newest phrasing leads. */
  last: string;
};

const LIMIT = 400;
/** Four fits one row on a phone without wrapping. */
const PAIRS = 4;

export async function GET(): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const snap = await getSnapshot();

  /* Distinct by the remark EXACTLY as written, not case-folded. Two casings of
     one phrase are precisely the inconsistency this is meant to surface, so
     collapsing them here would hide the thing worth seeing. */
  const seen = new Map<string, RemarkSuggestion>();
  for (const t of snap.transactions) {
    const remarks = (t.remarks ?? '').trim();
    if (!remarks || t.deleted) continue;
    const day = (t.ts ?? '').slice(0, 10);
    const hit = seen.get(remarks);
    if (hit) {
      hit.used += 1;
      if (day > hit.last) { hit.last = day; hit.category = t.category; hit.method = t.method; }
    } else {
      seen.set(remarks, { remarks, category: t.category, method: t.method, used: 1, last: day });
    }
  }

  const suggestions = [...seen.values()]
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.used - a.used))
    .slice(0, LIMIT);

  const pairs: EntryPair[] = frequentPairs(snap, dayOf(snap.loadedAt), PAIRS);

  return NextResponse.json({ ok: true, suggestions, pairs });
}
