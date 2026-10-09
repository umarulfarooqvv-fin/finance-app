import { describe, expect, it } from 'vitest';
import { isGpayStatement, parseGpayStatement, respace } from '@/lib/gpay-statement';
import { parseImport, readyToImport } from '@/lib/import-parse';
import { guessDebtor } from '@/lib/repayment-guess';

/* The shape of a real Google Pay statement (Jul–Sep 2026), page header and
   all, as unpdf reads it — and as a PDF viewer's copy gives it, spaces gone. */
const WITH_SPACES = `Transaction statement
Page 1 of 9
Sent
₹1,75,059.92
Received
₹83,350
Date & time Transaction details Amount
01 Jul, 2026
10:44 AM
Paid to MUHAMMED RAHEES T P
UPI Transaction ID: 654819171027
Paid by Federal Bank 2788
₹3,000
11 Jul, 2026
03:13 PM
Paid to BOOKMYSHOW
UPI Transaction ID: 619234167921
Paid by Federal Bank XX16 | RuPay credit card
₹351.92
Transaction statement
Page 2 of 9
Date & time Transaction details Amount
25 Jul, 2026
11:46 PM
Received from Arshad ali
UPI Transaction ID: 657299643801
Paid to Federal Bank 2788
₹230`;

const SQUASHED = `Date&time Transactiondetails Amount
01Jul,2026
10:44AM
PaidtoMuhammedFaisal
UPITransactionID:618357060762
PaidbyFederalBank2788
₹3,000
25Jul,2026
11:46PM
ReceivedfromArshadali
UPITransactionID:657299643801
PaidtoFederalBank2788
₹1,230.50`;

const MAP = { 'Federal 2788': 'Fi', 'Federal 3838': 'Jupiter', 'Federal XX16': 'Scapia' };

describe('Google Pay statements', () => {
  it('recognises one, and not an ordinary paste', () => {
    expect(isGpayStatement(WITH_SPACES)).toBe(true);
    expect(isGpayStatement('14/09/2026 | 450 | Fi | Food | Tea')).toBe(false);
  });

  it('reads each payment with its direction, time, account and UPI id', () => {
    const m = parseGpayStatement(WITH_SPACES);
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({
      day: '2026-07-01', time: '10:44:00', amount: 3000, direction: 'out', party: 'MUHAMMED RAHEES T P',
      account: 'Federal Bank 2788', accountKind: '', ref: '654819171027',
    });
    expect(m[1]).toMatchObject({ time: '15:13:00', account: 'Federal Bank XX16', accountKind: 'RuPay credit card' });
    expect(m[2]).toMatchObject({ day: '2026-07-25', time: '23:46:00', direction: 'in', party: 'Arshad ali', amount: 230 });
  });

  it('reads the copy a PDF viewer gives, with every space missing', () => {
    const m = parseGpayStatement(SQUASHED);
    expect(m.map((x) => [x.direction, x.party, x.account, x.amount])).toEqual([
      ['out', 'Muhammed Faisal', 'Federal Bank 2788', 3000],
      ['in', 'Arshadali', 'Federal Bank 2788', 1230.5],
    ]);
    expect(respace('RuPay credit card')).toBe('RuPay credit card');
  });

  it('becomes import rows: spends on the right card, money received as income', () => {
    const { rows, skipped } = parseImport(WITH_SPACES, { bankMethods: MAP });
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.direction, r.method, r.remarks, r.ref])).toEqual([
      ['out', 'Fi', 'MUHAMMED RAHEES T P', '654819171027'],
      ['out', 'Scapia', 'BOOKMYSHOW', '619234167921'],
      ['in', 'Fi', 'Arshad ali', '657299643801'],
    ]);
    // Income cannot be saved until it has a source.
    expect(readyToImport(rows)).toBe(false);
    expect(readyToImport(rows.map((r) => (r.direction === 'in' ? { ...r, category: 'Credit Return' } : r)))).toBe(true);
  });
});

describe('who a payment came back from', () => {
  const debtors = [
    { person: 'Arshadali', outstanding: 50324 },
    { person: 'Shawarma with coffee irshad arshad ali', outstanding: 350 },
    { person: 'Ashiq', outstanding: 113951 },
    { person: 'Muhammed Favas', outstanding: 6070 },
    { person: 'Sheya', outstanding: 113121 },
  ];

  it('matches a name written differently', () => {
    expect(guessDebtor('Arshad ali', debtors)).toBe('Arshadali');
    expect(guessDebtor('ARSHADALI', debtors)).toBe('Arshadali');
    expect(guessDebtor('Ashiq Muhammedashiq', debtors)).toBe('Ashiq');
  });

  it('never matches on a common first name alone', () => {
    expect(guessDebtor('Muhammed Faisal', debtors)).toBeNull();
    expect(guessDebtor('Muhammed', debtors)).toBeNull();
  });

  it('gives no answer when two people fit', () => {
    expect(guessDebtor('Sheya', [...debtors, { person: 'Sheya Salva', outstanding: 1 }])).toBe('Sheya');
    expect(guessDebtor('Salva', [{ person: 'Salva K', outstanding: 1 }, { person: 'Salva P', outstanding: 1 }])).toBeNull();
  });
});
