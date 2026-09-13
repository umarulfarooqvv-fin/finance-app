import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateAccountSettings, validateCardSettings } from '@/lib/validation';
import { DEFAULT_ACCOUNTS, DEFAULT_CARDS } from '@/lib/defaults';
import { accountBalances } from '@/lib/balances';
import { makeSnapshot, tx } from './helpers';

/* ===========================================================================
   Settings.

   These guard the numbers every OTHER number is computed from. A bad
   transaction is one bad row; a bad bill date silently re-cuts every statement
   that card has ever had.
   =========================================================================== */

const TODAY = '2026-09-13';

const card = (over: Record<string, unknown> = {}) => ({
  name: 'Coral', billDate: '12', dueDay: '2', dueCycle: 'next', graceDays: '15',
  creditLimit: '50000', openingBalance: '0', openingDate: '2025-12-10',
  statementBoundary: 'inclusive', active: true, ...over,
}) as Parameters<typeof validateCardSettings>[0];

const account = (over: Record<string, unknown> = {}) => ({
  name: 'Fi', kind: 'bank', openingBalance: '10000', since: '2026-09-01', active: true, ...over,
}) as Parameters<typeof validateAccountSettings>[0];

/* --- Cards ---------------------------------------------------------------- */

test('a valid card passes', () => {
  assert.equal(validateCardSettings(card(), TODAY), null);
});

test('a bill date past the 28th is refused, not clamped', () => {
  // The 31st does not exist in February. Silently treating it as the 28th
  // would move a month of charges onto a different statement without saying so.
  for (const d of ['29', '30', '31', '0', '-1', '1.5', 'x']) {
    assert.ok(validateCardSettings(card({ billDate: d }), TODAY)?.['billDate'], `${d} should be refused`);
  }
  assert.equal(validateCardSettings(card({ billDate: '28' }), TODAY), null);
});

test('a blank due day is allowed, because grace days cover it', () => {
  assert.equal(validateCardSettings(card({ dueDay: '' }), TODAY), null);
  assert.equal(validateCardSettings(card({ dueDay: null }), TODAY), null);
  assert.ok(validateCardSettings(card({ dueDay: '31' }), TODAY)?.['dueDay']);
});

test('tracking cannot start in the future', () => {
  // Every row would fall before the opening date and be skipped, and the card
  // would read as having no history at all.
  assert.ok(validateCardSettings(card({ openingDate: '2027-01-01' }), TODAY)?.['openingDate']);
  assert.equal(validateCardSettings(card({ openingDate: TODAY }), TODAY), null);
  // Blank means "use all history", which is a real choice.
  assert.equal(validateCardSettings(card({ openingDate: '' }), TODAY), null);
});

test('a date that is only the right shape is still refused', () => {
  assert.ok(validateCardSettings(card({ openingDate: '2026-02-30' }), TODAY)?.['openingDate']);
  assert.ok(validateCardSettings(card({ openingDate: '2026-13-01' }), TODAY)?.['openingDate']);
});

test('an opening balance may be negative, a credit limit may not', () => {
  // An overpaid card is real; the engine depends on that being expressible.
  assert.equal(validateCardSettings(card({ openingBalance: '-1500.50' }), TODAY), null);
  assert.ok(validateCardSettings(card({ creditLimit: '-1' }), TODAY)?.['creditLimit']);
});

test('money is taken to the paisa and no further', () => {
  assert.equal(validateCardSettings(card({ openingBalance: '6851.68' }), TODAY), null);
  assert.ok(validateCardSettings(card({ openingBalance: '10.001' }), TODAY)?.['openingBalance']);
  // Typed the way a person types money.
  assert.equal(validateCardSettings(card({ creditLimit: '1,15,000' }), TODAY), null);
  assert.ok(validateCardSettings(card({ creditLimit: '50000000' }), TODAY)?.['creditLimit']);
});

test('the cut-off and the due cycle only accept their two values', () => {
  assert.ok(validateCardSettings(card({ statementBoundary: 'maybe' }), TODAY)?.['statementBoundary']);
  assert.ok(validateCardSettings(card({ dueCycle: 'later' }), TODAY)?.['dueCycle']);
  assert.equal(validateCardSettings(card({ statementBoundary: 'exclusive' }), TODAY), null);
});

test('every shipped default would survive its own validator', () => {
  // If a default cannot be saved, the form refuses to save a card that was
  // never edited — which is how a settings screen becomes unusable.
  for (const c of DEFAULT_CARDS) {
    const errors = validateCardSettings({
      name: c.name, billDate: c.billDate, dueDay: c.dueDay, dueCycle: c.dueCycle,
      graceDays: c.graceDays, creditLimit: c.creditLimit, openingBalance: c.openingBalance,
      openingDate: c.openingDate ?? '', statementBoundary: c.statementBoundary, active: c.active,
    }, TODAY);
    assert.equal(errors, null, `${c.name}: ${JSON.stringify(errors)}`);
  }
});

/* --- Accounts ------------------------------------------------------------- */

test('an account balance may be negative, because overdrafts exist', () => {
  assert.equal(validateAccountSettings(account({ openingBalance: '-2500' }), TODAY), null);
});

test('an account kind is one of two things', () => {
  assert.ok(validateAccountSettings(account({ kind: 'crypto' }), TODAY)?.['kind']);
  assert.equal(validateAccountSettings(account({ kind: 'cash' }), TODAY), null);
});

test('every shipped default account would survive its own validator', () => {
  for (const a of DEFAULT_ACCOUNTS) {
    assert.equal(
      validateAccountSettings(
        { name: a.name, kind: a.kind, openingBalance: a.openingBalance, since: a.since ?? '', active: a.active },
        TODAY,
      ),
      null,
      a.name,
    );
  }
});

/* --- What saving one actually does ---------------------------------------- */

test('an opening date stops history being counted twice', () => {
  // The whole point of the setting: 5,000 spent before the opening date is
  // already reflected in the opening balance and must not be subtracted again.
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-06-01T10:00:00', amount: 5000, method: 'Fi', category: 'Food' }),
      tx({ ts: '2026-09-05T10:00:00', amount: 1200, method: 'Fi', category: 'Food' }),
    ],
    accounts: [{ name: 'Fi', kind: 'bank', openingBalance: 20000, since: '2026-09-01', active: true }],
  });

  const fi = accountBalances(snap, TODAY).find((a) => a.name === 'Fi');
  assert.equal(fi?.paidOut, 1200, 'only outflows since the opening date count');
  assert.equal(fi?.balance, 18800);
});

test('with no opening date every outflow ever is subtracted', () => {
  // This is the unconfigured state, and it is why Money reads hugely negative
  // until an opening balance and date are set.
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-06-01T10:00:00', amount: 5000, method: 'Fi', category: 'Food' }),
      tx({ ts: '2026-09-05T10:00:00', amount: 1200, method: 'Fi', category: 'Food' }),
    ],
    accounts: [{ name: 'Fi', kind: 'bank', openingBalance: 0, since: null, active: true }],
  });

  const fi = accountBalances(snap, TODAY).find((a) => a.name === 'Fi');
  assert.equal(fi?.balance, -6200);
});
