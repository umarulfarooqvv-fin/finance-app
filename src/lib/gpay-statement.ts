/* ===========================================================================
   Reading a Google Pay transaction statement.

   The PDF lists every UPI payment in a fixed shape, one block each:

       01 Jul, 2026
       10:44 AM
       Paid to MUHAMMED RAHEES T P          ← or "Received from …"
       UPI Transaction ID: 654819171027
       Paid by Federal Bank 2788            ← the account; "Paid to …" when received
       ₹3,000

   with the page header repeated between them. This turns those blocks into
   rows the importer already understands, keeping the two things a pasted
   summary loses: WHICH WAY the money went, and the UPI transaction id.

   It reads text from the PDF directly (unpdf, with spaces) and text copied out
   of a PDF viewer, which arrives with every space missing —
   "PaidtoMuhammedFaisal", "PaidbyFederalBank2788". Both are accepted.

   Pure: text in, rows out. Nothing here resolves an account or decides a
   category; that is the importer's job, the same for every source.
   =========================================================================== */

export type StatementMove = {
  /** "YYYY-MM-DD". */
  day: string;
  /** "HH:MM:SS", 24-hour. */
  time: string | null;
  amount: number;
  /** out = paid to someone; in = received from someone. */
  direction: 'out' | 'in';
  /** Who was paid, or who paid. */
  party: string;
  /** The account as the statement names it: "Federal Bank 2788". */
  account: string;
  /** What the account is, when the statement says: "RuPay credit card". */
  accountKind: string;
  /** The UPI transaction id — the same payment can never be imported twice. */
  ref: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE = /^(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*,?\s*(\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i;
const PARTY = /^(paid\s*to|received\s*from)\s*(.+)$/i;
const UPI = /^UPI\s*Transaction\s*ID\s*:?\s*([A-Za-z0-9]+)/i;
const ACCOUNT = /^paid\s*(by|to)\s*(.+)$/i;
const AMOUNT = /^₹\s*([\d,]+(?:\.\d{1,2})?)$/;

/** True when the text looks like a Google Pay statement rather than a paste. */
export function isGpayStatement(text: string): boolean {
  const t = text.slice(0, 20000);
  return /UPI\s*Transaction\s*ID/i.test(t) && /(paid\s*to|received\s*from)/i.test(t) && /₹/.test(t);
}

/** Put back the spaces a PDF viewer's copy drops: "MuhammedFaisal" → "Muhammed Faisal". */
export function respace(s: string): string {
  // Text that already has its spaces is left exactly as written ("RuPay").
  if (/\s/.test(s.trim())) return s.replace(/\s+/g, ' ').trim();
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function to24h(h: number, m: string, ap: string): string {
  const hh = (h % 12) + (ap.toUpperCase() === 'P' ? 12 : 0);
  return `${String(hh).padStart(2, '0')}:${m}:00`;
}

export function parseGpayStatement(text: string): StatementMove[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: StatementMove[] = [];

  type Draft = Partial<StatementMove> & { day: string };
  let cur: Draft | null = null;

  const finish = () => {
    if (cur && cur.amount != null && cur.direction && cur.party) {
      out.push({
        day: cur.day,
        time: cur.time ?? null,
        amount: cur.amount,
        direction: cur.direction,
        party: cur.party,
        account: cur.account ?? '',
        accountKind: cur.accountKind ?? '',
        ref: cur.ref ?? null,
      });
    }
    cur = null;
  };

  for (const line of lines) {
    const d = DATE.exec(line);
    if (d) {
      finish();
      const month = MONTHS[d[2]!.toLowerCase()];
      if (!month) continue;
      cur = { day: `${d[3]}-${String(month).padStart(2, '0')}-${d[1]!.padStart(2, '0')}` };
      continue;
    }
    if (!cur) continue;

    const tm = TIME.exec(line);
    if (tm && !cur.time) { cur.time = to24h(Number(tm[1]), tm[2]!, tm[3]!); continue; }

    const u = UPI.exec(line);
    if (u) { cur.ref = u[1]!; continue; }

    // The first "Paid to / Received from" is the other party. After the UPI
    // line, "Paid by …" (sent) or "Paid to …" (received) is OUR account.
    if (!cur.party) {
      const p = PARTY.exec(line);
      if (p) {
        cur.direction = /received/i.test(p[1]!) ? 'in' : 'out';
        cur.party = respace(p[2]!);
        continue;
      }
    } else if (!cur.account) {
      const a = ACCOUNT.exec(line);
      if (a) {
        const [acct = '', kind = ''] = a[2]!.split('|').map((x) => respace(x));
        cur.account = acct;
        cur.accountKind = kind;
        continue;
      }
    }

    const amt = AMOUNT.exec(line);
    if (amt && cur.amount == null) {
      cur.amount = Number(amt[1]!.replace(/,/g, ''));
      finish();
    }
  }
  finish();
  return out;
}
