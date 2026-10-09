/* ===========================================================================
   Reading a Federal Bank account statement.

   The PDF (unpdf's text of it) lists each transaction as

       11-OCT-2025 11-OCT-2025 UPIOUT/528401752209         ← date, value date, particulars…
       /ahiqpktr@okaxis/UPI/0000                           ← …which may run on
       TFR S22442735 14726.00 76312.06 Cr                  ← type, id, amount, balance

   with a page header repeated between them, and the occasional record on a
   single line ("CASH: ABDUL GAFOOR CASH FB87773 80000.00 117987.77 Cr").

   WHICH WAY THE MONEY WENT IS NOT IN THE TEXT: withdrawals and deposits are
   two columns, and extracted text keeps only the number. The RUNNING BALANCE
   says it — up is money in, down is money out — so every row is read against
   the one before it, from the statement's own opening balance. A row whose
   amount does not equal the change in balance means something was misread,
   and is reported rather than guessed at. On the real statement this reads
   1,282 rows whose totals equal the bank's grand totals to the paisa.

   Pure: text in, rows out.
   =========================================================================== */

export type BankRow = {
  /** "YYYY-MM-DD". */
  day: string;
  amount: number;
  direction: 'out' | 'in';
  /** The bank's particulars, joined onto one line. */
  particulars: string;
  /** The bank's own transaction id ("S22442735"). */
  ref: string;
  balance: number;
};

export type BankStatement = {
  /** Last four digits of the account, from the header. */
  account: string | null;
  opening: number | null;
  rows: BankRow[];
  /** Rows whose amount did not match the change in balance. */
  unreconciled: number;
};

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

const START = /^(\d{2})-([A-Z]{3})-(\d{4})\s+\d{2}-[A-Z]{3}-\d{4}\s*(.*)$/;
const END = /^(?:(.*?)\s+)?([A-Z]{2,6})\s+([A-Z]{1,3}\d{4,})\s+(?:(\S+)\s+)?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(Cr|Dr)$/;
/* Page furniture that can fall in the middle of a record split across pages. */
const NOISE = /^(The Federal Bank Ltd|Ph:|Name :|Communication Address|Branch|Address Last|Regd\.|Email ID|Type of Account|Scheme|IFSC|MICR|SWIFT|Effective Available|Statement of Account|Date Value|Type Tran|Details Withdrawals|Opening Balance|GRAND TOTAL|Abbreviations|CASH : Cash|FT : Fund|SBINT :|DISCLAIMER|theprevious|fullparticulars|This is a computer|\*+END)/;

const num = (s: string) => Number(s.replace(/,/g, ''));

export function isFederalStatement(text: string): boolean {
  const head = text.slice(0, 4000);
  return /Federal Bank/i.test(head) && /Statement of Account/i.test(head) && /\d{2}-[A-Z]{3}-\d{4}\s+\d{2}-[A-Z]{3}-\d{4}/.test(text);
}

export function parseFederalStatement(text: string): BankStatement {
  const acct = /Account Number\s*:\s*(\d{4,})/.exec(text)?.[1] ?? null;
  const openM = /Opening Balance\s+([\d,]+\.\d{2})\s*(Cr|Dr)?/.exec(text);
  const opening = openM ? num(openM[1]!) * (openM[2] === 'Dr' ? -1 : 1) : null;

  type Raw = { day: string; parts: string[] };
  const raws: { raw: Raw; amount: number; balance: number; ref: string }[] = [];
  let cur: Raw | null = null;

  const close = (r: Raw, m: RegExpExecArray) => {
    if (m[1]) r.parts.push(m[1]);
    const balance = num(m[6]!) * (m[7] === 'Dr' ? -1 : 1);
    raws.push({ raw: r, amount: num(m[5]!), balance, ref: m[3]! });
  };

  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line || NOISE.test(line) || /^=+PAGE=+$/.test(line)) continue;
    const s = START.exec(line);
    if (s) {
      const r: Raw = { day: `${s[3]}-${MONTHS[s[2]!] ?? '01'}-${s[1]}`, parts: [] };
      const oneLine = END.exec(s[4] ?? '');
      if (oneLine) { close(r, oneLine); cur = null; }
      else { if (s[4]) r.parts.push(s[4]); cur = r; }
      continue;
    }
    if (!cur) continue;
    const e = END.exec(line);
    if (e) { close(cur, e); cur = null; }
    else cur.parts.push(line);
  }

  let prev = opening ?? (raws[0] ? raws[0].balance : 0);
  let unreconciled = 0;
  const rows: BankRow[] = raws.map(({ raw, amount, balance, ref }) => {
    const delta = Math.round((balance - prev) * 100) / 100;
    if (Math.abs(Math.abs(delta) - amount) > 0.01) unreconciled += 1;
    prev = balance;
    return {
      day: raw.day,
      amount,
      direction: delta > 0 ? 'in' : 'out',
      particulars: raw.parts.join(' ').replace(/\s+/g, ' ').trim(),
      ref,
      balance,
    };
  });

  return { account: acct ? acct.slice(-4) : null, opening, rows, unreconciled };
}

