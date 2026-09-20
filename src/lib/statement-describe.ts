import { chargeFlag } from '@/lib/statement-match';

/* ===========================================================================
   A bank's words, turned into this app's words.

   A statement line that nothing in the app explains is usually an entry that
   was never logged, and adding it means retyping it. But the bank's string is
   not how this ledger reads: the ledger says "Breakfast", "Kseb electricity
   bill", "Fuel surcharge", while the bank says "SWIGGY BANGALORE", "IGST-
   CI@18%", "ABDUL MUJEEB MOOZHIKKAL 7012*****". Pasting the bank's version in
   would leave one ledger written in two voices, and the SHOUTING rows would be
   the imported ones forever.

   So this reads a line for what it IS and returns a draft in the house style.

   WHAT IT WILL AND WILL NOT DECIDE. A category is suggested only where the
   description STATES the kind of thing — a tax says it is a tax, a fuel pump
   says it is fuel, a payment on a card says it cleared that card's bill. A
   brand name does not state a category: "AMAZON" is as easily Personal as
   Groceries as a gift, and quietly filing it skews the very analytics the
   entry exists to feed. Those come back with no category, and the form makes
   the choice before it will save.

   WHEN IT CANNOT READ THE LINE AT ALL the description is `Unknown` — a word
   already used in this ledger for exactly this — rather than a mangled copy of
   the bank's reference number. An entry called Unknown is honest and can be
   searched for later; one called "POS 4076XXXXXXXX1234 MUM" is neither.

   Nothing here is applied on its own. It fills a form that a person reads.
   =========================================================================== */

export type DescribedSource = 'payment' | 'charge' | 'merchant' | 'unknown';

export type Described = {
  /** The remarks to put in the form, in this ledger's voice. */
  remarks: string;
  /** The category to preselect, or null when the line does not state one. */
  category: string | null;
  source: DescribedSource;
  /** One line saying how it was read, so the draft can be judged not trusted. */
  note: string;
};

/** A credit on a card statement that says, in any bank's dialect, "you paid". */
const PAYMENT = /\b(?:payment|paid|received|bbps|neft|imps|upi\s*(?:payment|cr)|autopay|auto\s*debit|thank\s*you)\b/i;

/* Words that say what a thing IS rather than who sold it. Only these earn a
   category. Ordered: the first hit wins, so "MEDPLUS FUEL STATION" cannot
   happen to read as fuel before it reads as medicine. */
const KIND_WORDS: { re: RegExp; category: string }[] = [
  { re: /\b(?:pharmac\w*|medical[s]?|medicine[s]?|chemist|hospital|clinic|diagnostic\w*|lab)\b/i, category: 'Medicine' },
  { re: /\b(?:petrol\w*|diesel|fuel|filling\s*station|iocl|indian\s*oil|hpcl|hp\s*petrol|bpcl|bharat\s*petro\w*|nayara|reliance\s*petro\w*|shell)\b/i, category: 'Fuel' },
  { re: /\b(?:swiggy|zomato|restaurant|cafe|café|bakery|hotel|food|kitchen|dhaba|tea\s*shop)\b/i, category: 'Food' },
  { re: /\b(?:supermarket|super\s*market|grocer\w*|hypermarket|provision\w*|vegetable[s]?|fruits?)\b/i, category: 'Groceries' },
];

/* Noise the bank adds and this ledger never wants: card and reference numbers,
   masked digits, terminal ids, and the trailing country the network appends.
   Removed BEFORE the meaningful-words test, so a line that is only a reference
   number correctly comes out as Unknown rather than as its own digits. */
