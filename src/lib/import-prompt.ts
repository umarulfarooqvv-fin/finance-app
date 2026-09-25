import { ALL_CATEGORIES, ALL_METHODS } from '@/lib/types';

/* ===========================================================================
   The prompt for turning receipts, UPI screens and messages into entries.

   Entries get missed in the weeks when there is no time to log them, and what
   survives is a camera roll: a UPI confirmation, a bill photographed on the
   way out, a bank SMS. Typing forty of those back in one evening is how the
   backlog stays a backlog.

   An assistant can read them. What it cannot do is know THIS ledger's methods
   and categories, so the prompt carries both lists — generated from the app's
   own constants rather than written out again, because a category list that
   drifts from the app's is a prompt that produces rows the app then refuses.

   IT IS TOLD TO LEAVE THINGS BLANK. A category it cannot judge, a method it
   cannot see — both come back empty for a person to fill, because an entry
   filed under a guessed category is worse than one flagged as unfinished: the
   flag gets fixed, the guess gets averaged into a year of spending.

   The rows it produces are a DRAFT. They land in a table to be read, edited
   and confirmed; nothing here writes.
   =========================================================================== */

const CATEGORIES = ALL_CATEGORIES.join(', ');
const METHODS = ALL_METHODS.join(', ');

export const IMPORT_PROMPT = `Read these payment screenshots and turn each transaction into one line of plain text for a personal finance app.

Output ONLY the lines described below — no explanation, no commentary, no markdown, no code fences, no header row.

One line per transaction, fields separated by a pipe character:

DD/MM/YYYY HH:MM | amount | method | category | description

Rules:
- Copy every amount EXACTLY as shown, to the paisa. Never round.
- Give the time in 24-hour form after the date ("22/09/2026 15:11") when the
  screenshot shows one; write the date alone when it does not. Never make up
  a time.
- Many payment screens print a date with no year ("September 22"). Do not
  guess one. Use the year given below if there is one; otherwise the most
  recent such date that is not in the future.
- method is one of: ${METHODS}
  If the screenshot names the paying account some OTHER way — a bank's label
  such as "Federal CC XX16" or "ICICI XX00" — copy that label exactly as
  printed. The app maps bank labels to its own names; do not translate one
  into a name from the list yourself, and never substitute a different
  account. Leave it EMPTY if the screenshot does not show which account paid.
- category must be one of: ${CATEGORIES}
  Leave it EMPTY if you cannot tell. Do not guess.
- description is what it was for, in a few plain words. Use the merchant or
  person's name if that is all there is.
- Leave out anything that is not money leaving or arriving: balance figures,
  totals, rewards points, "request sent" notices.
- If a screenshot shows the same payment twice, include it once.
- Do not invent a transaction you cannot see. If a value is unreadable, write
  UNREADABLE in that field rather than guessing.

If several payments belong to one occasion — a day at a hospital, a trip —
give them the same description, and still give each its own line and its own
category.`;

/** A worked example in exactly the shape the prompt asks for. Parsed by a test. */
export const IMPORT_EXAMPLE = `14/09/2026 13:05 | 450.00 | Fi | Food | Hospital canteen
14/09/2026 | 1250.00 | Fi | Medicine | Dad hospital pharmacy
14/09/2026 | 300.00 | Cash |  | Dad hospital parking
15/09/2026 | 649.19 | ICICI | Personal | Minoxidil`;
