import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, MAX_TABS, PRIMARY_NAV_ITEMS, tabsCookie, tabsFrom } from '@/lib/nav-sections';

describe('the owner-arranged tab bar', () => {
  it('keeps the chosen pages in the chosen order', () => {
    expect(tabsFrom('/cards,/ledgers').map((i) => i.label)).toEqual(['Today', 'Cards', 'Ledgers']);
  });
  it('drops unknown and repeated pages, caps at the limit', () => {
    const many = ALL_NAV_ITEMS.map((i) => i.href).join(',');
    expect(tabsFrom(`/nope,/ledgers,/ledgers,${many}`)).toHaveLength(MAX_TABS);
    expect(tabsFrom('/nope,/ledgers,/ledgers,/cards').map((i) => i.href)).toEqual(['/', '/ledgers', '/cards']);
  });
  it('falls back to the default when the cookie is missing or too short', () => {
    expect(tabsFrom(null)).toEqual(PRIMARY_NAV_ITEMS);
    expect(tabsFrom('/ledgers')).toEqual(PRIMARY_NAV_ITEMS);
  });
  it('keeps Today first whatever the cookie says', () => {
    expect(tabsFrom('/ledgers,/,/cards').map((i) => i.href)).toEqual(['/', '/ledgers', '/cards']);
  });
  it('most used first: Today, then by use, then the chosen order fills the rest', () => {
    const t = tabsFrom('/cards,/transactions,/spending', { mode: 'auto', rank: '/tags,/,/ledgers' });
    expect(t.map((i) => i.href)).toEqual(['/', '/tags', '/ledgers', '/cards', '/transactions', '/spending']);
    expect(tabsFrom('/cards,/ledgers', { mode: 'fixed', rank: '/tags' }).map((i) => i.href)).toEqual(['/', '/cards', '/ledgers']);
  });
  it('reads back what it writes', () => {
    const value = tabsCookie(['/ledgers', '/']).split(';')[0]!.split('=')[1];
    expect(tabsFrom(value).map((i) => i.href)).toEqual(['/', '/ledgers']);
  });
});
