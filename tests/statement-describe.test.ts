import { describe, expect, it } from 'vitest';
import { describeStatementLine } from '@/lib/statement-describe';

const debit = (description: string) => ({ description, direction: 'debit' as const });
const credit = (description: string) => ({ description, direction: 'credit' as const });

describe('describeStatementLine', () => {
  it('writes a bill payment the way this ledger writes it', () => {
    const d = describeStatementLine(credit('BBPS Payment received'), 'Coral');
    expect(d.remarks).toBe('Cleared');
    expect(d.category).toBe('Coral');
    expect(d.source).toBe('payment');
  });

  it('does not read a DEBIT that mentions payment as a bill being cleared', () => {
    // "PAYMENT GATEWAY FEE" is money going out, not a bill being settled.
    const d = describeStatementLine(debit('PAYMENT GATEWAY SERVICES'), 'Coral');
    expect(d.category).not.toBe('Coral');
    expect(d.remarks).not.toBe('Cleared');
  });

  it('reads a tax line as Taxes without carrying the rate code across', () => {
    const d = describeStatementLine(debit('IGST-CI@18%'), 'Coral');
    expect(d).toMatchObject({ remarks: 'Tax', category: 'Taxes', source: 'charge' });
  });

  it('keeps the fuel surcharge under the name this ledger already uses', () => {
    const d = describeStatementLine(debit('FUEL SURCHARGE'), 'Super Money');
    expect(d.remarks).toBe('Fuel surcharge');
    expect(d.category).toBe('Surcharge');
  });

  it('reads a fee as Surcharge', () => {
    const d = describeStatementLine(debit('ANNUAL MEMBERSHIP FEE'), 'Edge');
    expect(d).toMatchObject({ remarks: 'Fee', category: 'Surcharge' });
  });

  it('title-cases a name instead of shouting it', () => {
    const d = describeStatementLine(debit('ABDUL MUJEEB MOOZHIKKAL'), 'Coral');
    expect(d.remarks).toBe('Abdul Mujeeb Moozhikkal');
    expect(d.source).toBe('merchant');
  });

  it('suggests a category only when the line says what the thing IS', () => {
    expect(describeStatementLine(debit('SWIGGY BANGALORE'), 'Edge').category).toBe('Food');
    expect(describeStatementLine(debit('NAYARA KONDOTTY'), 'Scapia').category).toBe('Fuel');
    expect(describeStatementLine(debit('MEDPLUS PHARMACY'), 'Fi').category).toBe('Medicine');
  });

  /* The rule that keeps the analytics honest. A brand is not a category, and
     filing one silently would bend the very numbers the entry exists to feed. */
  it('refuses to guess a category from a brand alone', () => {
    const d = describeStatementLine(debit('AMAZON RETAIL IN'), 'Coral');
    expect(d.remarks).toBe('Amazon Retail');
    expect(d.category).toBeNull();
  });

  it('strips card, reference and terminal numbers out of the name', () => {
    const d = describeStatementLine(debit('POS 4076XXXXXXXX1234 SUPERMARKET MALAPPURAM'), 'Edge');
    expect(d.remarks).toBe('Supermarket Malappuram');
    expect(d.remarks).not.toMatch(/\d/);
    expect(d.category).toBe('Groceries');
  });

  it('marks a line it cannot read as Unknown rather than as its own debris', () => {
    const d = describeStatementLine(debit('POS 483920184756 TID 88211'), 'Coral');
    expect(d).toMatchObject({ remarks: 'Unknown', category: null, source: 'unknown' });
  });

  it('leaves an acronym in capitals and mixed case alone', () => {
    expect(describeStatementLine(debit('KSEB ONLINE'), 'Fi').remarks).toBe('KSEB Online');
    expect(describeStatementLine(debit('BookMyShow'), 'Fi').remarks).toBe('BookMyShow');
  });

  /* Whatever it decides, it must be something the form will actually accept:
     a remark that is blank, or all spaces, would save an entry with no name. */
  it('always returns remarks a person can read', () => {
    for (const raw of ['', '   ', '|||', '00000000', '---', '@#$%']) {
      const d = describeStatementLine(debit(raw), 'Coral');
      expect(d.remarks.trim().length).toBeGreaterThan(0);
    }
  });
});
