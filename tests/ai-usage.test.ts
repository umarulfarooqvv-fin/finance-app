import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeUsage, isLimited, parseDuration, usageFromReply } from '@/lib/ai/usage';
import { addSeconds } from '@/lib/time';

/* ===========================================================================
   Reading the AI provider's allowance off its replies.

   Running out used to look like the feature breaking — photos arriving and
   never being read. These pin down that the app can say how much is left and,
   when nothing is, until when.
   =========================================================================== */

const NOW = '2026-09-25T14:40:00';
const PROVIDER = 'api.groq.com (qwen/qwen3.8-27b)';
const headers = (h: Record<string, string>) => new Headers(h);

test('addSeconds crosses midnight and month ends on the wall clock', () => {
  assert.equal(addSeconds('2026-09-25T14:40:00', 90), '2026-09-25T14:41:30');
  assert.equal(addSeconds('2026-09-30T23:59:30', 45), '2026-10-01T00:00:15');
  assert.equal(addSeconds('2026-12-31T23:00:00', 3_600), '2027-01-01T00:00:00');
  assert.equal(addSeconds('2026-03-01T00:00:10', -20), '2026-02-28T23:59:50');
});

test('durations in every form a provider writes them', () => {
  assert.equal(parseDuration('8m38.4s'), 518_400);
  assert.equal(parseDuration('105ms'), 105);
  assert.equal(parseDuration('7.66s'), 7_660);
  assert.equal(parseDuration('2h13m5s'), 7_985_000);
  assert.equal(parseDuration('30'), 30_000, 'retry-after is bare seconds');
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('soon'), null);
});

test('a normal reply records what is left and when it refills', () => {
  const u = usageFromReply(PROVIDER, NOW, 200, headers({
    'x-ratelimit-limit-requests': '1000',
    'x-ratelimit-remaining-requests': '994',
    'x-ratelimit-reset-requests': '8m38.4s',
    'x-ratelimit-limit-tokens': '8000',
    'x-ratelimit-remaining-tokens': '7986',
    'x-ratelimit-reset-tokens': '105ms',
  }));
  assert.deepEqual(u.requests, { limit: 1000, remaining: 994, resetsAt: '2026-09-25T14:48:39' });
  assert.equal(u.tokens?.remaining, 7986);
  assert.equal(isLimited(u, NOW), false);
});

test('a provider that reports nothing records nothing to show', () => {
  const u = usageFromReply(PROVIDER, NOW, 200, headers({}));
  assert.equal(u.requests, undefined);
  assert.equal(describeUsage(u, NOW), null, 'no line rather than a made-up one');
});

test('a daily limit says which limit and until when, from the provider’s own words', () => {
  const body = JSON.stringify({ error: { message:
    'Rate limit reached for model `m` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 2h13m5s.' } });
  const u = usageFromReply(PROVIDER, NOW, 429, headers({
    'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '0', 'retry-after': '8000',
  }), body);
  assert.equal(u.limitKind, 'requests per day');
  assert.equal(u.limitedUntil, '2026-09-25T16:53:05', 'the message’s wait, not the rounded header');
  assert.equal(isLimited(u, NOW), true);
  assert.equal(isLimited(u, '2026-09-25T16:53:06'), false, 'and it lifts on its own');

  const line = describeUsage(u, NOW)!;
  assert.equal(line.tone, 'limited');
  assert.match(line.text, /requests per day/);
  assert.match(line.text, /4:53 PM/);
  assert.match(line.text, /kept/, 'and says the photos are not lost');
});

test('a limit with no stated wait assumes a minute, not a day', () => {
  const u = usageFromReply(PROVIDER, NOW, 429, headers({}), '{"error":"slow down"}');
  assert.equal(u.limitedUntil, '2026-09-25T14:41:00');
  assert.equal(u.limitKind, 'rate limit');
});

test('the line reads plainly, warns when low, and refills after its reset', () => {
  const at = (remaining: number, resetsAt: string | null = '2026-09-25T20:00:00') =>
    describeUsage({ provider: PROVIDER, at: NOW, requests: { limit: 1000, remaining, resetsAt } }, NOW);

  assert.deepEqual(at(994), { tone: 'ok', text: '994 of 1,000 AI reads left today' });
  assert.equal(at(80)!.tone, 'low', 'under a tenth left');
  assert.equal(at(3, '2026-09-25T14:00:00')!.text, '1,000 of 1,000 AI reads left today',
    'past its reset the allowance is full again, whatever was last seen');
});
