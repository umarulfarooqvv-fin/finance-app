import { describe, expect, it } from 'vitest';
import { described, ruleErrors, ruleFor, rulesFrom, ruleWords, withRule } from '@/lib/category-rules';
import { payeeHint, payeeKey } from '@/lib/payee-hint';
import { draftEntries } from '@/lib/draft-entries';
import type { Transaction } from '@/lib/types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't', ts: '2026-10-01T10:00:00', amount: 50, method: 'Fi', category: 'Food', remarks: 'x', userTags: [],
  kind: 'spend', cardAffected: null, cardDirection: null, tags: {}, verified: false, needsReview: false,
  deleted: false, source: 'app', ...over,
} as Transaction);

describe('the owner’s category rules', () => {
  const rules = [
    { words: 'bakery', category: 'Food' },
    { words: 'KK Bakery', category: 'Groceries' },
    { words: 'Usman P P', category: 'Family' },
  ];

  it('matches whole words, ignoring case and punctuation', () => {
    expect(ruleFor('K K Bakery Coolbar', rules)?.category).toBe('Food');
    expect(ruleFor('Bakerystreet', rules)).toBeNull();
    expect(ruleFor('USMAN P.P.', rules)?.category).toBe('Family');
    expect(ruleFor('Usman', rules)).toBeNull();
  });

  it('the rule with more words wins', () => {
    expect(ruleFor('kk bakery, Calicut', rules)?.category).toBe('Groceries');
  });

  it('reads only well-formed rules naming a category a rule can set', () => {
    expect(rulesFrom({ category_rules: [
      { words: 'tea', category: 'Food' },
      { words: '  ', category: 'Food' },
      { words: 'card', category: 'Scapia' },
      'junk',
    ] })).toEqual([{ words: 'tea', category: 'Food' }]);
    expect(rulesFrom({})).toEqual([]);
  });

  it('refuses a blank rule, an unknown category, or the same words twice', () => {
    expect(ruleErrors([{ words: 'tea', category: 'Food' }])).toBeNull();
    expect(ruleErrors([{ words: '', category: 'Food' }])).toMatch(/word/);
    expect(ruleErrors([{ words: 'tea', category: 'Credit Return' }])).toMatch(/not a category/);
    expect(ruleErrors([{ words: 'Tea', category: 'Food' }, { words: 'tea.', category: 'Family' }])).toMatch(/twice/);
  });

  it('adding a rule for the same words replaces it', () => {
    expect(withRule([{ words: 'tea', category: 'Food' }], { words: 'TEA', category: 'Family' }))
      .toEqual([{ words: 'TEA', category: 'Family' }]);
  });

  it('a photo row with no category takes the rule; one the photo showed keeps its own', () => {
    const text = [
      '10/11/2026 15:22 | 36 | Fi |  | Usman P P',
      '10/11/2026 16:00 | 90 | Fi | Medicine | KK Bakery',
    ].join('\n');
    const d = draftEntries([{ id: 'p', ts: '2026-11-10T16:05:00', bytes: 1 }], { p: { text } }, {}, [], {}, '2026-11-11', rules);
    expect(d.find((x) => x.amount === 36)).toMatchObject({ category: 'Family', ruled: 'Usman P P', complete: true, auto: { add: true, missing: [] } });
    expect(d.find((x) => x.amount === 90)).toMatchObject({ category: 'Medicine', ruled: null });
  });

  it('a rule makes a row with neither payment nor category addable — the owner said what it is', () => {
    const d = draftEntries([{ id: 'p', ts: '2026-11-10T16:05:00', bytes: 1 }], { p: { text: '10/11/2026 15:22 | 36 |  |  | Usman P P' } }, {}, [], {}, '2026-11-11', rules);
    expect(d[0]!.auto).toEqual({ add: true, missing: ['method'] });
  });
});

