'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Panel, cx } from '../../ui/primitives.tsx';

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: boolean };

const SUGGESTIONS = [
  'What do I owe right now, and what is due first?',
  'How much did I spend on food last month?',
  'Which card is costing me the most?',
  'Who still owes me money?',
  'Am I spending more this month than last?',
];

/** Tool names as a person would say them. */
const TOOL_LABELS: Record<string, string> = {
  get_card_statements: 'card statements',
  get_spending: 'spending',
  search_transactions: 'transactions',
  get_monthly_totals: 'monthly totals',
  get_this_month: 'this month',
  get_forecast: 'forecast',
  get_credit_ledger: 'credit ledger',
  get_income: 'income',
};

export function AskClient({ enabled }: { enabled: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    setInput('');
    setBusy(true);
    // Capture the history BEFORE adding this turn, so the question is not
    // duplicated (the API appends it itself).
    const history = turns
      .filter((t) => !t.error)
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: q }]);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const json = (await res.json()) as
        | { ok: true; answer: string; toolsUsed: string[] }
        | { ok: false; error: string };

      setTurns((prev) => [
        ...prev,
        json.ok
          ? { role: 'assistant', content: json.answer, tools: json.toolsUsed }
          : { role: 'assistant', content: json.error, error: true },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: 'Could not reach the server.', error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!enabled ? (
        <Panel className="border-[var(--color-warn)]">
          <p className="text-sm font-medium">Not connected yet</p>
          <p className="mt-1 text-xs text-[var(--color-ink-2)]">
            Add <code className="rounded bg-[var(--color-raised)] px-1 py-0.5">ANTHROPIC_API_KEY</code>{' '}
            to your <code className="rounded bg-[var(--color-raised)] px-1 py-0.5">.env.local</code>{' '}
            (and to the Vercel project settings) and restart the server.
          </p>
        </Panel>
      ) : null}

      {turns.length === 0 ? (
        <Panel>
          <p className="text-sm text-[var(--color-ink-2)]">
            Ask anything about your own money — in plain English. Answers are computed from your
            records by the same engine that draws the rest of the app, so nothing here is guessed.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!enabled}
                onClick={() => void send(s)}
                className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)] disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {turns.map((t, i) => (
        <div
          key={i}
          className={cx('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}
        >
          <div
            className={cx(
              'max-w-[85%] rounded-[var(--radius-card)] px-4 py-3 text-sm',
              t.role === 'user'
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                : t.error
                  ? 'border border-[var(--color-neg)] bg-[var(--color-neg-soft)] text-[var(--color-neg)]'
                  : 'border border-[var(--color-line)] bg-[var(--color-surface)]',
            )}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{t.content}</p>
            {t.tools?.length ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-2.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
                  Read
                </span>
                {t.tools.map((name) => (
                  <Badge key={name} tone="neutral">
                    {TOOL_LABELS[name] ?? name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {busy ? (
        <div className="flex justify-start">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink-3)]">
              Working through your records
              <span className="inline-flex gap-0.5">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-ink-3)]"
                    style={{ animationDelay: `${d * 150}ms` }}
                  />
                ))}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      <div ref={endRef} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="sticky bottom-20 flex gap-2 lg:bottom-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!enabled || busy}
          placeholder="Ask about your spending, cards, or who owes you…"
          aria-label="Your question"
          className="flex-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm shadow-[var(--shadow-card)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!enabled || busy || !input.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-card)] transition-opacity hover:opacity-90 disabled:opacity-40"
          aria-label="Send question"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  );
}
