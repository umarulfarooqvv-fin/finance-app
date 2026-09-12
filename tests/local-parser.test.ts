import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseLocally, wordsToNumber } from '@/lib/ai/local-parser';

/* ===========================================================================
   The offline entry parser.

   Every case below is a phrase somebody would actually say to a phone while
   standing in a shop. The parser needs no key, no network and no quota, so
   these are the entries that will work even with no signal — which is exactly
   when entries get made.
   =========================================================================== */

/* --- Amounts -------------------------------------------------------------- */

test('ordinary spoken numbers', () => {
  assert.equal(wordsToNumber(['five', 'hundred']), 500);
  assert.equal(wordsToNumber(['two', 'thousand']), 2000);
  assert.equal(wordsToNumber(['twelve', 'hundred']), 1200);
  assert.equal(wordsToNumber(['two', 'thousand', 'five', 'hundred']), 2500);
  assert.equal(wordsToNumber(['one', 'lakh']), 100000);
  assert.equal(wordsToNumber(['two', 'and', 'half', 'thousand']), 2500);
});

test('Indian shorthand: "four eighty" is 480, not 84', () => {
  // This is how amounts are actually read aloud, and adding the two groups
  // would be wrong every single time.
  assert.equal(wordsToNumber(['four', 'eighty']), 480);
  assert.equal(wordsToNumber(['twelve', 'fifty']), 1250);
  assert.equal(wordsToNumber(['three', 'twenty']), 320);
  assert.equal(wordsToNumber(['nine', 'ninety']), 990);
});

test('a run that is not a number is rejected rather than guessed', () => {
  assert.equal(wordsToNumber(['lunch']), null);
  assert.equal(wordsToNumber([]), null);
  assert.equal(wordsToNumber(['for', 'lunch']), null);
});

test('digits, symbols and the k suffix', () => {
  assert.equal(parseLocally('480 for lunch').amount, '480');
  assert.equal(parseLocally('₹1,234.50 groceries').amount, '1234.5');
  assert.equal(parseLocally('rs 250 tea').amount, '250');
  assert.equal(parseLocally('2k for petrol').amount, '2000');
  assert.equal(parseLocally('1.5k fuel').amount, '1500');
});

/* --- Whole phrases -------------------------------------------------------- */

test('the common shape: amount, category, card', () => {
  const r = parseLocally('four eighty for lunch on Coral');
  assert.equal(r.amount, '480');
  assert.equal(r.method, 'Coral');
  assert.equal(r.category, 'Food');
  assert.deepEqual(r.missing, []);
});

test('a two-word method is matched whole', () => {
  // "one" must not be read as the number 1 and "card" must not be lost.
  const r = parseLocally('spent 350 on One Card for dinner');
  assert.equal(r.method, 'One Card');
  assert.equal(r.amount, '350');
  assert.equal(r.category, 'Food');
});

test('spoken method variants resolve to the real name', () => {
  assert.equal(parseLocally('200 petrol onecard').method, 'One Card');
  assert.equal(parseLocally('200 petrol icici bank').method, 'ICICI');
  assert.equal(parseLocally('200 petrol super money').method, 'Super Money');
  assert.equal(parseLocally('500 food from state bank').method, 'SBI');
});

test('categories are inferred from ordinary words', () => {
  assert.equal(parseLocally('90 tea from Fi').category, 'Food');
  assert.equal(parseLocally('600 petrol Scapia').category, 'Fuel');
  assert.equal(parseLocally('450 medicine for umma').category, 'Medicine');
  assert.equal(parseLocally('1200 vegetables').category, 'Groceries');
  assert.equal(parseLocally('300 movie tickets').category, 'Entertainment');
});

test('a bill payment names the card as the CATEGORY, not the method', () => {
  // "paid ICICI" means the ICICI bill was settled. Treating ICICI as the
  // method would add debt to the card instead of clearing it — the sign of
  // the whole entry would be inverted.
  const r = parseLocally('paid 5000 to ICICI');
  assert.equal(r.category, 'ICICI');
  assert.equal(r.method, null, 'where the money came from was not stated');
  assert.ok(r.missing.includes('method'));

  const cleared = parseLocally('cleared Coral 12000');
  assert.equal(cleared.category, 'Coral');
  assert.equal(cleared.amount, '12000');
});

test('spending ON a card is not confused with paying it', () => {
  const r = parseLocally('spent 200 on Coral for tea');
  assert.equal(r.method, 'Coral', 'the money came from the Coral card');
  assert.equal(r.category, 'Food');
});

test('remarks keep the words that describe the purchase', () => {
  const r = parseLocally('480 for lunch at Panjabi Dhaba on Coral');
  assert.equal(r.amount, '480');
  assert.equal(r.method, 'Coral');
  assert.equal(r.category, 'Food');
  assert.match(r.remarks, /Panjabi Dhaba/);
  // Filler and recognised parts are stripped.
  assert.ok(!/\b(for|on|Coral)\b/i.test(r.remarks), `remarks still contain filler: "${r.remarks}"`);
});

test('lending is recognised and the person stays in the remarks', () => {
  const r = parseLocally('lent 1000 to Arshadali from Fi');
  assert.equal(r.amount, '1000');
  assert.equal(r.category, 'Credit Given');
  assert.equal(r.method, 'Fi');
  assert.match(r.remarks, /Arshadali/);
});

/* --- What it refuses to do ------------------------------------------------ */

test('anything not stated is reported missing, never invented', () => {
  const r = parseLocally('480');
  assert.equal(r.amount, '480');
  assert.equal(r.method, null);
  assert.equal(r.category, null);
  assert.deepEqual(r.missing.sort(), ['category', 'method']);
});

test('an unknown payment method is not matched to a real one', () => {
  // "HDFC" is a real bank but not one of this user's methods. Guessing the
  // nearest would attribute the money to a card that was never used.
  const r = parseLocally('500 lunch from HDFC');
  assert.equal(r.method, null);
  assert.ok(r.missing.includes('method'));
});

test('a card paying its own bill drops the method as incoherent', () => {
  const r = parseLocally('paid Coral from Coral 500');
  assert.notEqual(r.category, null);
  assert.equal(r.method, null);
});

test('gibberish yields nothing rather than a wrong entry', () => {
  const r = parseLocally('asdf qwerty zxcv');
  assert.equal(r.amount, null);
  assert.equal(r.method, null);
  assert.equal(r.category, null);
  assert.equal(r.missing.length, 3);
});

test('an empty transcript is handled without throwing', () => {
  const r = parseLocally('');
  assert.equal(r.amount, null);
  assert.equal(r.remarks, '');
});

/* --- Determinism ---------------------------------------------------------- */

test('the same phrase always parses the same way', () => {
  const phrase = 'four eighty for lunch on Coral';
  const first = parseLocally(phrase);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(parseLocally(phrase), first);
  }
});
