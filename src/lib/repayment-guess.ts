/* ===========================================================================
   Who a received payment probably came back from.

   A statement names the sender the way their bank does — "Arshad ali",
   "ARSHADALI V", "Raheez Muh'd" — and the credit ledger names them the way
   the remarks did. Close enough to suggest, never close enough to be sure, so
   this only ever SUGGESTS: the import table shows the guess in the "repaid
   by" field, where it can be changed before anything is saved.

   It is deliberately strict, because a wrong guess is worse than none: it
   would mark someone's debt as paid down by money that came from somebody
   else. "Muhammed" alone matches half the ledger, so first names are never
   enough on their own:

     - the whole name squashed together must start the other one
       ("arshadali" ↔ "arshadaliv"), at least five letters; or
     - every word of the shorter name (initials aside) must appear in the
       longer one, and the words shared must include one that is not a
       common first name.

   And only a SINGLE matching debtor counts. Two candidates is no answer.

   Pure: strings in, a name or null out.
   =========================================================================== */

export type Debtor = { person: string; outstanding: number };

const COMMON = new Set([
  'muhammed', 'mohammed', 'muhammad', 'mohamed', 'mohammad', 'mohd', 'muhd', 'abdul', 'abdu',
  'ahmed', 'ahammed', 'syed', 'sayed', 'mr', 'mrs', 'ms', 'p', 'k', 'v', 't', 'm', 'c', 'a',
]);

const words = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

const squash = (s: string) => words(s).join('');

function sameSomeone(a: string, b: string): boolean {
  const sa = squash(a);
  const sb = squash(b);
  if (!sa || !sb) return false;

  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 5 && long.startsWith(short)) {
    // "Muhammed" squashed starts "muhammedfaisal" too: a prefix that is only
    // a common first name says nothing about who it is.
    if (!COMMON.has(short)) return true;
  }

  const wa = words(a).filter((w) => w.length > 1);
  const wb = words(b).filter((w) => w.length > 1);
  const [ws, wl] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (ws.length === 0) return false;
  const all = ws.every((w) => wl.includes(w));
  const telling = ws.some((w) => w.length >= 3 && !COMMON.has(w));
  return all && telling;
}

/** The debtor a sender most likely is — only when exactly one fits. */
export function guessDebtor(party: string, debtors: Debtor[]): string | null {
  // The same name, spaces aside ("Arshad ali" = "Arshadali"), beats any looser
  // fit — the ledger also holds names parsed out of long remarks, which the
  // looser rules can match too.
  const exact = debtors.filter((d) => squash(d.person) === squash(party));
  if (exact.length === 1) return exact[0]!.person;

  const hits = debtors.filter((d) => sameSomeone(party, d.person));
  return hits.length === 1 ? hits[0]!.person : null;
}
