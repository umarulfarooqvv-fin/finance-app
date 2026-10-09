import { describe, expect, it } from 'vitest';
import { isFederalStatement, parseFederalStatement, readBankRow, regularNeftSenders } from '@/lib/bank-statement';
import { parseImport } from '@/lib/import-parse';

/* A Federal Bank statement in the layout unpdf reads from the real PDF —
   page header, records running over several lines, a one-line cash record,
   a two-letter type ("FT"), an id with two letters ("FB144001") and a record
   split by a page break. The figures are invented; the shapes are not. */
const STATEMENT = `The Federal Bank Ltd. Corporate Office: Federal Towers, Market Rd, Periyar Nagar, Aluva, Kerala, 683101,
Ph:0484 2630996 Website:www.federalbank.co.in Page 1 of 2
Account Number : 55550111999999
Statement of Account for the period 2025-10-10 to 2026-10-09
Date Value Date Particulars Tran
Type Tran ID Cheque
Details Withdrawals Deposits Balance DR
/CR
Opening Balance 1000.00 Cr
10-OCT-2025 10-OCT-2025 IFN/ / TI SOMEONE
555507190000
TFR S8658898 100.00 900.00 Cr
11-OCT-2025 11-OCT-2025 UPIOUT/528401752209
/ahiqpktr@okaxis/UPI/0000
TFR S22442735 250.00 650.00 Cr
11-OCT-2025 11-OCT-2025 UPI IN/112474896972
/jihadmezza1@okhdfcbank/U/0000
TFR S22849319 2500.00 3150.00 Cr
07-NOV-2025 07-NOV-2025 NFT/BARCLAYS BANK P /001ONCV253110116/BARCLAYS
FT S88101611 45000.00 48150.00 Cr
05-DEC-2025 05-DEC-2025 NFT/BARCLAYS BANK P /001ONCV253390013/BARCLAYS
FT S88101612 45000.00 93150.00 Cr
The Federal Bank Ltd. Corporate Office: Federal Towers, Market Rd, Periyar Nagar, Aluva, Kerala, 683101,
Ph:0484 2630996 Website:www.federalbank.co.in Page 2 of 2
Date Value Date Particulars Tran
09-JAN-2026 09-JAN-2026 NFT/BARCLAYS BANK P /001ONCV260090536/BARCLAYS
FT S88101613 45000.00 138150.00 Cr
18-DEC-2025 18-DEC-2025 Dr. Tran for funding A/c
55550401761281/SOMEONE
TFR FB144001 67000.00 71150.00 Cr
23-SEP-2026 23-SEP-2026 CASH: ABDUL GAFOOR CASH FB87773 80000.00 151150.00 Cr
02-OCT-2026 02-OCT-2026 UPIOUT/664128755375/scapia.
bdpg@kotakpay/Pay/5413
TFR C76094193 18415.53 132734.47 Cr
03-OCT-2026 03-OCT-2026 UPIOUT/627630995317
/7736234377@jupiteraxis/A/0000
TFR S28335292 2000.00 130734.47 Cr
GRAND TOTAL 87765.53 217500.00`;

describe('Federal Bank statements', () => {
  const st = parseFederalStatement(STATEMENT);

  it('recognises the format', () => {
    expect(isFederalStatement(STATEMENT)).toBe(true);
    expect(isFederalStatement('14/09/2026 | 450 | Fi | Food | Tea')).toBe(false);
  });

  it('reads every record, whatever its layout, against the running balance', () => {
    expect(st.account).toBe('9999');
    expect(st.opening).toBe(1000);
    expect(st.rows).toHaveLength(10);
    expect(st.unreconciled).toBe(0);
    const out = st.rows.filter((r) => r.direction === 'out').reduce((a, r) => a + r.amount, 0);
    const inn = st.rows.filter((r) => r.direction === 'in').reduce((a, r) => a + r.amount, 0);
    // The statement's own GRAND TOTAL line.
    expect(Math.round(out * 100) / 100).toBe(87765.53);
    expect(inn).toBe(217500);
  });

  it('gets the direction from the balance, not from the text', () => {
    expect(st.rows[1]).toMatchObject({ day: '2025-10-11', amount: 250, direction: 'out', ref: 'S22442735' });
    expect(st.rows[2]).toMatchObject({ amount: 2500, direction: 'in' });
    expect(st.rows.find((r) => r.ref === 'FB87773')).toMatchObject({ amount: 80000, direction: 'in' });
  });

  it('says what each row probably is', () => {
    const sal = regularNeftSenders(st.rows);
    expect([...sal]).toEqual(['BARCLAYS BANK P']);
    const read = (ref: string) => readBankRow(st.rows.find((r) => r.ref === ref)!, { salaryFrom: sal });
    expect(read('S8658898').skip).toMatch(/own deposit/);
    expect(read('FB144001').skip).toMatch(/fixed deposit/);
    expect(read('S28335292').skip).toMatch(/Jupiter/);
    expect(read('S88101611')).toMatchObject({ category: 'Salary', skip: null });
    expect(read('C76094193')).toMatchObject({ category: 'Scapia', skip: null });
    expect(read('S22442735')).toMatchObject({ label: 'ahiqpktr@okaxis', category: '', skip: null });
  });

  it('becomes import rows on the right account, own transfers marked to leave out', () => {
    const { rows } = parseImport(STATEMENT, { bankMethods: { 'Federal 9999': 'Fi' } });
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.method === 'Fi')).toBe(true);
    expect(rows.filter((r) => r.skip)).toHaveLength(3);
    expect(rows.find((r) => r.amount === 45000)).toMatchObject({ direction: 'in', category: 'Salary' });
    expect(new Set(rows.map((r) => r.ref)).size).toBe(10);
  });
});
