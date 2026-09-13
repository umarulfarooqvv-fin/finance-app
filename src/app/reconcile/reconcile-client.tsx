'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, FileWarning } from 'lucide-react';
import { parseStatement } from '@/lib/statement-parse';
import { reconcileStatement, type AppEntry, type Match } from '@/lib/statement-match';
import { formatDayShort } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { Badge, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';

/* ===========================================================================
   The paste box and the result.

   Everything here runs in the browser. The statement text is never sent
   anywhere: it is parsed and matched locally, so a document listing every
   card transaction of the month stays on the device it was pasted into.

   The results are ordered by what is worth acting on. "Charged but not
   recorded" comes first, because that is the question the page is for — a fee
   the bank added, a subscription that renewed, a transaction that was never
   yours. Everything that reconciled cleanly is collapsed underneath it.
   =========================================================================== */

const PLACEHOLDER = `Paste the statement rows here. Anything works:

| 12/08/2026 | SWIGGY BANGALORE | 450.00 |
14/08/2026, INDIAN OIL, 2,011.80
20-Aug-2026  ANNUAL FEE  590.00
25/08/2026  PAYMENT RECEIVED  25,159.26 Cr`;

export function ReconcileClient({
  entries, card, periodYear,
}: {
  entries: AppEntry[];
  card: string;
  periodYear: number;
}) {
  const [text, setText] = useState('');
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [tolerance, setTolerance] = useState(4);
  const [submitted, setSubmitted] = useState('');

  const parsed = useMemo(
    () => parseStatement(submitted, { dateOrder, assumeYear: periodYear }),
    [submitted, dateOrder, periodYear],
  );

  const result = useMemo(
    () => reconcileStatement(parsed.lines, entries, { tolerance }),
    [parsed.lines, entries, tolerance],
  );

  const hasRun = submitted.trim().length > 0;

  return (
    <>
      <Panel className="mb-4">
        <SectionTitle>Paste the statement</SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          Copy the rows out of the PDF, or ask any assistant to extract them. The text stays in your
          browser — it is matched here and never sent anywhere.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          aria-label="Statement rows"
          className={cx(inputClass(), 'min-h-[9rem] resize-y font-mono text-[11px] leading-relaxed')}
        />

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Date order</span>
            <select
              value={dateOrder}
              onChange={(e) => setDateOrder(e.target.value as 'dmy' | 'mdy')}
              className={inputClass()}
            >
              <option value="dmy">Day first (12/08 = 12 Aug)</option>
              <option value="mdy">Month first (12/08 = 8 Dec)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Allow posting delay</span>
            <select
              value={String(tolerance)}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className={inputClass()}
            >
              {[0, 2, 4, 7, 10].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'Same day only' : `${n} days`}</option>
              ))}
            </select>
          </label>

          <Button type="button" onClick={() => setSubmitted(text)} disabled={!text.trim()}>
            Match against {card}
          </Button>
          {hasRun ? (
            <Button type="button" variant="ghost" onClick={() => { setText(''); setSubmitted(''); }}>
              Clear
            </Button>
          ) : null}
        </div>
      </Panel>

      {!hasRun ? null : (
        <>
          <Panel className="mb-4">
            <SectionTitle>The difference</SectionTitle>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Statement charges" value={result.totals.statementDebit} />
              <Figure label="Recorded here" value={result.totals.appDebit} />
              <Figure
                label="Unexplained"
                value={result.totals.debitDifference}
                tone={result.totals.debitDifference === 0 ? 'muted' : 'debt'}
              />
              <Figure label="Payments &amp; refunds" value={result.totals.statementCredit} tone="credit" />
            </div>

            <p className="mt-4 flex items-start gap-2 border-t border-[var(--color-line)] pt-4 text-xs">
              {result.totals.debitDifference === 0 && result.statementOnly.length === 0 ? (
                <>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-pos)]" aria-hidden="true" />
                  <span className="text-[var(--color-pos)]">
                    Every charge on the statement has an entry behind it, and the totals agree.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
                  <span className="text-[var(--color-ink-2)]">
                    The statement charges{' '}
                    <span className="sensitive num font-semibold">
                      {result.totals.debitDifference >= 0 ? '' : '−'}
                      {Math.abs(result.totals.debitDifference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>{' '}
                    {result.totals.debitDifference >= 0 ? 'more' : 'less'} than this app has recorded
                    for the period.
                  </span>
                </>
              )}
            </p>

            {parsed.ambiguousDates > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-[11px] text-[var(--color-warn)]">
                <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {parsed.ambiguousDates}{' '}
                  {parsed.ambiguousDates === 1 ? 'date could' : 'dates could'} be read either way
                  round — check the date order above if the matches look wrong.
                </span>
              </p>
            ) : null}
          </Panel>

          {parsed.skipped.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>
                {parsed.skipped.length} {parsed.skipped.length === 1 ? 'line' : 'lines'} could not be read
              </SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                These were not counted in anything above. Shown so they can be fixed in the paste
                rather than quietly missing from the comparison.
              </p>
              <ul className="flex flex-col gap-1">
                {parsed.skipped.map((s) => (
                  <li key={s.line} className="flex items-start gap-2 text-[11px]">
                    <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                    <span className="num shrink-0 text-[var(--color-ink-3)]">line {s.line}</span>
                    <code className="min-w-0 flex-1 truncate">{s.raw}</code>
                    <span className="shrink-0 text-[var(--color-ink-3)]">{s.why}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel className="mb-4">
            <SectionTitle>
              Charged by the bank, not recorded here
              {result.statementOnly.length > 0 ? ` · ${result.statementOnly.length}` : ''}
            </SectionTitle>
            {result.statementOnly.length === 0 ? (
              <p className="text-xs text-[var(--color-pos)]">
                Nothing. Every charge on the statement is accounted for.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                  This is the list worth reading. A fee, a renewal, or a transaction that was never
                  yours will be here.
                </p>
                <ul className="flex flex-col">
                  {result.statementOnly.map((l) => (
                    <li key={l.line} className="flex items-center gap-3 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                      <span className="num w-24 shrink-0 text-xs text-[var(--color-ink-3)]">
                        {formatDayShort(l.day)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.description}</span>
                      {l.direction === 'credit' ? <Badge tone="good">credit</Badge> : null}
                      <span className="w-28 shrink-0 text-right">
                        <Money value={l.amount} size="sm" tone={l.direction === 'credit' ? 'credit' : 'debt'} />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          {result.appOnly.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Recorded here, not on the statement · {result.appOnly.length}</SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                Either it has not posted yet, it belongs to a different statement, or it was entered
                against the wrong card.
              </p>
              <ul className="flex flex-col">
                {result.appOnly.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                    <span className="num w-24 shrink-0 text-xs text-[var(--color-ink-3)]">
                      {formatDayShort(e.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.description}</span>
                    {e.direction === 'credit' ? <Badge tone="good">credit</Badge> : null}
                    <span className="w-28 shrink-0 text-right">
                      <Money value={e.amount} size="sm" tone={e.direction === 'credit' ? 'credit' : 'debt'} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {result.ambiguous.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Could be matched more than one way · {result.ambiguous.length}</SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                More than one combination fitted these exactly. Nothing was chosen, because picking
                one would hide whichever rows it left out.
              </p>
              <ul className="flex flex-col gap-2">
                {result.ambiguous.map((a, i) => (
                  <li key={i} className="rounded-[var(--radius-field)] border border-[var(--color-line)] p-2 text-[11px]">
                    <div className="text-[var(--color-ink-3)]">Statement</div>
                    {a.statement.map((l) => (
                      <div key={l.line} className="flex justify-between gap-3">
                        <span className="truncate">{formatDayShort(l.day)} · {l.description}</span>
                        <Money value={l.amount} size="sm" />
                      </div>
                    ))}
                    <div className="mt-1 text-[var(--color-ink-3)]">Here</div>
                    {a.app.map((e) => (
                      <div key={e.id} className="flex justify-between gap-3">
                        <span className="truncate">{formatDayShort(e.day)} · {e.description}</span>
                        <Money value={e.amount} size="sm" />
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle>Matched · {result.matches.length}</SectionTitle>
            {result.matches.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-3)]">Nothing matched.</p>
            ) : (
              <ul className="flex flex-col">
                {result.matches.map((m, i) => <MatchRow key={i} match={m} />)}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Figure({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'debt' | 'credit' | 'muted' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">{label}</div>
      <div className="mt-1"><Money value={value} tone={tone} size="lg" /></div>
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  const grouped = match.kind === 'grouped';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
      <span className="num w-24 shrink-0 text-xs text-[var(--color-ink-3)]">
        {formatDayShort(match.statement[0]!.day)}
      </span>

      <span className="min-w-0 flex-1 truncate">
        {match.statement.map((l) => l.description).join(' + ')}
      </span>

      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />

      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-2)]">
        {match.app.map((e) => e.description).join(' + ')}
      </span>

      {grouped ? <Badge tone="accent">{match.statement.length}&rarr;{match.app.length}</Badge> : null}
      {match.kind === 'near' ? <Badge tone="neutral">{match.dayGap}d later</Badge> : null}

      <span className="w-28 shrink-0 text-right">
        <Money value={match.total} size="sm" />
      </span>
    </li>
  );
}