const NOISE_PATTERNS: RegExp[] = [
  /\b[Xx*#]{2,}\d*\b/g,            // 4076XX…, ****1234
  /\b\d{5,}\b/g,                   // reference and terminal numbers
  /\b[A-Z0-9]*\d[A-Z0-9]*\d[A-Z0-9]*\b(?=\s|$)/g, // mixed alphanumeric refs
  /\b(?:pos|ecom|e-?com|txn|trn|ref(?:no)?|auth|merchant\s*id|mid|tid)\b/gi,
  /\b(?:ind|in|india|ind\.)\s*$/i,
];

/** Short forms this ledger writes in capitals; title-casing them is wrong. */
const ACRONYMS = new Set([
  'GST', 'IGST', 'CGST', 'SGST', 'UTGST', 'KSEB', 'ATM', 'EMI', 'UPI', 'NEFT',
  'IMPS', 'RTGS', 'BBPS', 'TV', 'AC', 'LIC', 'SBI', 'HDFC', 'ICICI', 'IT',
]);

/**
 * The bank's casing, turned into this ledger's.
 *
 * Title case rather than sentence case: most of what survives the noise strip
 * is a name — a person, a shop, a town — and "Abdul Mujeeb Moozhikkal" reads
 * as a name where "Abdul mujeeb moozhikkal" reads as a typo. A word that is
 * already mixed case came from the bank that way on purpose and is left alone.
 */
function houseCase(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      const bare = w.replace(/[^A-Za-z]/g, '');
      if (ACRONYMS.has(bare.toUpperCase())) return w.toUpperCase();
      // Mixed case already — the bank meant it (McDonald, iPhone, BookMyShow).
      if (/[a-z]/.test(w) && /[A-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function tidy(text: string): string {
  let out = text ?? '';
  for (const re of NOISE_PATTERNS) out = out.replace(re, ' ');
  out = out
    .replace(/[|;:,._\-/\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return houseCase(out);
}

/** True when what survives is words a person could recognise, not debris. */
function meaningful(text: string): boolean {
  return /[A-Za-z]{3}/.test(text);
}

/**
 * A draft entry for one statement line.
 *
 * `card` is the card the statement belongs to — needed because a payment ON a
 * card is categorised AS that card, which is how this ledger records a bill
 * being cleared.
 */
export function describeStatementLine(
  line: { description: string; direction: 'debit' | 'credit' },
  card: string,
): Described {
  const text = line.description ?? '';

  /* A credit that says it is a payment is the bill being cleared. This ledger
     writes that one exact way — remarks "Cleared", category the card — so it
     is the one case where the bank's own words are replaced outright. */
  if (line.direction === 'credit' && PAYMENT.test(text)) {
    return {
      remarks: 'Cleared',
      category: card,
      source: 'payment',
      note: `Read as the ${card} bill being paid.`,
    };
  }

  const flag = chargeFlag(text);
  if (flag && flag.kind !== 'emi' && flag.kind !== 'reversal') {
    /* The bank's charge lines are long and full of rate codes — "IGST-CI@18%",
       "FUEL SURCHARGE WAIVER REVERSAL 1.00%". What this ledger keeps is which
       kind it was; the amount and the date carry the rest. */
    const fuel = /\bfuel\b/i.test(text) && flag.kind === 'fee';
    const remarks = fuel ? 'Fuel surcharge' : { tax: 'Tax', fee: 'Fee', interest: 'Interest' }[flag.kind];
    return {
      remarks,
      category: flag.kind === 'tax' ? 'Taxes' : 'Surcharge',
      source: 'charge',
      note: `The bank added this — read as ${flag.label.toLowerCase()}.`,
    };
  }

  const cleaned = tidy(text);
  if (!meaningful(cleaned)) {
    return {
      remarks: 'Unknown',
      category: null,
      source: 'unknown',
      note: 'Nothing readable in the bank’s text — name it before saving.',
    };
  }

  const kind = KIND_WORDS.find((k) => k.re.test(text));
  return {
    remarks: cleaned,
    category: kind ? kind.category : null,
    source: 'merchant',
    note: kind
      ? `Named from the statement; ${kind.category.toLowerCase()} because the line says so.`
      : 'Named from the statement. The category is a guess nobody should make for you.',
  };
}
