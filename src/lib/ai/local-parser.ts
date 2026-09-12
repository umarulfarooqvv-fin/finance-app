import { parseUserAmount } from '@/lib/money';
import { ALL_CATEGORIES, ALL_METHODS, isCard } from '@/lib/types';

/* ===========================================================================
   Parsing a spoken entry WITHOUT a model.

   This task looks like it needs an LLM and mostly does not. The vocabulary is
   closed and small — fourteen payment methods, twenty-one categories, and
   rupee amounts — so the work is matching against known lists, not open-ended
   understanding. Doing it locally is better on every axis that matters here:

     free          no key, no quota, no per-entry cost
     instant       no network round-trip between speaking and seeing the form
     offline       works in a shop with no signal, which is where entries
                   actually get made
     deterministic the same phrase always parses the same way, and every rule
                   below is unit-tested
     safe          it cannot invent a payment method, because it can only ever
                   return one from the list

   A model still earns its place on phrasing this cannot handle, so this runs
   first and a provider fills the gaps — see providers.ts. Whatever the source,
   the result is a draft the user confirms.
   =========================================================================== */

export type LocalParse = {
  amount: string | null;
  method: string | null;
  category: string | null;
  remarks: string;
  /** Fields this parser could not determine. */
  missing: string[];
};

/* --- Number words --------------------------------------------------------
   Indian English shorthand matters here: "four eighty" is 480, not 84, and
   "twelve hundred" is 1200. A recogniser transcribing speech produces these
   forms constantly. */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, lakh: 100000, lac: 100000, lakhs: 100000,
  crore: 10000000, crores: 10000000,
};

/**
 * Read a run of number words.
 *
 * Handles the ordinary form ("two thousand five hundred") and the Indian
 * shorthand where two groups are simply read out ("four eighty" = 480,
 * "twelve fifty" = 1250), which is how amounts are usually spoken aloud.
 */
export function wordsToNumber(words: string[]): number | null {
  if (words.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawAny = false;
  let half = false;
  // Tracks the shorthand case: a bare unit followed by a bare tens/teen.
  const parts: number[] = [];

  for (const word of words) {
    if (word === 'and') continue;
    if (word === 'half') { half = true; sawAny = true; continue; }
    if (word === 'a' || word === 'an') continue;

    if (word in UNITS) { current += UNITS[word] as number; parts.push(UNITS[word] as number); sawAny = true; continue; }
    if (word in TENS) { current += TENS[word] as number; parts.push(TENS[word] as number); sawAny = true; continue; }

    if (word in SCALES) {
      const scale = SCALES[word] as number;
      const base = current === 0 ? 1 : current;
      if (scale === 100) current = base * 100;
      else { total += (base + (half ? 0.5 : 0)) * scale; current = 0; half = false; }
      parts.length = 0;
      sawAny = true;
      continue;
    }
    return null; // a word that is not part of a number ends the run
  }

  if (!sawAny) return null;

  /* Shorthand: exactly two groups, no scale word used, first a unit and second
     a tens or teen — "four eighty" is 480, "twelve fifty" is 1250. Adding them
     (84, 62) would be wrong in every real usage. */
  if (total === 0 && parts.length === 2) {
    const [a, b] = parts as [number, number];
    const aIsLead = a >= 1 && a <= 99;
    const bIsTrail = b >= 10 && b <= 99;
    if (aIsLead && bIsTrail) return Number(`${a}${String(b).padStart(2, '0')}`);
  }

  const value = total + current + (half ? 0.5 : 0);
  return value > 0 ? value : null;
}

/** Digits, "2k", "1.5k", or number words. */
function extractAmount(text: string): { amount: number; consumed: string[] } | null {
  // Digits first — the recogniser usually produces these for clear speech.
  const digits = text.match(/(?:₹|rs\.?|rupees?)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k|thousand)?/i);
  if (digits?.[1]) {
    const parsed = parseUserAmount(digits[1]);
    if (parsed.ok) {
      const multiplier = digits[2] ? 1000 : 1;
      return { amount: parsed.amount * multiplier, consumed: [digits[0]] };
    }
  }

  // Otherwise look for the longest run of number words.
  const tokens = text.toLowerCase().split(/\s+/);
  let best: { amount: number; consumed: string[] } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = tokens.length; j > i; j--) {
      const run = tokens.slice(i, j);
      const value = wordsToNumber(run);
      if (value !== null && (best === null || run.length > best.consumed.length)) {
        best = { amount: value, consumed: run };
      }
    }
  }
  return best;
}

