import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  EMPTY_VISITS, frequentPages, parseVisits, recentPages, recordVisit, type PageVisits,
} from '@/lib/page-history';
import { navItemFor } from '@/lib/nav-sections';

/* The ⌘K palette's Recent and Frequently used. Pure, so the ordering can be
   pinned without a browser: most recent first, frequency that follows what is
   used now rather than what was used once a lot. */

const visit = (...hrefs: string[]) => hrefs.reduce(recordVisit, EMPTY_VISITS as PageVisits);

test('recent is most-recent first, without the page already on screen', () => {
  const v = visit('/', '/cards', '/spending', '/inbox');
  assert.deepEqual(recentPages(v, '/inbox', 3), ['/spending', '/cards', '/']);
});

test('opening a page again moves it back to the top of recent', () => {
  const v = visit('/cards', '/spending', '/inbox', '/cards');
  assert.deepEqual(recentPages(v, null, 2), ['/cards', '/inbox']);
});

test('frequent ranks by use, and leaves out what recent already shows', () => {
  // Cards three times, Ask and Spending twice each, then Ledgers once.
  const v = visit('/cards', '/ask', '/cards', '/ask', '/cards', '/spending', '/tally', '/spending', '/ledgers', '/inbox');
  const recent = recentPages(v, '/inbox', 1);
  assert.deepEqual(recent, ['/ledgers']);
  // Spending edges Ask on the same count because its visits are more recent.
  assert.deepEqual(frequentPages(v, ['/inbox', ...recent], 4), ['/cards', '/spending', '/ask']);
});

test('one visit is recent, not frequent', () => {
  const v = visit('/cards', '/ask');
  assert.deepEqual(frequentPages(v, [], 4), []);
});

test('an old habit fades behind what is used now', () => {
  // Cards opened 20 times long ago; Inbox daily since, 12 times.
  let v = visit(...Array.from({ length: 20 }, (_, i) => (i % 2 ? '/cards' : '/')));
  for (let i = 0; i < 40; i += 1) v = recordVisit(v, ['/inbox', '/', '/money'][i % 3]!);
  const ranked = frequentPages(v, [], 3);
  assert.ok(ranked.indexOf('/inbox') < ranked.indexOf('/cards') || !ranked.includes('/cards'),
    `inbox should outrank cards now: ${ranked.join(', ')}`);
});

test('pages that have faded out entirely are forgotten, so storage stays small', () => {
  let v = visit('/tally');
  for (let i = 0; i < 150; i += 1) v = recordVisit(v, i % 2 ? '/' : '/money');
  assert.equal(v.pages['/tally'], undefined);
});

test('a malformed store reads as no history, not an error', () => {
  assert.deepEqual(parseVisits(null), EMPTY_VISITS);
  assert.deepEqual(parseVisits('not json'), EMPTY_VISITS);
  assert.deepEqual(parseVisits('{"seq":"x"}'), EMPTY_VISITS);
  const good = visit('/cards');
  assert.deepEqual(parseVisits(JSON.stringify(good)), good);
});

test('a nested page counts toward its destination', () => {
  assert.equal(navItemFor('/cards/Scapia')?.href, '/cards');
  assert.equal(navItemFor('/')?.href, '/');
  assert.equal(navItemFor('/no-such-page'), null);
});

test('opening the same page twice in a row is one visit, not two', () => {
  // A refresh, or React running an effect twice in development.
  const v = visit('/cards', '/cards', '/cards');
  assert.equal(v.seq, 1);
  assert.deepEqual(frequentPages(v, [], 4), [], 'one visit, still not frequent');
  // Leaving and coming back does count.
  assert.equal(visit('/cards', '/inbox', '/cards').pages['/cards']!.last, 3);
});
