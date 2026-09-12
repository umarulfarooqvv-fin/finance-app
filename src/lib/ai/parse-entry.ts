import 'server-only';
import { parseUserAmount } from '@/lib/money';
import { ALL_CATEGORIES, ALL_METHODS, isCard } from '@/lib/types';
import { parseLocally } from '@/lib/ai/local-parser';
import { askProvider, providerConfig } from '@/lib/ai/providers';

/* ===========================================================================
   Turning a spoken phrase into a transaction DRAFT.

   The order matters:

     1. The LOCAL parser runs first. It is free, instant, works offline, and
        cannot invent a payment method because it can only return one from the
        app's own list. Most entries never need anything else.
     2. If something is still missing AND a provider is configured, a model is
        asked to fill only the gaps. It cannot overwrite a field the local
        parser already resolved — a deterministic reading beats a probabilistic
        one when both are available.
     3. Whatever the source, the result is sanitised against the app's lists
        and handed to the user as a form to confirm.

   Two rules hold throughout:

   IT PRODUCES A DRAFT, NEVER A ROW. There is no path from this module to the
   database. Speech recognition mishears numbers routinely, so a person always
   sees the entry before it is saved.

   IT NEVER INVENTS A FIELD. Anything neither parser could determine comes back
   null and is flagged. A guessed payment method silently moves debt onto the
   wrong card, which is the error hardest to notice weeks later when the
   statement does not match.

   The audio never reaches the server: transcription happens on the device and
   only the transcript is sent.
   =========================================================================== */

export type ParsedEntry = {
  amount: string | null;
  method: string | null;
  category: string | null;
  remarks: string;
  /** Fields that are missing or that the app could not verify. */
  uncertain: string[];
  /** Where the suggestion came from, shown so it is never a mystery. */
  source: string;
};

export type ParseResult =
  | { ok: true; draft: ParsedEntry }
  | { ok: false; error: string };

/** Voice entry always works — the local parser needs no configuration. */
export function parserConfigured(): boolean {
  return true;
}

/** Which model, if any, is available to fill gaps. */
export function assistLabel(): string {
  return providerConfig().label;
}

/**
 * Drop anything the app does not recognise rather than passing it through.
 * Exported for tests: this is the safety layer, and it must be provable
 * without a key or a network call.
 */
export function sanitise(raw: Record<string, unknown>, source = 'offline parser'): ParsedEntry {
  const uncertain = new Set<string>(
    Array.isArray(raw['uncertain']) ? (raw['uncertain'] as string[]) : [],
  );

  const rawMethod = typeof raw['method'] === 'string' ? raw['method'].trim() : null;
  const method = rawMethod && (ALL_METHODS as readonly string[]).includes(rawMethod) ? rawMethod : null;
  if (rawMethod && !method) uncertain.add('method');

  const rawCategory = typeof raw['category'] === 'string' ? raw['category'].trim() : null;
  const category =
    rawCategory && (ALL_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : null;
  if (rawCategory && !category) uncertain.add('category');

  // Re-parse through the app's own parser, so anything the form would reject
  // is caught here rather than at submit.
  const rawAmount = raw['amount'];
  const parsed = parseUserAmount(
    typeof rawAmount === 'string' || typeof rawAmount === 'number' ? rawAmount : null,
  );
  const amount = parsed.ok && parsed.amount > 0 ? String(parsed.amount) : null;
  if (rawAmount != null && !amount) uncertain.add('amount');

  // Paying a card from itself is not a transaction; the method was misheard.
  if (method && category && isCard(category) && method === category) uncertain.add('method');

  for (const [field, value] of [['amount', amount], ['method', method], ['category', category]] as const) {
    if (value === null) uncertain.add(field);
  }

  return {
    amount,
    method,
    category,
    remarks: typeof raw['remarks'] === 'string' ? raw['remarks'].trim().slice(0, 200) : '',
    uncertain: [...uncertain],
    source,
  };
}

export async function parseSpokenEntry(transcript: string): Promise<ParseResult> {
  const text = transcript.trim();
  if (!text) return { ok: false, error: 'Nothing was heard. Try again.' };
  if (text.length > 500) return { ok: false, error: 'That was too long for one entry.' };

  // 1. Free, instant, offline.
  const local = parseLocally(text);
  const cfg = providerConfig();

  // 2. Only call out if something is genuinely missing and help is available.
  if (local.missing.length === 0 || cfg.name === 'off') {
    return {
      ok: true,
      draft: sanitise(
        { amount: local.amount, method: local.method, category: local.category, remarks: local.remarks },
        'offline parser',
      ),
    };
  }

  const assisted = await askProvider(text);
  if (!assisted) {
    // The provider failed or timed out. The local parse still stands, which is
    // the whole reason it runs first.
    return {
      ok: true,
      draft: sanitise(
        { amount: local.amount, method: local.method, category: local.category, remarks: local.remarks },
        'offline parser',
      ),
    };
  }

  /* Merge, local first. A deterministic reading is never overwritten by a
     probabilistic one — the model only supplies what was missing. */
  const merged = {
    amount: local.amount ?? assisted.amount ?? null,
    method: local.method ?? assisted.method ?? null,
    category: local.category ?? assisted.category ?? null,
    remarks: local.remarks || (assisted.remarks ?? ''),
  };

  const draft = sanitise(merged, `offline parser + ${cfg.label}`);

  /* A field the model supplied is worth a second look, since it was a guess
     from context rather than something plainly stated. */
  const fromModel = (['amount', 'method', 'category'] as const).filter(
    (f) => local[f] === null && merged[f] !== null,
  );
  return { ok: true, draft: { ...draft, uncertain: [...new Set([...draft.uncertain, ...fromModel])] } };
}
