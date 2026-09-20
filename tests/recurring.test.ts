import { describe, expect, it } from 'vitest';
import { nextInSeries } from '@/lib/recurring';

describe('nextInSeries', () => {
  it('advances an instalment counter', () => {
    expect(nextInSeries("Sheya's 23/24 Emi")).toBe("Sheya's 24/24 Emi");
    expect(nextInSeries('Ipad Mini 18/24')).toBe('Ipad Mini 19/24');
    expect(nextInSeries('Ipad Mini 18/24 Tax')).toBe('Ipad Mini 19/24 Tax');
  });

  /* The rule that keeps an instalment that does not exist off a bill. */
  it('refuses to invent a 25th of 24', () => {
    expect(nextInSeries('Ipad Mini 24/24')).toBeNull();
    expect(nextInSeries("Sheya's 24/24 Emi")).toBeNull();
  });

  it('keeps zero padding as it was written', () => {
    expect(nextInSeries('Loan 03/12')).toBe('Loan 04/12');
    expect(nextInSeries('Loan 09/12')).toBe('Loan 10/12');
  });

  it('advances a month name, matching how it was capitalised', () => {
    expect(nextInSeries('Rent August')).toBe('Rent September');
    expect(nextInSeries('RENT AUGUST')).toBe('RENT SEPTEMBER');
    expect(nextInSeries('Kseb bill sep')).toBe('Kseb bill oct');
  });

  it('rolls the year only when one was actually written', () => {
    expect(nextInSeries('Rent December 2026')).toBe('Rent January 2027');
    expect(nextInSeries('Rent December')).toBe('Rent January');
  });

  /* "EMI 3/12 for March" is one instalment of twelve that happens to name a
     month. Moving the month and leaving 3/12 would claim the same instalment
     twice. */
  it('advances the counter, not the month, when a remark has both', () => {
    expect(nextInSeries('EMI 3/12 for March')).toBe('EMI 4/12 for March');
  });

  it('says nothing about a remark with nothing to advance', () => {
    for (const r of ['Breakfast', 'Cleared', 'Fuel surcharge', 'Unknown', '']) {
      expect(nextInSeries(r)).toBeNull();
    }
  });
});
