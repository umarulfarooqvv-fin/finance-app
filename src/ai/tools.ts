import 'server-only';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import {
  byCategory, byMethod, byTrip, lastCompleteMonth, monthSummary, monthlySeries,
  priorWindow, spendBetween, total,
} from '../domain/analytics.ts';
import { creditLedger } from '../domain/credit.ts';
import { forecast } from '../domain/forecast.ts';
import { statementView } from '../domain/statement.ts';
import type { Day } from '../domain/time.ts';
import type { Snapshot } from '../domain/types.ts';

/* ===========================================================================
   The tools Claude may use to answer questions about Farooq's money.

   Two decisions worth stating outright:

   1. TOOLS, NOT A DUMP. 2,468 transactions will not fit usefully in a prompt,
      and a model asked to add up rupees in its head will get it wrong. Every
      figure below comes from the same engine that renders the UI, so an
      answer here and the number on the dashboard cannot disagree.

   2. READ ONLY. Nothing in this file writes, edits, or deletes. A question
      answered wrongly is a bad answer; a transaction edited wrongly is
      corrupted financial history. Adding a mutating tool would mean the model
      could alter records from a sentence typed in a chat box, so the entry
      path stays deliberately manual.
   =========================================================================== */

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD' } as const;

/** Trim a row to what is useful in an answer, and cap the volume. */
function slim(rows: { ts: string | null; amount: number | null; method: string; category: string; remarks: string; kind: string }[], limit = 60) {
  return rows.slice(0, limit).map((t) => ({
    date: t.ts?.slice(0, 10) ?? null,
    amount: t.amount,
    method: t.method,
    category: t.category,
    remarks: t.remarks,
    kind: t.kind,
  }));
}

