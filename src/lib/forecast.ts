import { byCategory, byMethod, monthSummary, round2, spendBetween } from '@/lib/analytics';
import { statementView } from '@/lib/statement';
import { endOfDay, monthEnd, monthKey, monthStart, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   Forecast and Recommended Reserve (spec §3.5).

     Estimated Spend Remaining = run rate so far this month x days left
     Recommended Reserve       = Total Debt (Live) + Estimated Spend Remaining

   The reserve is the headline number on the home screen because it is the one
   figure that answers the actual daily question: how much do I need to keep in
   the bank so nothing bounces?

   Pre-logged future rows inside this month (EMI instalments entered ahead of
   time) are ADDED to the projection rather than averaged into it — they are
   known amounts on known dates, and blending a certainty into a run rate loses
   information in both directions.
   =========================================================================== */

export type ForecastSlice = { key: string; projected: number; perDay: number };

export type Forecast = {
  month: string;
  today: Day;
  daysElapsed: number;
  daysRemaining: number;

  spentSoFar: number;
  perDay: number;
  /** Run rate projected across the days left. */
  projectedRemaining: number;
  /** Future-dated rows already logged inside this month. */
  knownRemaining: number;
  /** projectedRemaining + knownRemaining. */
  estimatedRemaining: number;
  /** Month-end total if the rest of the month behaves like the start of it. */
  projectedMonthTotal: number;

  byCard: ForecastSlice[];
  byCategory: ForecastSlice[];

  totalDebtLive: number;
  /** Total Debt (Live) + estimated remaining spend. Spec §3.5. */
  recommendedReserve: number;
};

export function forecast(snapshot: Snapshot, today: Day): Forecast {
  const summary = monthSummary(snapshot, today);
  const key = monthKey(today);
  const rows = spendBetween(snapshot, monthStart(key), today);

  const { elapsed, daysRemaining } = summary;
  const perDay = summary.perDay;

  // Known future rows inside this month: real amounts on real dates.
  const monthLast = monthEnd(key);
  const knownRemaining = round2(
    snapshot.transactions
      .filter(
        (t) =>
          !t.deleted && t.kind === 'spend' && t.amount != null && t.ts != null &&
          t.ts > endOfDay(today) && t.ts <= endOfDay(monthLast),
      )
      .reduce((a, t) => a + (t.amount ?? 0), 0),
  );

  const projectedRemaining = round2(perDay * daysRemaining);
  const estimatedRemaining = round2(projectedRemaining + knownRemaining);

  const slice = (list: { key: string; total: number }[]): ForecastSlice[] =>
    list
      .map((c) => ({
        key: c.key,
        perDay: round2(c.total / elapsed),
        projected: round2((c.total / elapsed) * daysRemaining),
      }))
      .filter((c) => c.projected > 0)
      .sort((a, b) => b.projected - a.projected);

  const debt = statementView(snapshot, today).totals.totalDebtLive;

  return {
    month: key,
    today,
    daysElapsed: elapsed,
    daysRemaining,
    spentSoFar: summary.spend,
    perDay,
    projectedRemaining,
    knownRemaining,
    estimatedRemaining,
    projectedMonthTotal: round2(summary.spend + estimatedRemaining),
    // Only card methods are meaningful for the per-card view.
    byCard: slice(byMethod(rows).filter((m) => m.key !== 'Fi' && m.key !== 'Cash')),
    byCategory: slice(byCategory(rows)),
    totalDebtLive: debt,
    recommendedReserve: round2(debt + estimatedRemaining),
  };
}