describe('a rule that also remembers what to call it', () => {
  const tea = { words: 'Nibrasil Haq P', category: 'Food', description: 'Tea shop' };

  it('puts the description in front and keeps the name in brackets', () => {
    expect(described('NIBRASIL HAQ P', tea)).toBe('Tea shop (NIBRASIL HAQ P)');
    expect(described('', tea)).toBe('Tea shop');
    expect(described('Tea shop (NIBRASIL HAQ P)', tea)).toBe('Tea shop (NIBRASIL HAQ P)');
    expect(described('NIBRASIL HAQ P', { description: '' })).toBe('NIBRASIL HAQ P');
    expect(described('NIBRASIL HAQ P', null)).toBe('NIBRASIL HAQ P');
  });

  it('a rule made from an entry looks for the name it came with, not the description', () => {
    expect(ruleWords('MUHAMMED SUHAIL C H')).toBe('MUHAMMED SUHAIL C H');
    expect(ruleWords('Tea shop (NIBRASIL HAQ P)')).toBe('NIBRASIL HAQ P');
  });

  it('the described name still matches the rule next time', () => {
    expect(ruleFor('Tea shop (NIBRASIL HAQ P)', [tea])).toEqual(tea);
  });

  it('is kept when stored and when replaced', () => {
    expect(rulesFrom({ category_rules: [tea, { words: 'x', category: 'Food', description: '  ' }] }))
      .toEqual([tea, { words: 'x', category: 'Food' }]);
    expect(withRule([tea], { words: 'nibrasil haq p', category: 'Family', description: 'Uppa tea' }))
      .toEqual([{ words: 'nibrasil haq p', category: 'Family', description: 'Uppa tea' }]);
  });

  it('a photo row takes the description even when the photo showed a category', () => {
    const d = draftEntries([{ id: 'p', ts: '2026-11-13T20:40:00', bytes: 1 }], {
      p: { text: '13/11/2026 20:35 | 40 | Fi | Personal | NIBRASIL HAQ P' },
    }, {}, [], {}, '2026-11-14', [tea]);
    expect(d[0]).toMatchObject({ category: 'Personal', remarks: 'Tea shop (NIBRASIL HAQ P)', ruled: 'Nibrasil Haq P' });
  });
});

describe('suggesting what a name was filed under before', () => {
  it('compares names without case, punctuation or an [occasion]', () => {
    expect(payeeKey('MUHAMMED SALIH M. [Trip]')).toBe('muhammed salih m');
  });

  it('offers the category used most for the same name, never this entry’s own', () => {
    const me = tx({ id: 'me', remarks: 'Muhammed Salih M', category: '' });
    const h = payeeHint(me, [
      me,
      tx({ id: 'a', remarks: 'MUHAMMED SALIH M', category: 'Food', ts: '2026-09-01T10:00:00' }),
      tx({ id: 'b', remarks: 'muhammed salih m', category: 'Food' }),
      tx({ id: 'c', remarks: 'Muhammed Salih M', category: 'Family' }),
      tx({ id: 'd', remarks: 'Muhammed Salih M', category: 'Fuel', deleted: true }),
    ]);
    expect(h.category).toEqual({ value: 'Food', count: 2, of: 3 });
    expect(h.method).toBeNull();
  });

  it('a longer form of a two-word name is the same person; one word alone is not', () => {
    const me = tx({ id: 'me', remarks: 'MUHAMMED SUHAIL C H', category: '' });
    expect(payeeHint(me, [tx({ id: 'a', remarks: 'Muhammed Suhail', category: 'Family' })]).category?.value).toBe('Family');
    const usman = tx({ id: 'me', remarks: 'Usman P P', category: '' });
    expect(payeeHint(usman, [tx({ id: 'a', remarks: 'Usman', category: 'Food' })]).category).toBeNull();
  });

  it('offers a payment method too, when that is the blank', () => {
    const me = tx({ id: 'me', remarks: 'Hotel Soorya Bhavan', method: '', category: 'Food' });
    const h = payeeHint(me, [tx({ id: 'a', remarks: 'Hotel Soorya Bhavan', method: 'Scapia' })]);
    expect(h).toEqual({ category: null, method: { value: 'Scapia', count: 1, of: 1 } });
  });
});
