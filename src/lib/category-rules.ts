import { payeeKey, PICKABLE_CATEGORIES } from '@/lib/payee-hint';

/* ===========================================================================
   The owner's own rules: "a name containing these words is this category".

   A photo of a payment to "Usman P P" cannot say what it was for, and the
   reading is told never to guess (lib/import-prompt). A rule is not a guess:
   it is the owner saying, once, what every payment to that name is — the way
   `bank_methods` says once that "Federal 2788" is Fi.

   Stored in app_config as `category_rules`, edited on Settings and from the
   "needs a detail" list. A rule FILLS A BLANK CATEGORY ONLY: it never
   replaces one the photo showed or a person chose. A rule may also carry a
   DESCRIPTION, put in front of the name the photo showed (`described`). It applies to rows read
   off photos (lib/draft-entries) and, when a rule is saved, to photo entries
   still waiting for their category (lib/draft-auto: fillFromRules).

   Matching is on whole words, case and punctuation ignored: "bakery" matches
   "K K Bakery Coolbar" but not "Bakerystreet". When two rules match, the one
   with more words wins — "kk bakery" is more specific than "bakery".

   Pure: config in, rules out; text in, a rule out.
   =========================================================================== */

export type CategoryRule = {
  words: string;
  category: string;
  /** What to call the payment, e.g. "Tea shop" for "NIBRASIL HAQ P" — see `described`. */
  description?: string;
};

/**
 * The description a rule gives: its own words first, the name the payment
 * screen showed kept after it in brackets — "Tea shop (NIBRASIL HAQ P)" — so
 * who was paid is never lost, and the rule still finds the name next time.
 * Unchanged when the rule has no description or it is already there.
 */
export function described(remarks: string, rule: Pick<CategoryRule, 'description'> | null): string {
  const desc = rule?.description?.trim();
  if (!desc) return remarks;
  const name = remarks.trim();
  if (!name) return desc;
  if (payeeKey(name).startsWith(payeeKey(desc))) return remarks;
  return `${desc} (${name})`;
}

export const RULES_KEY = 'category_rules';

/** The rules as stored; anything malformed or naming an unknown category is skipped. */
export function rulesFrom(config: Record<string, unknown>): CategoryRule[] {
  const raw = config[RULES_KEY];
  if (!Array.isArray(raw)) return [];
  const out: CategoryRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { words, category, description } = r as Record<string, unknown>;
    if (typeof words !== 'string' || typeof category !== 'string') continue;
    if (!payeeKey(words) || !PICKABLE_CATEGORIES.includes(category)) continue;
    const desc = typeof description === 'string' ? description.trim() : '';
    out.push({ words: words.trim(), category, ...(desc ? { description: desc } : {}) });
  }
  return out;
}

/** Problems with a list about to be saved, or null. */
export function ruleErrors(rules: CategoryRule[]): string | null {
  const seen = new Set<string>();
  for (const r of rules) {
    const key = payeeKey(r.words ?? '');
    if (!key) return 'A rule needs at least one word to look for.';
    if (!PICKABLE_CATEGORIES.includes(r.category)) return `"${r.category}" is not a category a rule can set.`;
    if (seen.has(key)) return `"${r.words}" is listed twice.`;
    seen.add(key);
  }
  return null;
}

/** The rule a description falls under, or null. */
export function ruleFor(remarks: string, rules: CategoryRule[]): CategoryRule | null {
  const text = ` ${payeeKey(remarks)} `;
  if (text.trim() === '') return null;
  let best: { rule: CategoryRule; words: number; length: number } | null = null;
  for (const rule of rules) {
    const key = payeeKey(rule.words);
    if (!key || !text.includes(` ${key} `)) continue;
    const words = key.split(' ').length;
    if (!best || words > best.words || (words === best.words && key.length > best.length)) {
      best = { rule, words, length: key.length };
    }
  }
  return best?.rule ?? null;
}

/** Add a rule, or change the one with the same words. */
export function withRule(rules: CategoryRule[], rule: CategoryRule): CategoryRule[] {
  const key = payeeKey(rule.words);
  const desc = rule.description?.trim();
  return [
    ...rules.filter((r) => payeeKey(r.words) !== key),
    { words: rule.words.trim(), category: rule.category, ...(desc ? { description: desc } : {}) },
  ];
}