export function buildTools(snapshot: Snapshot, today: Day) {
  const cardStatements = betaTool({
    name: 'get_card_statements',
    description:
      'Current statement position for every credit card: balance now, what is due on the current bill, the due date, unbilled spend since the statement, utilisation, and the portion of the balance that is money lent to other people. Use for any question about what is owed, what is due, or when.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const view = statementView(snapshot, today);
      return JSON.stringify({
        asOf: today,
        totals: view.totals,
        cards: view.rows.map((r) => ({
          card: r.card,
          balanceNow: r.totalDebtLive,
          dueOnThisBill: r.remainingDueBill,
          dueDate: r.cycle.dueDate,
          daysUntilDue: r.daysLeft,
          status: r.status,
          unbilled: r.unbilled,
          creditLimit: r.creditLimit,
          utilisation: r.utilization,
          lentToOthersInBalance: r.creditGivenOutstanding,
          statementDate: r.cycle.statementEnd,
        })),
      });
    },
  });

  const spending = betaTool({
    name: 'get_spending',
    description:
      'Total spending over a date range, optionally broken down by category, payment method, or trip. Spending means money consumed: card bill payments, money lent out, and transfers into savings are all excluded. Use for "how much did I spend on X", comparisons between periods, and category questions.',
    inputSchema: {
      type: 'object',
      properties: {
        from: DATE,
        to: DATE,
        groupBy: {
          type: 'string',
          enum: ['category', 'method', 'trip', 'none'],
          description: 'How to break the total down. Defaults to category.',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { from, to, groupBy = 'category' } = input as { from: string; to: string; groupBy?: string };
      const rows = spendBetween(snapshot, from, to);
      const grouped =
        groupBy === 'method' ? byMethod(rows)
        : groupBy === 'trip' ? byTrip(rows)
        : groupBy === 'none' ? []
        : byCategory(rows);
      return JSON.stringify({
        from, to,
        total: total(rows),
        transactionCount: rows.length,
        breakdown: grouped.map((g) => ({ key: g.key, total: g.total, count: g.count, sharePct: Math.round(g.share * 1000) / 10 })),
      });
    },
  });

  const searchTransactions = betaTool({
    name: 'search_transactions',
    description:
      'Find individual transactions by free text in the remarks, and/or by category, payment method, or date range. Use when the question is about specific purchases rather than totals.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to look for in the remarks, case-insensitive' },
        category: { type: 'string' },
        method: { type: 'string' },
        from: DATE,
        to: DATE,
        minAmount: { type: 'number' },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const q = input as { query?: string; category?: string; method?: string; from?: string; to?: string; minAmount?: number };
      const needle = q.query?.toLowerCase().trim();
      const hits = snapshot.transactions.filter((t) => {
        if (t.deleted || !t.ts) return false;
        if (needle && !`${t.remarks} ${t.category} ${t.method}`.toLowerCase().includes(needle)) return false;
        if (q.category && t.category !== q.category) return false;
        if (q.method && t.method !== q.method) return false;
        if (q.from && t.ts < `${q.from}T00:00:00`) return false;
        if (q.to && t.ts > `${q.to}T23:59:59`) return false;
        if (q.minAmount != null && (t.amount ?? 0) < q.minAmount) return false;
        return true;
      });
      const sorted = hits.sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
      return JSON.stringify({
        matched: hits.length,
        totalAmount: total(hits),
        // Capped: the model needs enough rows to answer, not the whole table.
        showing: Math.min(sorted.length, 60),
        transactions: slim(sorted),
      });
    },
  });

  const monthlyTotals = betaTool({
    name: 'get_monthly_totals',
    description:
      'Spending totals month by month across the whole history, for trends and month-to-month comparisons. Returns completed months only.',
    inputSchema: {
      type: 'object',
      properties: { months: { type: 'integer', description: 'How many recent months to return. Default 24.' } },
      additionalProperties: false,
    },
    run: async (input) => {
      const { months = 24 } = input as { months?: number };
      const series = monthlySeries(snapshot, { until: lastCompleteMonth(today) });
      return JSON.stringify({ months: series.slice(-Math.max(1, months)) });
    },
  });

  const thisMonth = betaTool({
    name: 'get_this_month',
    description:
      'Month-to-date summary: spent so far, daily run rate, income, days elapsed and remaining, top categories, and the same window of last month for comparison.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const m = monthSummary(snapshot, today);
      const prior = priorWindow(snapshot, today);
      return JSON.stringify({
        month: m.month,
        spentSoFar: m.spend,
        income: m.income,
        perDay: m.perDay,
        daysElapsed: m.elapsed,
        daysRemaining: m.daysRemaining,
        topCategories: m.categories.slice(0, 8),
        sameWindowLastMonth: { spend: prior.spend, from: prior.from, to: prior.to },
      });
    },
  });

  const forecastTool = betaTool({
    name: 'get_forecast',
    description:
      'Projection for the rest of the current month and the Recommended Bank Reserve (current card debt plus projected remaining spend) — how much to keep available so every bill and expected spend is covered.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => JSON.stringify(forecast(snapshot, today)),
  });

  const credit = betaTool({
    name: 'get_credit_ledger',
    description:
      'Money Farooq has lent to other people: per person, how much was given, how much came back, and what is still outstanding. Repayments are matched oldest-lending-first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const l = creditLedger(snapshot);
      return JSON.stringify({
        totalGiven: l.totalGiven,
        totalRepaid: l.totalRepaid,
        totalOutstanding: l.totalOutstanding,
        people: l.people.slice(0, 40).map((p) => ({
          person: p.person, given: p.given, repaid: p.repaid,
          outstanding: p.outstanding, settled: p.settled, lastActivity: p.lastActivity,
        })),
        caveat:
          'Repayments are only known when they were recorded as income or as a Credit Return row. Cash repaid without being logged still shows as outstanding.',
      });
    },
  });

  const income = betaTool({
    name: 'get_income',
    description: 'Income received in a date range, grouped by source.',
    inputSchema: {
      type: 'object',
      properties: { from: DATE, to: DATE },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { from, to } = input as { from: string; to: string };
      const rows = snapshot.income.filter(
        (i) => !i.deleted && i.ts && i.ts >= `${from}T00:00:00` && i.ts <= `${to}T23:59:59`,
      );
      const bySource = new Map<string, number>();
      for (const r of rows) bySource.set(r.source || 'Unknown', (bySource.get(r.source || 'Unknown') ?? 0) + (r.amount ?? 0));
      return JSON.stringify({
        from, to,
        total: Math.round(rows.reduce((a, r) => a + (r.amount ?? 0), 0) * 100) / 100,
        bySource: [...bySource.entries()].map(([source, amount]) => ({ source, amount: Math.round(amount * 100) / 100 })),
        rows: rows.slice(0, 40).map((r) => ({ date: r.ts?.slice(0, 10), amount: r.amount, source: r.source, account: r.account, remarks: r.remarks })),
      });
    },
  });

  return [cardStatements, spending, searchTransactions, monthlyTotals, thisMonth, forecastTool, credit, income];
}

/** Facts the model should not have to ask for. */
export function systemPrompt(snapshot: Snapshot, today: Day): string {
  const first = snapshot.transactions.find((t) => t.ts)?.ts?.slice(0, 10) ?? 'unknown';
  return [
    "You are the assistant inside Farooq's personal finance app. You answer questions about his own money using the tools provided.",
    '',
    `Today is ${today}. All amounts are Indian rupees (INR), all dates are IST.`,
    `The records run from ${first} to now and contain ${snapshot.transactions.length} transactions and ${snapshot.income.length} income entries.`,
    '',
    'How to answer:',
    '- Always use a tool to get figures. Never estimate, never do arithmetic from memory, and never invent a number that a tool did not return.',
    '- Lead with the answer, then the supporting detail. Two or three sentences is usually right; use a short list when comparing several things.',
    '- Format money as ₹ with Indian digit grouping, e.g. ₹1,23,456.78.',
    '- "Spending" excludes credit-card bill payments, money lent to other people, and transfers into savings or investments. Say so if it matters to the answer.',
    '- Relative dates resolve against today. "Last month" means the previous calendar month.',
    '',
    'Be honest about the data:',
    '- If a tool returns nothing for the period asked about, say the records are empty for it rather than implying nothing was spent.',
    '- Money lent out is only shown as repaid when the repayment was recorded. Cash handed back without being logged still reads as outstanding, so treat large outstanding balances as "not recorded as repaid" rather than as certainly unpaid.',
    '- You have read-only access. If asked to add, change or delete anything, explain that entries are made through the app or the iPhone Shortcut.',
  ].join('\n');
}
