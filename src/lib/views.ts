import 'server-only';
import { cache } from 'react';
import { creditLedger, type CreditLedger } from '@/lib/credit';
import { forecast, type Forecast } from '@/lib/forecast';
import { statementView, type StatementView } from '@/lib/statement';
import { dayOf, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';
import { getSnapshot } from '@/lib/snapshot';

/* ===========================================================================
   Cached selectors — the per-request tier of the cache.

   The functions in `domain/` are pure and stay that way: they take a snapshot
   and return a value, with no memoisation of their own. Caching is a concern
   of the layer that knows about requests, so it lives here.

   React's `cache()` deduplicates within a single render pass. That matters
   because the derived views compose: `forecast()` calls `statementView()`
   internally, and the Today page also calls `statementView()` directly — so
   one page render computed the whole statement engine, credit ledger and all,
   twice over. Wrapping the selectors collapses that to once.

   Anything reading a snapshot inside a page should come through here rather
   than calling the domain function directly.
   =========================================================================== */

/** The snapshot plus today's date, resolved once per request. */
export const currentSnapshot = cache(
  async (): Promise<{ snap: Snapshot; today: Day }> => {
    const snap = await getSnapshot();
    return { snap, today: dayOf(snap.loadedAt) };
  },
);

export const cardsView = cache(async (): Promise<StatementView> => {
  const { snap, today } = await currentSnapshot();
  return statementView(snap, today);
});

export const forecastView = cache(async (): Promise<Forecast> => {
  const { snap, today } = await currentSnapshot();
  return forecast(snap, today);
});

export const creditView = cache(async (): Promise<CreditLedger> => {
  const { snap, today } = await currentSnapshot();
  return creditLedger(snap, `${today}T23:59:59`);
});
