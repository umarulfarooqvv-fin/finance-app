import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { parseUserAmount } from '@/lib/money';
import { ALL_CATEGORIES, ALL_METHODS, isCard } from '@/lib/types';

/* ===========================================================================
   Turning spoken words into a transaction DRAFT.

   Two rules govern this whole file:

   1. IT PRODUCES A DRAFT, NEVER A ROW. Speech recognition mishears, and a
      finance app that writes what it thought it heard is worse than one with
      no voice entry at all. Everything here ends in a pre-filled form the
      user confirms. There is no path from this module to the database.

   2. IT NEVER INVENTS A FIELD. The model is told to return null for anything
      it did not actually hear, and any method or category it returns that is
      not in the app's own list is dropped. A guessed payment method silently
      moves debt onto the wrong card, which is exactly the error that is
      hardest to notice later.

   The audio itself never reaches this server: transcription happens on the
   device via the browser's speech API, and only the transcript is sent.
   =========================================================================== */

export type ParsedEntry = {
  amount: string | null;
  method: string | null;
  category: string | null;
  remarks: string;
  /** Fields the model was unsure about, for the form to highlight. */
  uncertain: string[];
  /** What the model understood, in one line, for the user to sanity-check. */
  interpretation: string;
};

export type ParseResult =
  | { ok: true; draft: ParsedEntry }
  | { ok: false; error: string; needsKey?: boolean };

export function parserConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_entry',
  description: 'Report the transaction details heard in the transcript.',
  input_schema: {
    type: 'object',
    properties: {
      amount: {
        type: ['string', 'null'],
        description:
          'The amount as digits only, e.g. "480" or "1234.50". Indian spoken forms: ' +
          '"four eighty" is 480, "twelve hundred" is 1200, "two and a half thousand" is 2500, ' +
          '"fifteen hundred" is 1500. Null if no amount was stated.',
      },
      method: {
        type: ['string', 'null'],
        description:
          `Where the money came from. Must be exactly one of: ${ALL_METHODS.join(', ')}. ` +
          'Match loosely spoken forms to these ("one card", "icici bank", "scapia card"). ' +
          'Null if the transcript does not say.',
      },
      category: {
        type: ['string', 'null'],
        description:
          `What it was for. Must be exactly one of: ${ALL_CATEGORIES.join(', ')}. ` +
          'A card name as the category means paying that card bill. Null if unclear — ' +
          'do not guess a category from the description alone unless it is obvious.',
      },
      remarks: {
        type: 'string',
        description:
          'A short description of what was bought, in the user\'s own words, cleaned of ' +
          'the amount and payment method. Empty string if there is nothing to say.',
      },
      uncertain: {
        type: 'array',
        items: { type: 'string', enum: ['amount', 'method', 'category', 'remarks'] },
        description: 'Fields you are NOT confident about. Be honest — a flagged field is highlighted for the user rather than silently trusted.',
      },
      interpretation: {
        type: 'string',
        description: 'One short sentence describing what you understood, for the user to check.',
      },
    },
    required: ['amount', 'method', 'category', 'remarks', 'uncertain', 'interpretation'],
    additionalProperties: false,
  },
  strict: true,
};

function systemPrompt(): string {
  return [
    'You extract transaction details from a spoken phrase for a personal finance app used in India.',
    '',
    `Payment methods: ${ALL_METHODS.join(', ')}.`,
    `Categories: ${ALL_CATEGORIES.join(', ')}.`,
    'Amounts are Indian rupees.',
    '',
    'Rules:',
    '- Return null for anything the transcript does not actually state. Never fill a field by assumption.',
    '- The method is WHERE THE MONEY CAME FROM. "on Coral" or "by Coral" means the Coral card.',
    '- A CARD NAME as the category means paying that card\'s bill, e.g. "paid 5000 to ICICI from Fi" is method Fi, category ICICI.',
    '- "Credit Given" is money lent to a person; the person\'s name belongs in remarks.',
    '- Speech recognition makes mistakes. If a word could be a method but is mangled, match it only if the match is obvious; otherwise return null and flag it as uncertain.',
    '- Keep remarks short and in the user\'s own words. Strip the amount and the method from them.',
  ].join('\n');
}

/** Drop anything the app does not recognise rather than passing it through.
    Exported for tests: this is the safety layer, and it must be provable
    without an API key or a network call. */
export function sanitise(raw: Record<string, unknown>): ParsedEntry {
  const uncertain = new Set(
    Array.isArray(raw['uncertain']) ? (raw['uncertain'] as string[]) : [],
  );

  const rawMethod = typeof raw['method'] === 'string' ? raw['method'].trim() : null;
  const method = rawMethod && (ALL_METHODS as readonly string[]).includes(rawMethod) ? rawMethod : null;
  if (rawMethod && !method) uncertain.add('method');

  const rawCategory = typeof raw['category'] === 'string' ? raw['category'].trim() : null;
  const category =
    rawCategory && (ALL_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : null;
  if (rawCategory && !category) uncertain.add('category');

  // Re-parse the amount through the app's own parser, so anything it would
  // reject in the form is caught here rather than at submit.
  const rawAmount = raw['amount'];
  const parsed = parseUserAmount(typeof rawAmount === 'string' || typeof rawAmount === 'number' ? rawAmount : null);
  const amount = parsed.ok && parsed.amount > 0 ? String(parsed.amount) : null;
  if (rawAmount != null && !amount) uncertain.add('amount');

  // Paying a card from itself is not a thing; treat it as a misheard method.
  if (method && category && isCard(category) && method === category) {
    uncertain.add('method');
  }

  for (const field of ['amount', 'method', 'category'] as const) {
    const value = { amount, method, category }[field];
    if (value === null) uncertain.add(field);
  }

  return {
    amount,
    method,
    category,
    remarks: typeof raw['remarks'] === 'string' ? raw['remarks'].trim().slice(0, 200) : '',
    uncertain: [...uncertain],
    interpretation:
      typeof raw['interpretation'] === 'string' ? raw['interpretation'].slice(0, 200) : '',
  };
}

export async function parseSpokenEntry(transcript: string): Promise<ParseResult> {
  if (!parserConfigured()) {
    return { ok: false, needsKey: true, error: 'Set ANTHROPIC_API_KEY to enable voice entry.' };
  }

  const text = transcript.trim();
  if (!text) return { ok: false, error: 'Nothing was heard. Try again.' };
  if (text.length > 500) return { ok: false, error: 'That was too long for one entry.' };

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      // A short extraction, not a reasoning problem — low effort keeps this
      // fast enough to feel immediate after speaking.
      output_config: { effort: 'low' },
      system: systemPrompt(),
      tools: [EXTRACT_TOOL],
      // Forced, so the reply is always the structured shape and never prose.
      tool_choice: { type: 'tool', name: 'record_entry' },
      messages: [{ role: 'user', content: `Transcript: "${text}"` }],
    });

    const call = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_entry',
    );
    if (!call) return { ok: false, error: 'Could not make sense of that. Try rephrasing.' };

    return { ok: true, draft: sanitise(call.input as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, needsKey: true, error: 'The Anthropic API key was rejected.' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited. Try again in a moment.' };
    }
    console.error('[parse-entry]', err);
    return { ok: false, error: 'Could not reach the parser. Type the entry instead.' };
  }
}
