import { describe, expect, it } from 'vitest';
import { bankMethodsFrom, resolveMethod } from '@/lib/bank-methods';

/** The real mapping, which is also the case that made this necessary. */
const MAPPING = {
  'Federal 2788': 'Fi',
  'Utkarsh XX24': 'Super Money',
  'CSB XX06': 'Edge',
  'ICICI XX00': 'Coral',
  'Federal 3838': 'Jupiter',
  'Federal XX16': 'Scapia',
};

describe('bankMethodsFrom', () => {
  it('reads the mapping out of config', () => {
    expect(bankMethodsFrom({ bank_methods: MAPPING })).toEqual(MAPPING);
  });

  it('is empty rather than undefined when nothing is configured', () => {
    expect(bankMethodsFrom({})).toEqual({});
    expect(bankMethodsFrom({ bank_methods: null })).toEqual({});
    expect(bankMethodsFrom({ bank_methods: 'nonsense' })).toEqual({});
  });

  /* A mapping pointing at a method the app no longer has is worse than none:
     it would fill the field with something the form then refuses. */
  it('drops a mapping to a method that no longer exists', () => {
    const out = bankMethodsFrom({ bank_methods: { 'Federal 2788': 'Fi', 'Old Bank 11': 'Paytm' } });
    expect(out).toEqual({ 'Federal 2788': 'Fi' });
  });
});

describe('resolveMethod', () => {
  it('maps each real bank label to its account', () => {
    expect(resolveMethod('Federal 2788', MAPPING)).toBe('Fi');
    expect(resolveMethod('Utkarsh XX24', MAPPING)).toBe('Super Money');
    expect(resolveMethod('CSB XX06', MAPPING)).toBe('Edge');
    expect(resolveMethod('ICICI XX00', MAPPING)).toBe('Coral');
    expect(resolveMethod('Federal 3838', MAPPING)).toBe('Jupiter');
    expect(resolveMethod('Federal XX16', MAPPING)).toBe('Scapia');
  });

  /* THE RULE THAT MATTERS MOST. Three Federal accounts point at three
     different methods, so a label that only says "Federal" is unanswerable —
     and picking one would be a coin toss with money on it. */
  it('refuses a bank label that is ambiguous across accounts', () => {
    expect(resolveMethod('Federal', MAPPING)).toBeNull();
    expect(resolveMethod('Federal 9999', MAPPING)).toBeNull();
  });

  it('drops the account number when only one account is at that bank', () => {
    expect(resolveMethod('Utkarsh', MAPPING)).toBe('Super Money');
    expect(resolveMethod('CSB XX99', MAPPING)).toBe('Edge');
  });

  it('still takes a method written the app’s own way', () => {
    expect(resolveMethod('Fi', MAPPING)).toBe('Fi');
    expect(resolveMethod('super money', MAPPING)).toBe('Super Money');
    expect(resolveMethod('SCAPIA', MAPPING)).toBe('Scapia');
  });

  it('is unaffected by casing or extra spaces', () => {
    expect(resolveMethod('  federal   2788 ', MAPPING)).toBe('Fi');
    expect(resolveMethod('utkarsh xx24', MAPPING)).toBe('Super Money');
  });

  /* "I do not know" has to be a possible answer: a wrong method moves money
     onto the wrong card and nothing afterwards looks wrong. */
  it('returns null rather than guessing', () => {
    expect(resolveMethod('HDFC 1234', MAPPING)).toBeNull();
    expect(resolveMethod('', MAPPING)).toBeNull();
    expect(resolveMethod('Federal 2788', {})).toBeNull();
  });

  it('never invents a method that is not in the app', () => {
    const bad = { 'Weird Bank 1': 'NotAMethod' };
    expect(resolveMethod('Weird Bank 1', bankMethodsFrom({ bank_methods: bad }))).toBeNull();
  });
});

/* The same account masked differently on different screens. A UPI history
   printed "Federal XXXXXXXXXX2788" where the mapping says "Federal 2788", and
   with three Federal accounts mapped, dropping the number could not choose. */
describe('resolveMethod — masked account numbers', () => {
  it('matches on the digits each side shows', () => {
    expect(resolveMethod('Federal XXXXXXXXXX2788', MAPPING)).toBe('Fi');
    expect(resolveMethod('Federal XXXXXXXXXX3838', MAPPING)).toBe('Jupiter');
    expect(resolveMethod('Federal XXXX16', MAPPING)).toBe('Scapia');
    expect(resolveMethod('Federal XX88', MAPPING)).toBe('Fi');
  });

  it('still refuses to guess between accounts at one bank', () => {
    expect(resolveMethod('Federal XXXX9999', MAPPING)).toBeNull();
    expect(resolveMethod('Federal', MAPPING)).toBeNull();
  });

  it('takes an unmapped bank that is itself one of the app\'s accounts', () => {
    expect(resolveMethod('Canara XX5598', MAPPING)).toBe('Canara');
  });

  it('lets a mapped bank keep its own answer over a same-named account', () => {
    // ICICI is an app account too, but "ICICI XX00" is mapped to Coral.
    expect(resolveMethod('ICICI XX00', MAPPING)).toBe('Coral');
  });
});