/* ---------------------------------------------------------------------------
   What a row probably is. Suggestions only — every one is shown in the import
   table to be changed — except that money moving between the owner's OWN
   accounts is left unticked, because it is neither spending nor income and
   importing it as either would be wrong in both directions.
   --------------------------------------------------------------------------- */

export type RowReading = {
  /** A short description for the remarks. */
  label: string;
  /** Suggested category (spend) or income source (money in). */
  category: string;
  /** Not spending or income — left unticked, with this as the reason. */
  skip: string | null;
  /** One line shown under the row. */
  hint: string | null;
};

/** The UPI handle in particulars: "/ahiqpktr@okaxis/UPI/0000" → "ahiqpktr@okaxis". */
function vpa(p: string): string | null {
  const m = /\/\s*([\w.-]+(?:\s[\w.-]+)?@[\w.]+)/.exec(p);
  return m ? m[1]!.replace(/\s+/g, '') : null;
}

const CARD_PAYEES: { re: RegExp; card: string }[] = [
  { re: /scapia/i, card: 'Scapia' },
  { re: /onecard|FPL Tech/i, card: 'One Card' },
];

export function readBankRow(row: BankRow, opts: { selfUpi?: RegExp; salaryFrom?: Set<string> } = {}): RowReading {
  const p = row.particulars;
  const P = p.toUpperCase();
  const handle = vpa(p);
  const r = (label: string, category = '', skip: string | null = null, hint: string | null = null): RowReading =>
    ({ label, category, skip, hint });

  if (P.startsWith('IFN/')) return r('Fi auto-save', '', 'Saved into your own deposit — not spending');
  if (P.startsWith('DR. TRAN FOR FUNDING')) return r('Fixed deposit opened', '', 'Moved into your own fixed deposit');
  if (/^FD-\d/.test(P)) return r('Fixed deposit closed', '', 'Your own fixed deposit coming back');
  if (P.startsWith('AC XFR')) return r('Account transfer', '', 'Moved between your own accounts');
  if (/JUPITERAXIS|JUPITERUP/.test(P) || (opts.selfUpi && opts.selfUpi.test(p))) {
    return r(row.direction === 'in' ? 'From your Jupiter account' : 'To your Jupiter account', '', 'Between your own accounts (Jupiter)');
  }
  if (P.startsWith('TO ATM')) {
    const where = /\\\s*(.+)$/.exec(p)?.[1]?.trim();
    return r(`ATM cash${where ? ` · ${where}` : ''}`, '', 'Cash taken out — not spent until it is', 'Record the cash spends with Paid from: Cash');
  }
  if (P.startsWith('SBINT')) return r('Savings interest', 'Investment Return');

  if (P.startsWith('NFT/') || P.startsWith('NEFT')) {
    const from = /^N[EF]{1,2}T\/([^/]+)/i.exec(p)?.[1]?.trim() ?? 'NEFT';
    const regular = opts.salaryFrom?.has(from.toUpperCase());
    return r(`NEFT from ${from}`, regular && row.direction === 'in' ? 'Salary' : '', null,
      regular ? 'Paid regularly by the same sender — read as salary' : null);
  }
  if (P.startsWith('FT IMPS')) {
    const who = /\/([^/]+?)\s*$/.exec(p)?.[1]?.trim() ?? '';
    const cred = /DREAMPLUG/i.test(who);
    return r(`IMPS ${row.direction === 'in' ? 'from' : 'to'} ${who}${cred ? ' (CRED)' : ''}`, '', null,
      cred ? 'From CRED (Dreamplug) — a refund, reward or CRED Cash? Choose the source' : null);
  }
  if (P.startsWith('CASH')) return r(`Cash deposit · ${p.replace(/^CASH:?\s*/i, '')}`, '');
  if (P.startsWith('UPI REFUND')) return r('UPI refund', '', null, 'Money back from a merchant');

  if (P.startsWith('UPIOUT') || P.startsWith('UPI IN') || P.startsWith('UPI')) {
    const label = handle ?? p.slice(0, 40);
    if (row.direction === 'out') {
      const card = CARD_PAYEES.find((c) => c.re.test(p));
      if (card) return r(`${card.card} bill · ${label}`, card.card, null, `Paid the ${card.card} bill`);
      if (/cred\.club|CRED/i.test(p)) return r(`CRED · ${label}`, '', null, 'Paid through CRED — usually a card bill: choose which card');
    }
    return r(label, '');
  }
  return r(p.slice(0, 60), '');
}

/** Senders who pay in by NEFT at least three times — read as salary. */
export function regularNeftSenders(rows: BankRow[]): Set<string> {
  const n = new Map<string, number>();
  for (const r of rows) {
    if (r.direction !== 'in') continue;
    const from = /^N[EF]{1,2}T\/([^/]+)/i.exec(r.particulars)?.[1]?.trim().toUpperCase();
    if (from) n.set(from, (n.get(from) ?? 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c >= 3).map(([k]) => k));
}
