import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parserConfigured, sanitise } from '@/lib/ai/parse-entry';

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

test('voice entry reports itself unavailable without a key', () => {
  const had = process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
  assert.equal(parserConfigured(), false);
  if (had) process.env['ANTHROPIC_API_KEY'] = had;
});
