'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, CreditCard, FileWarning, Link2,
  Plus, Undo2, Wand2, Wand,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  parseStatement, parseStatementSummary, type StatementLine,
} from '@/lib/statement-parse';
import {
  chargeFlag, findOnOtherMethods, reconcileStatement, suggestFor,
  type AppEntry,
} from '@/lib/statement-match';
import { formatDayShort } from '@/lib/time';
import type { MisfiledCandidate } from '@/lib/misfiled';
import { round2 } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { Badge, Dot, Empty, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { reassignMethodAction } from './actions';
import { recordSummaryAction } from '@/app/cards/[name]/actions';
import { StatementPromptCard } from './prompt-card';
import { TransactionDialog } from '@/app/transactions/transaction-dialog';
import { describeMerged, describeStatementLine } from '@/lib/statement-describe';

/* ===========================================================================
   Reconciling a pasted statement, line by line.

   Everything runs in the browser. The statement text is never sent anywhere:
   a document listing every card transaction of the month stays on the device
   it was pasted into.

   The page is built around ONE NUMBER — what is still unexplained — and that
   number falls as rows get paired off. Automatic matching resolves the
   obvious ones; the rest are paired by hand, with suggestions, until the
   figure reaches zero or the remainder is something worth asking the bank
   about. A reconciliation that only ever showed a static verdict left the
   hard part exactly where it started.
   =========================================================================== */

const PLACEHOLDER = `Paste the statement rows. Anything works — copy straight out of a spreadsheet:

25/08/2026	SWIGGY BANGALORE	450.00
25/08/2026	ANNUAL MEMBERSHIP FEE	590.00
26/08/2026	IGST @18%	106.20`;

/** A pairing made by hand. Statement lines and entries are held by identity. */
type ManualLink = { id: string; statement: StatementLine[]; app: AppEntry[] };

/**
 * One of this card's own entries for the period.
 *
 * `method` is where the money came FROM, which for a spend is this card itself
 * — a charge on a card is filed against that card, so the two agree. A bill
 * payment is the exception: it lands ON this card but is paid FROM a bank
 * account. That is the only way an entry here carries a different method, and
 * it is worth showing rather than leaving to be assumed.
 */
export type CardEntry = AppEntry & { method: string; methodColor: string | null };

export function ReconcileClient({
  entries, elsewhere, methods, card, periodYear, statementDate,
}: {
  entries: CardEntry[];
  /** Entries in the same window filed against a different method. */
  elsewhere: MisfiledCandidate[];
  methods: string[];
  card: string;
  periodYear: number;
  /** The cycle being checked — where a summary read off the paste is saved. */
  statementDate: string;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [moving, setMoving] = useState<string | null>(null);

  /* Move an entry onto (or off) this card. The page then re-reads, so a row
     that was misfiled simply matches on the next render rather than needing
     to be paired by hand. */
  function move(id: string, method: string, label: string) {
    setMoving(id);
    void reassignMethodAction({ id, method }).then((result) => {
      setMoving(null);
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', `${label} moved to ${method}.`);
      router.refresh();
    });
  }
  const [text, setText] = useState('');
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [tolerance, setTolerance] = useState(4);
  const [submitted, setSubmitted] = useState('');

  const [links, setLinks] = useState<ManualLink[]>([]);
  const [pickedLines, setPickedLines] = useState<Set<number>>(new Set());
  const [pickedApp, setPickedApp] = useState<Set<string>>(new Set());
  const [suggestFor_, setSuggestFor] = useState<number | null>(null);
  /* Whether the right-hand column lists only what is already on this card, or
     EVERY entry in the billing period whatever it was filed against.

     "All methods" is the view that matches how the mistake actually happens:
     the spend was made on this card and typed against another, so it is not in
     the card's own list to be found. Seeing the whole period side by side with
     the statement is the only way to spot it. */
  const [showAll, setShowAll] = useState(false);
  /* Whether a MATCHED entry is shown too, in green, or left out entirely as it
     is by default.

     Once an entry is matched it disappears from this column — the whole point
     of the column is what is still unpaired. But that also means there is no
     way here to see the shape of the whole cycle: which of this card's own
     entries the statement actually confirms, and which dates have nothing
     confirming them, at a glance rather than by cross-checking a separate
     list at the foot of the page. Optional, because most of the time the
     unpaired leftovers are the only thing worth looking at. */
  const [showMatched, setShowMatched] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  /* Proposals the user has taken OFF the table. Only the rejections are held,
     so a newly found proposal is offered by default rather than needing to be
     opted into every time the statement is re-matched. */
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [recovering, setRecovering] = useState(false);

  /* The statement line being turned into an entry, if any. Held as the line
     itself rather than as a prepared draft: the draft is derived from it, so
     re-opening the dialog cannot show a stale reading of a different row. */
  const [adding, setAdding] = useState<StatementLine[] | null>(null);

  /* Statement lines ticked to become ONE entry. A bank splits what this ledger
     keeps whole — an EMI instalment arrives as principal, interest and the tax
     on the interest — so the list has to be able to put them back together.
     Held by line number, and cleared whenever the paste is re-matched, because
     a number that survived a re-parse would point at a different row. */
  const [merging, setMerging] = useState<Set<number>>(new Set());

  const parsed = useMemo(
    () => parseStatement(submitted, { dateOrder, assumeYear: periodYear }),
    [submitted, dateOrder, periodYear],
  );

  /* The same paste, read for its summary box as well as its rows. Line
     matching says whether every charge is accounted for; only these four
     figures say whether the BALANCE is, and a wrong balance comes from an
     earlier cycle where this month's lines all match. */
  const summary = useMemo(() => parseStatementSummary(submitted), [submitted]);
  const [savingSummary, setSavingSummary] = useState(false);
  const [savedSummary, setSavedSummary] = useState(false);

  async function saveSummary() {
    if (!summary) return;
    setSavingSummary(true);
    const r = await recordSummaryAction({
      card, statementDate,
      previousBalance: summary.previousBalance,
      charges: summary.charges,
      payments: summary.payments,
      totalDue: summary.totalDue,
    });
    setSavingSummary(false);
    if (!r.ok) { notify('error', r.error); return; }
    setSavedSummary(true);
    notify('success', `Statement summary recorded for ${card}.`);
    router.refresh();
  }

  const auto = useMemo(
    () => reconcileStatement(parsed.lines, entries, { tolerance }),
    [parsed.lines, entries, tolerance],
  );

  /* What is left after BOTH automatic matching and everything paired by hand.
     Derived, never stored: a remainder held in state drifts out of step with
     the links that produced it the first time anything is undone. */
  const linkedLines = useMemo(
    () => new Set(links.flatMap((l) => l.statement.map((s) => s.line))),
    [links],
  );
  const linkedApp = useMemo(
    () => new Set(links.flatMap((l) => l.app.map((a) => a.id))),
    [links],
  );

  const openLines = auto.statementOnly.filter((l) => !linkedLines.has(l.line));
  const openApp = auto.appOnly.filter((e) => !linkedApp.has(e.id));

  const sum = (xs: { amount: number }[]) => round2(xs.reduce((a, x) => a + x.amount, 0));
  const signed = (xs: { amount: number; direction: string }[]) =>
    round2(xs.reduce((a, x) => a + (x.direction === 'credit' ? -x.amount : x.amount), 0));

  const remaining = round2(signed(openLines) - signed(openApp));
  const started = round2(signed(auto.statementOnly) - signed(auto.appOnly));

  /* THE GROSS COMPARISON: what the bank says this cycle cost, what the app has
     against the card, and the gap. Before any matching, over every row on both
     sides — which is why it is NOT the same number as `remaining`, and why the
     two are labelled differently and reconciled in words below.

     Charges and repayments are compared SEPARATELY. Netting them would let a
     missing 5,000 charge and a missing 5,000 payment cancel out and report a
     cycle that balances, which is the one thing this page exists to catch. */
  const chargeGap = auto.totals.debitDifference;   // bank - app, charges
  const creditGap = auto.totals.creditDifference;  // bank - app, payments in
  const hasCredits = auto.totals.statementCredit > 0.005 || auto.totals.appCredit > 0.005;
  const countBy = (xs: { direction: string }[], d: string) =>
    xs.filter((x) => x.direction === d).length;

  /* The gross gap and the working figure agree when every pairing is exact and
     nothing was refunded, and part company otherwise. Two totals on one screen
     that look like they should match and do not is worse than either alone, so
     when they differ the page says why rather than leaving it to be noticed. */
  const gapsDiffer = Math.abs(chargeGap - remaining) > 0.005;
  /* Only blame repayments when an unmatched one is actually contributing. A
     repayment that matched is in neither open pile and moves neither figure,
     so naming it as a cause would send the reader looking for something that
     is not there. */
  const creditsOpen =
    countBy(openLines, 'credit') + countBy(openApp, 'credit') > 0;

  /* Entries filed elsewhere that are not already paired off by hand. The
     matcher never sees these — auto-matching must only ever consider entries
     actually on this card — but the list and the selection do. */
  const openElsewhere = elsewhere.filter((e) => !linkedApp.has(e.id));

  /* Every entry the automatic pass already confirmed against a statement
     line. `entries` is the FULL set for this card and this period — appOnly
     is only the leftover — so this is entries minus openApp, computed the
     other way round rather than tracked separately, which is what keeps it
     from drifting out of step as matching re-runs on every keystroke. */
  const matchedAppIds = useMemo(
    () => new Set(auto.matches.flatMap((m) => m.app.map((a) => a.id))),
    [auto.matches],
  );
  const matchedEntries = useMemo(
    () => entries.filter((e) => matchedAppIds.has(e.id)),
    [entries, matchedAppIds],
  );

  /* Which method each matched entry actually came off, looked up by id rather
     than threaded through the matcher. The engine is pure and has no business
     knowing about payment methods; making it generic over the entry type to
     carry one through would complicate a tested module for a display detail. */

  /* HOW MUCH OF THE BILL THESE MATCHES ACCOUNT FOR.

     Measured on the STATEMENT side, because the question is what share of the
     bank's own figure is explained — the app side would answer a different
     question and, where a pairing is a few rupees out, a different number.

     Charges and repayments counted apart, for the reason they are everywhere
     else on this page: a matched repayment explains no charge, and rolling the
     two together would report a bill as better covered than it is. */
  const matchedLines = useMemo(() => auto.matches.flatMap((m) => m.statement), [auto.matches]);
  const coveredDebit = round2(
    matchedLines.filter((l) => l.direction === 'debit').reduce((a, l) => a + l.amount, 0),
  );
  const coveredCredit = round2(
    matchedLines.filter((l) => l.direction === 'credit').reduce((a, l) => a + l.amount, 0),
  );
  const coverShare =
    auto.totals.statementDebit > 0.005 ? coveredDebit / auto.totals.statementDebit : 0;

  const cardPool = showMatched ? [...openApp, ...matchedEntries] : openApp;
  const pool: (AppEntry & { method?: string })[] = (showAll ? [...cardPool, ...openElsewhere] : cardPool)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  /* THE SWEEP: for every statement line the proper pass could not explain,
     is there an entry filed under some other method that looks exactly like
     it? Run after the real reconciliation, never as part of it, and it only
     ever proposes — see findOnOtherMethods for why both of those matter. */
  const recoveries = useMemo(
    () => findOnOtherMethods(openLines, openElsewhere, { tolerance }),
    [openLines, openElsewhere, tolerance],
  );
  const byId = useMemo(() => new Map(openElsewhere.map((e) => [e.id, e])), [openElsewhere]);
  const proposals = recoveries
    .map((r) => ({ ...r, entry: byId.get(r.entryId) }))
    .filter((r): r is typeof r & { entry: MisfiledCandidate } => Boolean(r.entry));
  const accepted = proposals.filter((r) => !rejected.has(r.entryId));
  const proposedIds = useMemo(() => new Set(proposals.map((p) => p.entryId)), [proposals]);
  /* Membership of the elsewhere pool, by identity.

     NOT `e.method !== card`, which is a different question with a different
     answer. A bill payment is ON this card and paid FROM a bank account, so it
     sits in the card's own entries with a method that differs — reading the
     method would file it as misplaced and offer to "correct" it onto this
     card, rewriting it to say the card paid its own bill. It is in `entries`
     precisely because it belongs there, so ask the list, not the field. */
  const elsewhereIds = useMemo(() => new Set(openElsewhere.map((e) => e.id)), [openElsewhere]);
  const acceptedTotal = sum(accepted.map((r) => r.entry));

  /* THE ONE LIST.

     Every parsed line, in the order the bank printed it, each carrying what
     became of it and the single thing left to do about it. Before this the
     same line could appear in three panels at once — once in the charges it
     was flagged as, once in the pairing grid, once in "not recorded here" —
     and reading the page meant working out that they were the same row.

     Priority is deliberate. A line with an entry sitting under the wrong
     method must offer to MOVE that entry, never to add one: adding would
     leave the spend recorded twice, which is the error this page exists to
     find. So a proposal outranks the draft, and matched outranks everything.  */
  const lineStates = useMemo(() => {
    const matchedLineNos = new Set(auto.matches.flatMap((m) => m.statement.map((s) => s.line)));
    const proposalFor = new Map(proposals.map((p) => [p.line.line, p]));
    return parsed.lines.map((line) => ({
      line,
      matched: matchedLineNos.has(line.line),
      pairedByHand: linkedLines.has(line.line),
      proposal: proposalFor.get(line.line) ?? null,
    }));
  }, [parsed.lines, auto.matches, proposals, linkedLines]);

  /* This card's own entries with nothing on the statement against them. The
     other half of the same question: the statement list asks what the bank
     billed that the app has not got, this asks what the app has that the bank
     did not bill. Entries filed elsewhere are not here — they are not on this
     card, so their absence from its statement means nothing. */
  const unbilled = openApp.filter((e) => !elsewhereIds.has(e.id));

  /* The rows ticked to be merged, and what they would become. Both derived
     from `merging` rather than stored, so a tick and an untick cannot leave a
     total that no longer matches the rows it claims to add up. */
  const mergeLines = useMemo(
    () => parsed.lines.filter((l) => merging.has(l.line)),
    [parsed.lines, merging],
  );
  const mergeTotal = round2(mergeLines.reduce((a, l) => a + l.amount, 0));
  /* A charge and a refund never merge: summing opposite directions gives a
     number that is neither, and the bar would offer to save it. */
  const mergeMixed = new Set(mergeLines.map((l) => l.direction)).size > 1;

  const merged = useMemo(
    () => (adding && adding.length > 0 ? describeMerged(adding, card) : null),
    [adding, card],
  );

  async function acceptProposals() {
    if (accepted.length === 0) return;
    setRecovering(true);
    let moved = 0;
    for (const r of accepted) {
      const result = await reassignMethodAction({ id: r.entryId, method: card });
      if (result.ok) moved++;
      else notify('error', `${r.entry.description}: ${result.error}`);
    }
    setRecovering(false);
    if (moved > 0) {
      notify('success', `${moved} ${moved === 1 ? 'entry' : 'entries'} moved to ${card}.`);
      router.refresh();
    }
  }

  const selectedLines = openLines.filter((l) => pickedLines.has(l.line));
  const selectedApp = openApp.filter((e) => pickedApp.has(e.id));
  /* Selected rows that are filed against something else. These cannot simply
     be "linked" — they have to be moved onto this card first, or the pairing
     would claim a charge this card never carried. */
  const selectedElsewhere = openElsewhere.filter((e) => pickedApp.has(e.id));

  async function moveSelected() {
    if (selectedElsewhere.length === 0) return;
    setBulkMoving(true);
    let moved = 0;
    for (const e of selectedElsewhere) {
      const result = await reassignMethodAction({ id: e.id, method: card });
      if (result.ok) moved++;
      else notify('error', `${e.description}: ${result.error}`);
    }
    setBulkMoving(false);
    setPickedApp(new Set());
    if (moved > 0) {
      notify('success', `${moved} ${moved === 1 ? 'entry' : 'entries'} moved to ${card}.`);
      router.refresh();
    }
  }
  const selectionGap = round2(sum(selectedLines) - sum(selectedApp));
  const canLink = selectedLines.length > 0 && selectedApp.length > 0;

  function link() {
    if (!canLink) return;
    setLinks((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, statement: selectedLines, app: selectedApp },
    ]);
    setPickedLines(new Set());
    setPickedApp(new Set());
    setSuggestFor(null);
  }

  function unlink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function applySuggestion(line: StatementLine, app: AppEntry[]) {
    setLinks((prev) => [...prev, { id: `m-${Date.now()}`, statement: [line], app }]);
    setSuggestFor(null);
    setPickedLines(new Set());
    setPickedApp(new Set());
  }

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const hasRun = submitted.trim().length > 0;


  return (
    <>
      <Panel className="mb-4">
        <SectionTitle>Paste the statement</SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          Copy the rows out of a spreadsheet, a PDF, or whatever an assistant gives you. Columns are
          read properly, so a running-balance column or a reference number is not mistaken for the
          amount. The text stays in your browser.
        </p>

        <StatementPromptCard />

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
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Posting delay</span>
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

          <Button
            type="button"
            onClick={() => { setSubmitted(text); setLinks([]); setPickedLines(new Set()); setPickedApp(new Set()); setMerging(new Set()); }}
            disabled={!text.trim()}
          >
            Match against {card}
          </Button>
          {hasRun ? (
            <Button
              type="button" variant="ghost"
              onClick={() => { setText(''); setSubmitted(''); setLinks([]); setMerging(new Set()); }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </Panel>

      {!hasRun ? null : (
        <>
          {/* ---- The one number ------------------------------------------ */}
          <Panel className="mb-4">
            <SectionTitle>Still unexplained</SectionTitle>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Money
                value={Math.abs(remaining)}
                size="display"
                tone={Math.abs(remaining) < 0.005 ? 'credit' : 'debt'}
              />
              {Math.abs(started) > 0.005 ? (
                <span className="text-xs text-[var(--color-ink-3)]">
                  started at <span className="sensitive num">{Math.abs(started).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  {links.length > 0 ? ` · ${links.length} paired by hand` : ''}
                </span>
              ) : null}
            </div>

            <p className="mt-3 flex items-start gap-2 border-t border-[var(--color-line)] pt-3 text-xs">
              {Math.abs(remaining) < 0.005 ? (
                <>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-pos)]" aria-hidden="true" />
                  <span className="text-[var(--color-pos)]">
                    Every line on the statement is accounted for. This cycle reconciles.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
                  <span className="text-[var(--color-ink-2)]">
                    {openLines.length} statement {openLines.length === 1 ? 'line' : 'lines'} and{' '}
                    {openApp.length} {openApp.length === 1 ? 'entry' : 'entries'} still to pair.
                  </span>
                </>
              )}
            </p>

            {/* ---- What the bank says, what the app says, and the gap ---- */}
            <div className="mt-3 border-t border-[var(--color-line)] pt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                  Charges &middot; the bank against this app
                </span>
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  {auto.matches.length} matched automatically
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Tile
                  label="The bank charged"
                  value={auto.totals.statementDebit}
                  note={`${countBy(parsed.lines, 'debit')} on the statement`}
                />
                <Tile
                  label={`Recorded on ${card}`}
                  value={auto.totals.appDebit}
                  note={`${countBy(entries, 'debit')} in the app`}
                />
                <Tile
                  label="Difference"
                  value={Math.abs(chargeGap)}
                  tone={Math.abs(chargeGap) < 0.005 ? 'credit' : 'debt'}
                  flag={Math.abs(chargeGap) >= 0.005}
                  note={
                    Math.abs(chargeGap) < 0.005
                      ? 'the totals agree'
                      : chargeGap > 0
                        ? 'the bank charged more'
                        : 'more recorded than billed'
                  }
                />
              </div>

              {hasCredits ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-field)] border border-[var(--color-line)] px-2.5 py-2 text-[11px] text-[var(--color-ink-3)]">
                  <span className="font-medium uppercase tracking-wider">Payments &amp; refunds</span>
                  <span>
                    bank <Money value={auto.totals.statementCredit} size="sm" tone="credit" />
                  </span>
                  <span>
                    app <Money value={auto.totals.appCredit} size="sm" tone="credit" />
                  </span>
                  <span>
                    difference{' '}
                    <Money
                      value={Math.abs(creditGap)}
                      size="sm"
                      tone={Math.abs(creditGap) < 0.005 ? 'credit' : 'debt'}
                    />
                  </span>
                </div>
              ) : null}

              {gapsDiffer ? (
                <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
                  Still unexplained is{' '}
                  <Money value={Math.abs(remaining)} size="sm" tone="muted" /> rather than this,
                  because pairing settles rows that are not identical to the rupee
                  {creditsOpen ? ', and repayments are netted off there but counted apart here' : ''}.
                </p>
              ) : null}
            </div>

            {parsed.ambiguousDates > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-[11px] text-[var(--color-warn)]">
                <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {parsed.ambiguousDates} {parsed.ambiguousDates === 1 ? 'date' : 'dates'} could be
                  read either way round — check the date order if matches look wrong.
                </span>
              </p>
            ) : null}
          </Panel>

          {/* ---- The statement, once, with what became of each line ------ */}
          <Panel className="mb-4">
            <SectionTitle>The statement &middot; {parsed.lines.length} {parsed.lines.length === 1 ? 'line' : 'lines'}</SectionTitle>
            <p className="mb-2 text-xs text-[var(--color-ink-2)]">
              Every row the bank printed, in its order, and what this app has against it.
            </p>

            <div className="mb-3 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-xs text-[var(--color-ink-2)]">
                  Covers <Money value={coveredDebit} size="sm" tone="credit" className="font-semibold" />
                  {' of the '}
                  <Money value={auto.totals.statementDebit} size="sm" /> charged
                </span>
                <span className="num text-sm font-semibold text-[var(--color-pos)]">
                  {Math.round(coverShare * 100)}%
                </span>
              </div>

              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-raised)]"
                role="meter"
                aria-valuenow={Math.round(coverShare * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Share of the statement's charges matched automatically"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-pos)] transition-[width]"
                  style={{ width: `${Math.min(100, coverShare * 100)}%` }}
                />
              </div>

              <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
                Leaving{' '}
                <Money
                  value={round2(auto.totals.statementDebit - coveredDebit)}
                  size="sm"
                  tone="debt"
                />{' '}
                of charges to account for
                {coveredCredit > 0.005 ? (
                  <>
                    {'. Repayments are counted apart: '}
                    <Money value={coveredCredit} size="sm" tone="credit" /> of{' '}
                    <Money value={auto.totals.statementCredit} size="sm" /> matched — a
                    repayment explains no charge, so rolling the two together would report
                    this bill as better covered than it is
                  </>
                ) : null}
                .
              </p>
            </div>

            {/* Ticked rows, and the one entry they would become. Appears only
                once something is ticked: an empty bar would be a permanent
                instruction on a page most people never need it on. */}
            {mergeLines.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-xs text-[var(--color-ink-2)]">
                  {mergeLines.length} {mergeLines.length === 1 ? 'line' : 'lines'} ticked
                  {mergeMixed ? (
                    <span className="text-[var(--color-warn)]">
                      {' '}— a charge and a repayment cannot be one entry. Untick one of them.
                    </span>
                  ) : (
                    <>
                      {', adding up to '}
                      <Money value={mergeTotal} size="sm" className="font-semibold" />
                      {mergeLines.length > 1 ? ' — one entry, the way this ledger keeps it.' : ''}
                    </>
                  )}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setMerging(new Set())}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  disabled={mergeMixed}
                  onClick={() => setAdding(mergeLines)}
                >
                  Add as one entry
                </Button>
              </div>
            ) : null}

            <ul className="flex flex-col">
              {lineStates.map((st) => (
                <StatementRow
                  key={st.line.line}
                  state={st}
                  card={card}
                  moving={moving}
                  ticked={merging.has(st.line.line)}
                  onTick={() => toggle(merging, st.line.line, setMerging)}
                  onAdd={() => setAdding([st.line])}
                  onMove={(id) => move(id, card, st.line.description)}
                />
              ))}
            </ul>
          </Panel>

          {/* ---- The other half of the question --------------------------- */}
          {unbilled.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Not on the statement &middot; {unbilled.length}</SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                Recorded on {card} in this period, but the bank did not bill it. Either it belongs
                on another method, or it has not been billed yet.
              </p>
              <ul className="flex flex-col">
                {unbilled.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                    <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                      {formatDayShort(e.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.description}</span>
                    <Money value={e.amount} size="sm" tone={e.direction === 'credit' ? 'credit' : 'debt'} />
                    <select
                      value=""
                      disabled={moving === e.id}
                      aria-label={`Move ${e.description} to another payment method`}
                      onChange={(ev) => ev.target.value && move(e.id, ev.target.value, e.description)}
                      className={cx(inputClass(), 'w-[6.5rem] shrink-0 text-[11px]')}
                    >
                      <option value="">Move to&hellip;</option>
                      {methods.filter((m) => m !== card).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {/* ---- Everything a normal reconciliation never needs ------------

               Folded, not deleted. These are the tools for the statement that
               will NOT reconcile — pairing a split charge by hand, sweeping
               other methods, reading the bank's own summary against the rows.
               Each was asked for and each earns its place on the day it is
               needed, which is not most days. Open on its own when something
               inside it has already found something worth acting on. */}
          <details
            className="mb-4 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            open={proposals.length > 0 || links.length > 0 || parsed.skipped.length > 0}
          >
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[var(--color-ink-2)] marker:text-[var(--color-ink-3)]">
              More tools
              {proposals.length > 0 ? (
                <span className="ml-2 text-[var(--color-accent)]">
                  {proposals.length} possibly on {card}
                </span>
              ) : null}
            </summary>
            <div className="border-t border-[var(--color-line)] p-4 pt-3">

          {/* ---- The summary box, if the paste carried one ---------------- */}
          {summary ? (
            <Panel className="mb-4">
              <SectionTitle>The bank&rsquo;s own figures</SectionTitle>
              <p className="mb-3 text-xs text-[var(--color-ink-2)]">
                Read from the summary box in what you pasted. Recording these lets the card&rsquo;s
                statement history compare every cycle against the bank — and an opening balance
                that disagrees points at an <strong className="font-medium">earlier</strong> month,
                which matching lines can never show.
              </p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  /* Only charges and payments have a counterpart in the rows.
                     The previous balance comes from LAST month and the total
                     due includes it, so neither can be cross-checked here. */
                  ['Previous balance', summary.previousBalance, null],
                  ['Charges', summary.charges, auto.totals.statementDebit],
                  ['Payments', summary.payments, auto.totals.statementCredit],
                  ['Total due', summary.totalDue, null],
                ] as [string, number, number | null][]).map(([label, value, pasted]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2"
                  >
                    <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                      {label}
                    </div>
                    <div className="mt-1"><Money value={value} size="lg" /></div>
                    {/* A summary whose charges disagree with the rows pasted
                        beneath it means the paste is incomplete — worth saying
                        before the figure is recorded as the bank's. */}
                    {pasted !== null && Math.abs(pasted - value) >= 0.005 ? (
                      <div className="mt-0.5 text-[11px] text-[var(--color-warn)]">
                        rows total <span className="sensitive num">{pasted.toFixed(2)}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
                <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-3)]">
                  Saved against {card}&rsquo;s {formatDayShort(statementDate)} statement.
                </span>
                <Button size="sm" pending={savingSummary} onClick={saveSummary}>
                  {savedSummary ? 'Recorded' : 'Record these figures'}
                </Button>
              </div>
            </Panel>
          ) : null}

          {/* ---- The findings -------------------------------------------- */}
          {/* ---- Found somewhere else ------------------------------------ */}
          {proposals.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Probably on {card} &middot; {proposals.length}</SectionTitle>
              <p className="mb-3 text-xs text-[var(--color-ink-2)]">
                These charges have nothing behind them on {card}, but an entry filed under another
                method matches each one to the rupee. That is what a spend typed against the wrong
                method looks like. Check them and move the lot.
              </p>

              {accepted.length > 0 ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2">
                  <Wand className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-xs text-[var(--color-ink-2)]">
                    {accepted.length} of {proposals.length} ticked, worth{' '}
                    <span className="sensitive num font-semibold">{acceptedTotal.toFixed(2)}</span>
                    {' — '}moving them explains that much of the{' '}
                    <span className="sensitive num">{Math.abs(remaining).toFixed(2)}</span> still
                    unaccounted for.
                  </span>
                  <Button size="sm" pending={recovering} onClick={acceptProposals}>
                    Move {accepted.length} to {card}
                  </Button>
                </div>
              ) : null}

              <ul className="flex flex-col">
                {proposals.map((r) => {
                  const on = !rejected.has(r.entryId);
                  return (
                    <li
                      key={r.entryId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(rejected, r.entryId, setRejected)}
                        aria-label={`Move ${r.entry.description} to ${card}`}
                        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                        {formatDayShort(r.line.day)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.line.description}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-2)]">
                        {r.entry.description}
                      </span>
                      <Badge tone="neutral">
                        {r.entry.methodColor ? <Dot color={r.entry.methodColor} size={7} /> : null}
                        {r.entry.method}
                      </Badge>
                      {r.kind === 'near' ? <Badge tone="neutral">{r.dayGap}d apart</Badge> : null}
                      <Money value={r.entry.amount} size="sm" tone="debt" />
                    </li>
                  );
                })}
              </ul>

              <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-ink-3)]">
                Only a single entry matching a single charge to the rupee is offered, and only when
                nothing else fits it equally well — the automatic matching itself never looks at
                other methods, because a charge paired with a spend that went off a different card
                is not a reconciliation. Moving one changes its payment method and nothing else.
              </p>
            </Panel>
          ) : null}

          {/* ---- The mapping table --------------------------------------- */}
          <Panel className="mb-4">
            <SectionTitle>
              Pair what is left
              {canLink ? (
                <span className="ml-2 text-xs font-normal text-[var(--color-ink-3)]">
                  {selectedLines.length} statement &middot; {selectedApp.length} here &middot;{' '}
                  {Math.abs(selectionGap) < 0.005
                    ? 'they balance'
                    : `${selectionGap > 0 ? 'short' : 'over'} by ${Math.abs(selectionGap).toFixed(2)}`}
                </span>
              ) : null}
            </SectionTitle>

            {openLines.length === 0 && openApp.length === 0 ? (
              <Empty title="Nothing left to pair" hint="Every row has been accounted for." />
            ) : (
              <>
                <p className="mb-3 text-xs text-[var(--color-ink-2)]">
                  Tick rows on both sides and link them. Several on one side may pair with one on the
                  other — that is the split case, and the running total above falls by whatever you
                  pair off.
                </p>

                {canLink ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2">
                    <Link2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-xs text-[var(--color-ink-2)]">
                      <span className="sensitive num font-semibold">{sum(selectedLines).toFixed(2)}</span>{' '}
                      on the statement against{' '}
                      <span className="sensitive num font-semibold">{sum(selectedApp).toFixed(2)}</span>{' '}
                      here
                      {Math.abs(selectionGap) >= 0.005 ? (
                        <span className="text-[var(--color-warn)]">
                          {' '}— a difference of {Math.abs(selectionGap).toFixed(2)} will stay unexplained
                        </span>
                      ) : null}
                    </span>
                    <Button size="sm" onClick={link}>Link these</Button>
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <Side
                    title={`On the statement · ${openLines.length}`}
                    empty="Every statement line is accounted for."
                  >
                    {openLines.map((l) => {
                      const flag = chargeFlag(l.description);
                      const open = suggestFor_ === l.line;
                      const ideas = open ? suggestFor(l, openApp, { tolerance: Math.max(tolerance, 7) }) : [];
                      /* Exact-amount, same-direction, nearby — a strong signal the
                         entry exists but went onto the wrong card. Deliberately
                         stricter than the general suggestions: moving money between
                         cards on a loose guess is worse than not offering it. */
                      const misfiled = open
                        ? elsewhere.filter(
                            (m) =>
                              m.direction === l.direction &&
                              Math.round(m.amount * 100) === Math.round(l.amount * 100) &&
                              Math.abs(
                                (new Date(`${m.day}T00:00:00Z`).getTime() -
                                  new Date(`${l.day}T00:00:00Z`).getTime()) / 86400000,
                              ) <= Math.max(tolerance, 7),
                          )
                        : [];
                      return (
                        <li key={l.line} className="border-b border-[var(--color-line)] last:border-b-0">
                          <div className="flex flex-wrap items-center gap-2 py-2">
                            <input
                              type="checkbox"
                              checked={pickedLines.has(l.line)}
                              onChange={() => toggle(pickedLines, l.line, setPickedLines)}
                              aria-label={`Select ${l.description}`}
                              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                            />
                            <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                              {formatDayShort(l.day)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{l.description}</span>
                            {flag ? <Badge tone="warn">{flag.label}</Badge> : null}
                            <Money value={l.amount} size="sm" tone={l.direction === 'credit' ? 'credit' : 'debt'} />
                            <Button
                              variant="ghost" size="icon"
                              aria-label={`Suggest a match for ${l.description}`}
                              onClick={() => setSuggestFor(open ? null : l.line)}
                            >
                              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>

                          {open ? (
                            <div className="flex flex-col gap-2 pb-2 pl-6">
                              {/* Filed against a different card. This is the case where
                                  the entry exists but was put on the wrong method, so it
                                  never appears on the statement being checked. */}
                              {misfiled.length > 0 ? (
                                <div className="rounded-[var(--radius-field)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-2.5 py-2">
                                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-warn)]">
                                    <CreditCard className="h-3 w-3" aria-hidden="true" />
                                    Same amount, filed on another card
                                  </div>
                                  <ul className="flex flex-col gap-1">
                                    {misfiled.map((m) => (
                                      <li key={m.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                                        <span className="min-w-0 flex-1 truncate">{m.description}</span>
                                        <Badge tone="neutral">on {m.method}</Badge>
                                        <Money value={m.amount} size="sm" />
                                        <Button
                                          size="sm" variant="secondary" disabled={moving === m.id}
                                          onClick={() => move(m.id, card, m.description)}
                                        >
                                          Move to {card}
                                        </Button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {ideas.length === 0 && misfiled.length === 0 ? (
                                <p className="text-[11px] text-[var(--color-ink-3)]">
                                  Nothing here comes close. It is probably a charge the bank added.
                                </p>
                              ) : ideas.length === 0 ? null : (
                                <ul className="flex flex-col gap-1">
                                  {ideas.map((s, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="min-w-0 flex-1 truncate">
                                        {s.app.map((a) => a.description).join(' + ')}
                                      </span>
                                      <span className="text-[var(--color-ink-3)]">{s.reason}</span>
                                      <Money value={s.total} size="sm" />
                                      <Button size="sm" variant="secondary" onClick={() => applySuggestion(l, s.app)}>
                                        Use
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </Side>

                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                        {showAll ? `Everything this period · ${pool.length}` : `On ${card} · ${pool.length}`}
                      </span>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {/* Off by default: the leftovers are usually the only
                            thing worth looking at, and 96 confirmed rows would
                            bury them. On, a confirmed entry shows in green
                            beside the ones still unpaired, so the dates with
                            nothing green next to them are the ones to check. */}
                        {matchedEntries.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setShowMatched((v) => !v)}
                            className="text-[11px] font-medium text-[var(--color-accent)]"
                          >
                            {showMatched ? 'Hide matched' : `Show matched too (${matchedEntries.length})`}
                          </button>
                        ) : null}
                        {/* The whole period, whatever each entry was filed against.
                            A spend made on this card but typed against another is
                            not in this card's own list — this is where it shows up. */}
                        <button
                          type="button"
                          onClick={() => setShowAll((v) => !v)}
                          className="text-[11px] font-medium text-[var(--color-accent)]"
                        >
                          {showAll ? `Show only ${card}` : `Show all methods (${openApp.length + openElsewhere.length})`}
                        </button>
                      </div>
                    </div>

                    {selectedElsewhere.length > 0 ? (
                      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-2.5 py-2">
                        <CreditCard className="h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-2)]">
                          {selectedElsewhere.length}{' '}
                          {selectedElsewhere.length === 1 ? 'entry is' : 'entries are'} filed
                          elsewhere, totalling{' '}
                          <span className="sensitive num font-semibold">
                            {sum(selectedElsewhere).toFixed(2)}
                          </span>
                        </span>
                        <Button size="sm" pending={bulkMoving} onClick={moveSelected}>
                          Mark as {card}
                        </Button>
                      </div>
                    ) : null}

                    {pool.length === 0 ? (
                      <p className="py-3 text-[11px] text-[var(--color-ink-3)]">
                        Every entry is accounted for.
                      </p>
                    ) : (
                      <ul className="flex flex-col">
                        {pool.map((e) => {
                          const filedElsewhere = elsewhereIds.has(e.id);
                          const isMatched = matchedAppIds.has(e.id);
                          const isProposed = proposedIds.has(e.id);
                          return (
                            <li
                              key={e.id}
                              className={cx(
                                'flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-b-0',
                                /* One tint, chosen explicitly. Two background
                                   utilities with arbitrary values have equal
                                   specificity, so which one won would come down
                                   to stylesheet order rather than intent. */
                                isMatched
                                  ? 'bg-[var(--color-pos-soft)]'
                                  : isProposed
                                    ? 'bg-[var(--color-accent-soft)]'
                                    : filedElsewhere
                                      ? 'bg-[var(--color-raised)]'
                                      : '',
                              )}
                            >
                              {/* A matched row has nothing left to do — no
                                  linking, no moving, that is what matched
                                  means — so it gets a check instead of a
                                  checkbox rather than a control with no use. */}
                              {isMatched ? (
                                <CheckCircle2
                                  className="h-4 w-4 shrink-0 text-[var(--color-pos)]"
                                  aria-hidden="true"
                                />
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={pickedApp.has(e.id)}
                                  onChange={() => toggle(pickedApp, e.id, setPickedApp)}
                                  aria-label={`Select ${e.description}`}
                                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                                />
                              )}
                              <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                                {formatDayShort(e.day)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm">{e.description}</span>
                              {filedElsewhere ? <Badge tone="warn">{e.method}</Badge> : null}
                              {/* The sweep found a charge on the statement that
                                  this entry matches to the rupee. Flagged here
                                  too, not only in its own panel, so it is
                                  findable while scrolling the whole period. */}
                              {isProposed ? <Badge tone="accent">Probably {card}</Badge> : null}
                              {isMatched ? <Badge tone="good">On statement</Badge> : null}
                              <Money
                                value={e.amount}
                                size="sm"
                                tone={e.direction === 'credit' ? 'credit' : 'debt'}
                              />
                              {isMatched ? null : !filedElsewhere ? (
                                <select
                                  value=""
                                  disabled={moving === e.id}
                                  aria-label={`Move ${e.description} to another payment method`}
                                  onChange={(ev) => ev.target.value && move(e.id, ev.target.value, e.description)}
                                  className={cx(inputClass(), 'w-[6.5rem] shrink-0 text-[11px]')}
                                >
                                  <option value="">Move to…</option>
                                  {methods.filter((m) => m !== card).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              ) : (
                                <Button
                                  size="sm" variant="secondary" disabled={moving === e.id}
                                  onClick={() => move(e.id, card, e.description)}
                                >
                                  Mark as {card}
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </Panel>

          {/* ---- What has been paired ------------------------------------ */}
          {links.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Paired by hand &middot; {links.length}</SectionTitle>
              <ul className="flex flex-col">
                {links.map((l) => {
                  const gap = round2(sum(l.statement) - sum(l.app));
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-xs last:border-b-0">
                      <span className="min-w-0 flex-1 truncate">
                        {l.statement.map((s) => s.description).join(' + ')}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">
                        {l.app.map((a) => a.description).join(' + ')}
                      </span>
                      {l.statement.length > 1 || l.app.length > 1 ? (
                        <Badge tone="accent">{l.statement.length}&rarr;{l.app.length}</Badge>
                      ) : null}
                      {Math.abs(gap) >= 0.005 ? <Badge tone="warn">{gap.toFixed(2)} off</Badge> : null}
                      <Money value={sum(l.statement)} size="sm" />
                      <Button variant="ghost" size="icon" aria-label="Undo this pairing" onClick={() => unlink(l.id)}>
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          {parsed.skipped.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>
                {parsed.skipped.length} {parsed.skipped.length === 1 ? 'line' : 'lines'} could not be read
              </SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                Not counted in anything above. Shown so they can be fixed in the paste rather than
                quietly missing from the comparison.
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

            </div>
          </details>
        </>
      )}

      {/* Turning a statement line into an entry.

          The draft is derived from the line each time rather than stored, and
          noon rather than midnight for the same reason as everywhere else: an
          entry timed 00:00 on a bill date sits exactly on the boundary between
          two statements.

          Saving refreshes the page, so the new entry comes back through the
          server and the line it was made from matches on the next render — it
          leaves this list by being explained, not by being ticked off. */}
      <TransactionDialog
        open={adding !== null}
        onOpenChange={(v) => !v && setAdding(null)}
        defaultTs={merged ? `${merged.day}T12:00:00` : `${statementDate}T12:00:00`}
        draft={
          merged
            ? {
                amount: merged.amount,
                method: card,
                remarks: merged.remarks,
                category: merged.category ?? '',
              }
            : null
        }
        onSaved={() => { setAdding(null); setMerging(new Set()); router.refresh(); }}
      />
    </>
  );
}

/** What became of one statement line, and the single thing left to do. */
type LineState = {
  line: StatementLine;
  matched: boolean;
  pairedByHand: boolean;
  proposal: { entryId: string; entry: MisfiledCandidate } | null;
};

/**
 * One row of the statement, with its state and at most one action.
 *
 * AT MOST ONE. A row that offers two things to do is a row that has to be
 * thought about, and a statement is a hundred of them. So the state decides:
 * settled rows offer nothing, a row whose entry exists under another method
 * offers to move it, and only a row with nothing behind it at all offers to
 * add one. Offering Add beside Move would let one spend be recorded twice.
 */
function StatementRow({
  state, card, moving, ticked, onTick, onAdd, onMove,
}: {
  state: LineState;
  card: string;
  moving: string | null;
  ticked: boolean;
  onTick: () => void;
  onAdd: () => void;
  onMove: (entryId: string) => void;
}) {
  const { line, matched, pairedByHand, proposal } = state;
  const settled = matched || pairedByHand;
  const flag = chargeFlag(line.description);
  const draft = describeStatementLine(line, card);
  /* Only a row that would be ADDED can be merged. A settled row is already an
     entry, and a row whose entry exists elsewhere has to be moved, not copied
     into a new one — ticking either would build an entry that duplicates a
     real one. */
  const mergeable = !settled && !proposal;

  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0',
        settled ? 'bg-[var(--color-pos-soft)]' : ticked ? 'bg-[var(--color-accent-soft)]' : '',
      )}
    >
      {mergeable ? (
        <input
          type="checkbox"
          checked={ticked}
          onChange={onTick}
          aria-label={`Merge ${line.description} into one entry`}
          className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
        {formatDayShort(line.day)}
      </span>
      <span className="min-w-0 flex-1 basis-40 truncate" title={line.raw}>{line.description}</span>

      {flag && !settled ? <Badge tone="warn">{flag.label}</Badge> : null}

      {/* What this row will become, shown only while it is still a proposal.
          Once a row is settled its draft is history and saying it again would
          be one more thing to read past. */}
      {/* The draft yields space to the bank's own words, never the other way
          round: this list is read to FIND a row on the paper statement, and a
          row you cannot identify is no use however well it has been renamed. */}
      {!settled && !proposal ? (
        <span className="hidden min-w-0 max-w-[45%] items-center gap-1 text-[11px] text-[var(--color-ink-3)] lg:flex">
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{draft.remarks}</span>
          <span className="shrink-0">
            {draft.category ? (
              <Badge tone="neutral">{draft.category}</Badge>
            ) : (
              <Badge tone="warn">Category?</Badge>
            )}
          </span>
        </span>
      ) : null}

      {proposal && !settled ? (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-[var(--color-ink-3)] lg:flex">
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          already on <Badge tone="accent">{proposal.entry.method}</Badge>
        </span>
      ) : null}

      <Money value={line.amount} size="sm" tone={line.direction === 'credit' ? 'credit' : 'debt'} />

      {settled ? (
        <span className="flex w-[5.5rem] shrink-0 items-center justify-end gap-1 text-[11px] text-[var(--color-pos)]">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          {pairedByHand ? 'paired' : 'matched'}
        </span>
      ) : proposal ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={moving === proposal.entryId}
          onClick={() => onMove(proposal.entryId)}
          aria-label={`Move ${proposal.entry.description} onto ${card}`}
        >
          Move to {card}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={onAdd}
          aria-label={`Add ${line.description} as an entry on ${card}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add
        </Button>
      )}
    </li>
  );
}

function Side({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {title}
      </div>
      {list.length === 0 ? (
        <p className="py-3 text-[11px] text-[var(--color-ink-3)]">{empty}</p>
      ) : (
        <ul className="flex flex-col">{children}</ul>
      )}
    </div>
  );
}

/** One figure in the bank-against-app comparison. */
function Tile({
  label, value, note, tone = 'neutral', flag = false,
}: {
  label: string;
  value: number;
  note: string;
  tone?: 'neutral' | 'debt' | 'credit' | 'muted';
  /** Draw attention: the two sides do not agree. */
  flag?: boolean;
}) {
  return (
    <div
      className={cx(
        'min-w-0 rounded-[var(--radius-field)] border px-2.5 py-2',
        flag
          ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)]'
          : 'border-[var(--color-line)] bg-[var(--color-canvas)]',
      )}
    >
      {/* The flagged tile's amber fill eats contrast: ink-3 falls to 3.2:1 on
          it, against 3.5:1 elsewhere. ink-2 puts it back to 5.7:1 — better
          than the muted text anywhere else on the page, on the one tile that
          most needs reading. */}
      <div
        className={cx(
          'truncate text-[10px] font-semibold uppercase tracking-wider',
          flag ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-ink-3)]',
        )}
      >
        {label}
      </div>
      <div className="mt-1"><Money value={value} tone={tone} size="lg" /></div>
      <div
        className={cx(
          'mt-0.5 text-[11px] leading-tight',
          flag ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-ink-3)]',
        )}
      >
        {note}
      </div>
    </div>
  );
}