/* --- Methods and categories ---------------------------------------------- */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Spoken forms that do not match a method name letter for letter. */
const METHOD_ALIASES: Record<string, string> = {
  onecard: 'One Card', onecards: 'One Card',
  supermoney: 'Super Money', super: 'Super Money',
  icicibank: 'ICICI', icic: 'ICICI',
  fibank: 'Fi', fimoney: 'Fi',
  scapiacard: 'Scapia',
  coralcard: 'Coral',
  edgecard: 'Edge', axisedge: 'Edge',
  points: 'Perks', rewards: 'Perks', rewardpoints: 'Perks',
  statebank: 'SBI',
};

/** Words that imply a category without naming it. */
const CATEGORY_KEYWORDS: Record<string, string> = {
  lunch: 'Food', dinner: 'Food', breakfast: 'Food', tea: 'Food', coffee: 'Food',
  snack: 'Food', snacks: 'Food', food: 'Food', restaurant: 'Food', juice: 'Food',
  meal: 'Food', biryani: 'Food', hotel: 'Food',
  petrol: 'Fuel', diesel: 'Fuel', fuel: 'Fuel', gas: 'Fuel',
  medicine: 'Medicine', medicines: 'Medicine', pharmacy: 'Medicine',
  doctor: 'Medicine', hospital: 'Medicine', tablet: 'Medicine',
  grocery: 'Groceries', groceries: 'Groceries', vegetables: 'Groceries',
  fruits: 'Groceries', supermarket: 'Groceries',
  movie: 'Entertainment', cinema: 'Entertainment', game: 'Entertainment',
  netflix: 'Entertainment',
  tax: 'Taxes', taxes: 'Taxes', gst: 'Taxes',
  surcharge: 'Surcharge', charge: 'Surcharge', interest: 'Surcharge', fee: 'Surcharge',
  gift: 'Gifts/Donations', donation: 'Gifts/Donations', donated: 'Gifts/Donations',
  repair: 'Maintenance', service: 'Maintenance', servicing: 'Maintenance',
  lent: 'Credit Given', lend: 'Credit Given', loaned: 'Credit Given',
  borrowed: 'Credit Given',
};

/** Verbs that mean "this was a bill payment", used with a card name. */
const PAYMENT_VERBS = /\b(paid|pay|cleared|clearing|settle[d]?|bill)\b/i;

/** Every payment method named in the phrase, longest match first so that
    "one card" wins over a stray "one". */
