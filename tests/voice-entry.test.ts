import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseSpokenEntry, parserConfigured, sanitise } from '@/lib/ai/parse-entry';

/* ===========================================================================
   The safety layer between speech and a transaction.

   The model's output is treated as a SUGGESTION FROM AN UNRELIABLE SOURCE,
   because that is what it is: a language model reading a transcript produced
   by a speech recogniser that mishears numbers routinely. Nothing it returns
   reaches the database without passing through here and then through a human.

   The specific failure this guards against: a misheard payment method moves
   debt onto the wrong card, and that is the error hardest to notice weeks
   later when the statement does not match.
   =========================================================================== */

const base = {
  amount: '480', method: 'Coral', category: 'Food',
  remarks: 'lunch', uncertain: [], interpretation: 'Lunch, 480 on Coral',
};

test('a clean parse passes through intact', () => {
  const d = sanitise(base);
  assert.equal(d.amount, '480');
  assert.equal(d.method, 'Coral');
  assert.equal(d.category, 'Food');
  assert.equal(d.remarks, 'lunch');
  assert.deepEqual(d.uncertain, []);
});

test('a method the app does not know is DROPPED, not passed through', () => {
  // "HDFC" is a real bank but not one of this user's methods. Accepting it
  // would create a row whose money came from nowhere.
  const d = sanitise({ ...base, method: 'HDFC' });
  assert.equal(d.method, null, 'an unknown method must not survive');
  assert.ok(d.uncertain.includes('method'), 'and the user must be told');
});

test('a category the app does not know is dropped', () => {
  const d = sanitise({ ...base, category: 'Groceries and stuff' });
  assert.equal(d.category, null);
  assert.ok(d.uncertain.includes('category'));
});

test('a missing field is reported rather than invented', () => {
  const d = sanitise({ ...base, method: null, category: null });
  assert.equal(d.method, null);
  assert.equal(d.category, null);
  assert.ok(d.uncertain.includes('method'));
  assert.ok(d.uncertain.includes('category'));
});

test('the amount is re-parsed through the app own parser', () => {
  // Whatever shape the model returns, the form's rules decide.
  assert.equal(sanitise({ ...base, amount: '1,234.50' }).amount, '1234.5');
  assert.equal(sanitise({ ...base, amount: 480 }).amount, '480');

  // Finer than a paisa is rejected at the form, so it is rejected here too
  // rather than being accepted now and refused at submit.
  const tooPrecise = sanitise({ ...base, amount: '10.999' });
  assert.equal(tooPrecise.amount, null);
  assert.ok(tooPrecise.uncertain.includes('amount'));

  // Direction is never carried by a sign.
  const negative = sanitise({ ...base, amount: '-500' });
  assert.equal(negative.amount, null);
  assert.ok(negative.uncertain.includes('amount'));
});

test('a card paying its own bill is flagged as a mishearing', () => {
  // "paid Coral from Coral" is not a transaction; the method was misheard.
  const d = sanitise({ ...base, method: 'Coral', category: 'Coral' });
  assert.ok(d.uncertain.includes('method'));
});

test('a legitimate card-to-card payment is NOT flagged', () => {
  const d = sanitise({ ...base, method: 'Fi', category: 'ICICI', remarks: 'bill' });
  assert.equal(d.method, 'Fi');
  assert.equal(d.category, 'ICICI');
  assert.ok(!d.uncertain.includes('method'));
});

test('the model own uncertainty is preserved and merged', () => {
  const d = sanitise({ ...base, uncertain: ['remarks'] });
  assert.ok(d.uncertain.includes('remarks'), 'the model said so');
});

test('remarks are bounded and trimmed', () => {
  assert.equal(sanitise({ ...base, remarks: '  lunch  ' }).remarks, 'lunch');
  assert.equal(sanitise({ ...base, remarks: 'x'.repeat(500) }).remarks.length, 200);
  assert.equal(sanitise({ ...base, remarks: null }).remarks, '');
});

test('junk from the model cannot crash the parser', () => {
  // Defensive: the tool schema is strict, but a malformed reply must degrade
  // to "nothing understood", never to an exception in a money form.
  const d = sanitise({});
  assert.equal(d.amount, null);
  assert.equal(d.method, null);
  assert.equal(d.category, null);
  assert.equal(d.remarks, '');
  assert.equal(d.uncertain.length, 3, 'all three fields reported as unknown');
});

test('voice entry works with NO key and no provider configured', async () => {
  // The whole point of the offline parser: a phrase that names everything
  // needs no model, no key and no network, so the feature is never gated
  // behind a signup.
  const hadAnthropic = process.env['ANTHROPIC_API_KEY'];
  const hadProvider = process.env['ENTRY_AI'];
  delete process.env['ANTHROPIC_API_KEY'];
  process.env['ENTRY_AI'] = 'off';

  assert.equal(parserConfigured(), true, 'voice entry is always available');

  const result = await parseSpokenEntry('four eighty for lunch on Coral');
  assert.ok(result.ok);
  assert.equal(result.draft.amount, '480');
  assert.equal(result.draft.method, 'Coral');
  assert.equal(result.draft.category, 'Food');
  assert.deepEqual(result.draft.uncertain, [], 'nothing needed a second look');
  assert.match(result.draft.source, /offline/);

  if (hadAnthropic) process.env['ANTHROPIC_API_KEY'] = hadAnthropic;
  if (hadProvider) process.env['ENTRY_AI'] = hadProvider; else delete process.env['ENTRY_AI'];
});

test('a phrase the offline parser cannot finish is reported, not invented', async () => {
  process.env['ENTRY_AI'] = 'off';
  const result = await parseSpokenEntry('four eighty');
  assert.ok(result.ok);
  assert.equal(result.draft.amount, '480');
  assert.equal(result.draft.method, null);
  assert.equal(result.draft.category, null);
  assert.ok(result.draft.uncertain.includes('method'));
  assert.ok(result.draft.uncertain.includes('category'));
});
