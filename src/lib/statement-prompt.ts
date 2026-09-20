/* ===========================================================================
   The prompt for turning a statement IMAGE or PDF into text this app reads.

   The paste box already accepts a statement copied out of a PDF or a
   spreadsheet. What it cannot do is read a picture, and a bank app on a phone
   often gives you nothing else — a screenshot, or a PDF locked in a folder
   nothing can open. An assistant can read those; it just needs telling what
   shape to hand back.

   SO THIS ASKS FOR THE FORMAT THE PARSER ALREADY TAKES, not a new one. JSON
   would be a second format to keep in step with the first, and the first is
   already tolerant enough to accept what a person would copy by hand.

   The rules that matter are the ones that stop a model being helpful in the
   ways that ruin financial data: rounding, totalling, merging two rows into
   one, or inventing a plausible line to fill a gap it could not read. It is
   told to write UNREADABLE instead, which shows up as a line the parser
   reports rather than a number nobody can trace.

   The app checks the arithmetic afterwards regardless — the rows must sum to
   the charges the summary states — so a fabricated or dropped line is caught
   by the statement's own totals rather than trusted.

   `EXAMPLE` is not decoration. A test feeds it through the real parser and
   asserts the figures come back, so the shape the prompt asks for cannot
   drift away from the shape the parser reads.
   =========================================================================== */

export const STATEMENT_PROMPT = `Read this credit-card statement and convert it to plain text for a reconciliation tool.

Output ONLY the text described below — no explanation, no commentary, no markdown, no code fences.

1. First the summary box, keeping these exact labels:

Previous Balance Purchases / Charges Cash Advances Payments / Credits
<amount> <amount> <amount> <amount>
Total Amount Due <amount>

2. Then one line per transaction, in the order printed:

DD/MM/YYYY  <description>  <amount>

Rules:
- Copy every amount EXACTLY as printed, to the paisa. Never round.
- Put CR at the end of any line that is a payment, refund, credit or reversal.
- One transaction per line. If the statement wraps a transaction across several
  lines, join them into one.
- Do not total anything. Do not merge two transactions into one. Do not split one
  into two.
- Do not add a transaction that is not printed, and do not leave one out.
- If you cannot read a value, write UNREADABLE in its place. Never guess a number.`;

/** A worked example in exactly the shape the prompt asks for. Parsed by a test. */
export const EXAMPLE = `Previous Balance Purchases / Charges Cash Advances Payments / Credits
6,842.25 4,372.70 0.00 6,842.25
Total Amount Due 4,372.70
31/01/2026  ABDUL MUJEEB MOOZHIKKAL  30.00
05/02/2026  AMAZON  649.19
11/02/2026  IGST-CI@18%  73.39
12/02/2026  BBPS Payment received  6,842.25 CR`;
