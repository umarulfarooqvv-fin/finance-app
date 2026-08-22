import { round2 } from '@/lib/analytics';
import { creditLedger } from '@/lib/credit';
import { debtLedger } from '@/lib/debts';
import { statementView } from '@/lib/statement';
import { addDays, endOfDay, monthEnd, monthKey, startOfDay, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   What you actually have: account balances and net worth.

   A bank balance here is RECONSTRUCTED, not fetched — the app has no bank
   connection. It is an opening figure on a chosen date plus income since,
   minus everything paid out of that account since. That makes it only as
   accurate as the logging, which is why the opening date is configurable and
   the figure is labelled as derived rather than presented as a bank truth.
   =========================================================================== */

export type AccountBalance = {
  name: string;
  kind: 'bank' | 'cash';
  openingBalance: number;
  since: Day | null;
  incomeIn: number;
  paidOut: number;
  balance: number;
};

export function accountBalances(snapshot: Snapshot, today: Day): AccountBalance[] {
  const hi = endOfDay(today);

  return snapshot.accounts
    .filter((a) => a.active)
    .map((a) => {
      const lo = a.since ? startOfDay(a.since) : null;
      const inWindow = (ts: string) => ts <= hi && (lo === null || ts >= lo);

      // Everything that left this account: spends, bill payments, lending.
      const paidOut = snapshot.transactions
        .filter((t) => !t.deleted && t.ts && t.amount != null && t.method === a.name && inWindow(t.ts))
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const incomeIn = snapshot.income
        .filter((i) => !i.deleted && i.ts && i.amount != null && i.account === a.name && inWindow(i.ts))
        .reduce((sum, i) => sum + (i.amount ?? 0), 0);

      return {
        name: a.name,
        kind: a.kind,
        openingBalance: a.openingBalance,
        since: a.since,
        incomeIn: round2(incomeIn),
        paidOut: round2(paidOut),
        balance: round2(a.openingBalance + incomeIn - paidOut),
      };
    });
}

export type NetWorth = {
  liquid: number;
  owedToYou: number;
  cardDebt: number;
  borrowed: number;
  net: number;
  accounts: AccountBalance[];
};

/**
 * Net worth = what you hold + what is owed to you − what you owe.
 *
 * Savings and investment holdings are not included: v2 tracked them as manual
 * figures that were carried flat between updates, which made the trend look
 * like growth that never happened. They belong here once they are maintained.
 */
export function netWorth(snapshot: Snapshot, today: Day): NetWorth {
  const accounts = accountBalances(snapshot, today);
  const liquid = round2(accounts.reduce((a, x) => a + x.balance, 0));
  const owedToYou = creditLedger(snapshot, endOfDay(today)).totalOutstanding;
  const cardDebt = statementView(snapshot, today).totals.totalDebtLive;
  const borrowed = debtLedger(snapshot, today).totalOutstanding;

  return {
    liquid,
    owedToYou,
    cardDebt,
    borrowed,
    net: round2(liquid + owedToYou - cardDebt - borrowed),
    accounts,
  };
}

/** Net worth at the end of each of the last `months` months. */
export function netWorthTrend(snapshot: Snapshot, today: Day, months = 12): { month: string; total: number }[] {
  const out: { month: string; total: number }[] = [];
  let cursor = today;

  for (let i = 0; i < months; i++) {
    const key = monthKey(cursor);
    // Every month closes at its own month end, except the current one which
    // can only be measured up to today.
    const at = key === monthKey(today) ? today : monthEnd(key);
    out.push({ month: key, total: netWorth(snapshot, at).net });
    cursor = addDays(`${key}-01`, -1);
  }

  return out.reverse();
}
