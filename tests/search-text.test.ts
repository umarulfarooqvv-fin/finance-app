import { describe, expect, it } from 'vitest';
import { foldForSearch, looseIncludes } from '@/lib/search-text';

describe('foldForSearch', () => {
  /* The case this exists for: the sheet stores a curled apostrophe, the
     keyboard types a straight one, and the row looks deleted. */
  it('makes a curled apostrophe findable by a straight one', () => {
    expect(looseIncludes('Sheya’s 23/24 Emi', "sheya's")).toBe(true);
    expect(looseIncludes("Sheya's 23/24 Emi", 'sheya’s')).toBe(true);
  });

  it('folds dashes, accents and case', () => {
    expect(looseIncludes('Café Coffee – Day', 'cafe coffee - day')).toBe(true);
    expect(looseIncludes('IGST-CI@18%', 'igst‑ci')).toBe(true);
  });

  it('collapses runs of whitespace', () => {
    expect(foldForSearch('  Tea   with  snacks ')).toBe('tea with snacks');
  });

  it('matches everything on an empty query', () => {
    expect(looseIncludes('anything', '')).toBe(true);
    expect(looseIncludes('anything', '   ')).toBe(true);
  });

  it('still refuses a genuine non-match', () => {
    expect(looseIncludes('Breakfast', 'dinner')).toBe(false);
  });
});
