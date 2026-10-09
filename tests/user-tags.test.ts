import { describe, expect, it } from 'vitest';
import {
  addTag, bracketLabels, comparableRemarks, joinTags, labelToTag, normaliseTag, removeTag,
  renameTag, splitTags, tagKey, uniqueTags,
} from '@/lib/user-tags';
import { tagSummaries, labelSuggestions } from '@/lib/tag-summary';
import { applyFilters, readFilters } from '@/app/transactions/filters';
import { parseImport } from '@/lib/import-parse';
import { byTag } from '@/lib/analytics';
import { makeSnapshot, tx } from './helpers';

describe('tags in remarks', () => {
  it('splits the words from the tags, and joins them back', () => {
    expect(splitTags('Dinner [Banglore Trip]')).toEqual({ text: 'Dinner', tags: ['Banglore Trip'] });
    expect(splitTags('Tea [A] at stall [B]')).toEqual({ text: 'Tea at stall', tags: ['A', 'B'] });
    expect(joinTags('Dinner', ['Banglore Trip', 'Work'])).toBe('Dinner [Banglore Trip] [Work]');
    expect(joinTags('', ['Trip'])).toBe('[Trip]');
  });

  it('treats one tag spelled two ways as one tag, keeping the first spelling', () => {
    expect(uniqueTags(['Banglore Trip', 'banglore  trip', 'Work'])).toEqual(['Banglore Trip', 'Work']);
    expect(tagKey('Banglore  TRIP')).toBe(tagKey('banglore trip'));
    expect(splitTags('x [Trip] [trip]').tags).toEqual(['Trip']);
  });

  it('cleans a typed name, and refuses an empty one', () => {
    expect(normaliseTag('  Banglore   Trip ')).toBe('Banglore Trip');
    expect(normaliseTag('[]|')).toBeNull();
    expect(normaliseTag('a'.repeat(60))).toHaveLength(40);
  });

  it('adds, removes and renames without disturbing anything else', () => {
    expect(addTag('Dinner [Work]', 'Trip')).toBe('Dinner [Work] [Trip]');
    expect(addTag('Dinner [Trip]', 'trip')).toBe('Dinner [Trip]');
    expect(removeTag('Dinner [Work] [Trip]', 'work')).toBe('Dinner [Trip]');
    expect(renameTag('Dinner [Blr]', 'blr', 'Banglore Trip')).toBe('Dinner [Banglore Trip]');
    // Renaming onto a tag the entry already has merges them.
    expect(renameTag('Dinner [A] [B]', 'A', 'B')).toBe('Dinner [B]');
  });

  it('turns one exact bracket label into a tag and leaves every other bracket', () => {
    expect(labelToTag('Dinner (Banglore Trip) (GST)', 'banglore trip', 'Banglore Trip'))
      .toBe('Dinner (GST) [Banglore Trip]');
    expect(labelToTag('Dinner (GST)', 'Banglore Trip', 'Banglore Trip')).toBe('Dinner (GST)');
  });

  it('offers only labels that read like occasions', () => {
    expect(bracketLabels('Phone (Sheya) EMI (4/6) (199) (Banglore Trip)')).toEqual(['Sheya', 'Banglore Trip']);
  });

  it('compares remarks for the Sheet with tags left out on both sides', () => {
    const known = new Set([tagKey('Banglore Trip')]);
    expect(comparableRemarks('Dinner [Banglore Trip]', known)).toBe('Dinner');
    expect(comparableRemarks('Dinner (Banglore Trip)', known)).toBe('Dinner');
    expect(comparableRemarks('Dinner (GST)', known)).toBe('Dinner (GST)');
  });
});

describe('tags across the app', () => {
  const rows = [
    tx({ id: 'a', ts: '2026-08-18T20:00:00', amount: 180, category: 'Food', userTags: ['Banglore Trip'] }),
    tx({ id: 'b', ts: '2026-08-19T09:00:00', amount: 500, category: 'Fuel', userTags: ['Banglore Trip'] }),
    tx({ id: 'c', ts: '2026-08-19T10:00:00', amount: 1208, category: 'Credit Given', remarks: 'Bus for Jinan', userTags: ['Banglore Trip'] }),
    tx({ id: 'd', ts: '2026-08-25T10:00:00', amount: 60, category: 'Food', remarks: 'Tea' }),
    tx({ id: 'e', ts: '2026-07-01T10:00:00', amount: 300, category: 'Food', remarks: 'Lunch (Trip Ponnani)' }),
  ];
  const snap = makeSnapshot({ transactions: rows });

  it('totals a tag: everything, spending only, and lending', () => {
    const blr = tagSummaries(snap).find((t) => t.tag === 'Banglore Trip')!;
    expect(blr).toMatchObject({ count: 3, total: 1888, spent: 680, lent: 1208, first: '2026-08-18', last: '2026-08-19', stored: 3 });
    expect(blr.byCategory[0]).toMatchObject({ category: 'Credit Given', total: 1208 });
  });

  it('still counts an old "(Trip X)" label, marked as not yet a real tag', () => {
    const old = tagSummaries(snap).find((t) => t.tag === 'Trip Ponnani')!;
    expect(old).toMatchObject({ count: 1, total: 300, stored: 0 });
    expect(labelSuggestions(snap, 1).map((s) => s.label)).toContain('Trip Ponnani');
  });

  it('breaks spending down by tag', () => {
    expect(byTag(rows.filter((t) => t.category !== 'Credit Given')).map((b) => [b.key, b.total]))
      .toEqual([['Banglore Trip', 680], ['Trip Ponnani', 300]]);
  });

  it('filters Entries by tag, by a span of days, and finds a tag by search', () => {
    const now = '2026-12-31T23:59:59';
    const ids = (sp: Record<string, string>) => applyFilters(rows, readFilters(sp), now).map((t) => t.id).sort();
    expect(ids({ tag: 'banglore trip' })).toEqual(['a', 'b', 'c']);
    expect(ids({ from: '2026-08-19', to: '2026-08-25' })).toEqual(['b', 'c', 'd']);
    expect(ids({ q: 'banglore' })).toEqual(['a', 'b', 'c']);
  });

  it('reads a [Tag] out of a pasted description', () => {
    const r = parseImport('18/08/2026 | 180 | Fi | Food | Dinner [Banglore Trip]').rows[0]!;
    expect(r.remarks).toBe('Dinner');
    expect(r.tags).toEqual(['Banglore Trip']);
  });
});