function findMethods(tokens: string[]): { value: string; at: number; span: number }[] {
  const hits: { value: string; at: number; span: number }[] = [];
  const taken = new Set<number>();

  for (let span = 3; span >= 1; span--) {
    for (let i = 0; i + span <= tokens.length; i++) {
      if (Array.from({ length: span }, (_, k) => i + k).some((k) => taken.has(k))) continue;
      const phrase = squash(tokens.slice(i, i + span).join(''));
      if (!phrase) continue;
      const value = ALL_METHODS.find((m) => squash(m) === phrase) ?? METHOD_ALIASES[phrase];
      if (value) {
        hits.push({ value, at: i, span });
        for (let k = 0; k < span; k++) taken.add(i + k);
      }
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/**
 * The spending category.
 *
 * `allowCards` is the important parameter. A card name IS a valid category —
 * it means "this paid that card's bill" — but only when the phrase actually
 * says so. Without the guard, "600 petrol Scapia" reads Scapia as the
 * category, which then collides with Scapia as the method and the whole entry
 * collapses. A card name on its own is where the money came FROM.
 */
function findCategory(
  tokens: string[],
  { allowCards }: { allowCards: boolean },
): { value: string; at: number } | null {
  const pool = allowCards
    ? ALL_CATEGORIES
    : ALL_CATEGORIES.filter((c) => !isCard(c));

  for (let span = 2; span >= 1; span--) {
    for (let i = 0; i + span <= tokens.length; i++) {
      const phrase = squash(tokens.slice(i, i + span).join(''));
      if (!phrase) continue;
      const direct = pool.find((c) => squash(c) === phrase);
      if (direct) return { value: direct, at: i };
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const hit = CATEGORY_KEYWORDS[squash(tokens[i] ?? '')];
    if (hit) return { value: hit, at: i };
  }
  return null;
}

/* --- The parser ----------------------------------------------------------- */

const NOISE = new Set([
  'add', 'entry', 'spent', 'spend', 'paid', 'pay', 'for', 'on', 'from', 'by',
  'with', 'using', 'to', 'the', 'a', 'an', 'of', 'rupees', 'rupee', 'rs',
  'today', 'please', 'record', 'put', 'i', 'my', 'it', 'was', 'and', 'cleared',
]);

export function parseLocally(transcript: string): LocalParse {
  const text = transcript.trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase());

  const amountHit = extractAmount(text);
  const methodHits = findMethods(lower);
  const isPayment = PAYMENT_VERBS.test(text);

  let method: string | null = null;
  let category: string | null = null;
  let categoryHit: { value: string; at: number } | null = null;

  /* "paid 5000 to ICICI from Fi" — a card named alongside a payment verb is
     the card being SETTLED, so it is the category. Reading it as the method
     would ADD debt to the card the entry is clearing: the sign of the whole
     transaction inverts. */
  const cardHits = methodHits.filter((m) => isCard(m.value));

  if (isPayment && cardHits.length > 0) {
    const settled = cardHits[0] as { value: string; at: number };
    category = settled.value;
    categoryHit = { value: settled.value, at: settled.at };
    // The source is any OTHER method named — "from Fi", "by Perks".
    method = methodHits.find((m) => m.value !== settled.value)?.value ?? null;
  } else {
    method = methodHits[0]?.value ?? null;
    categoryHit = findCategory(lower, { allowCards: false });
    category = categoryHit?.value ?? null;
  }

  // Belt and braces: a card can never pay its own bill.
  if (method && category && isCard(category) && method === category) method = null;

  // Remarks: whatever is left once the recognised parts are removed.
  const consumed = new Set<string>();
  for (const word of amountHit?.consumed ?? []) {
    for (const part of word.toLowerCase().split(/\s+/)) consumed.add(part);
  }
  for (const hit of methodHits) {
    for (const w of hit.value.toLowerCase().split(/\s+/)) consumed.add(w);
  }
  if (categoryHit) for (const w of categoryHit.value.toLowerCase().split(/\s+/)) consumed.add(w);

  const remarks = tokens
    .filter((t) => {
      const l = t.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!l) return false;
      if (consumed.has(t.toLowerCase()) || consumed.has(l)) return false;
      if (/^\d/.test(l)) return false;
      return !NOISE.has(l);
    })
    .join(' ')
    .trim();

  const amount =
    amountHit && amountHit.amount > 0 ? String(Math.round(amountHit.amount * 100) / 100) : null;

  const missing: string[] = [];
  if (!amount) missing.push('amount');
  if (!method) missing.push('method');
  if (!category) missing.push('category');

  return { amount, method, category, remarks: remarks.slice(0, 200), missing };
}
