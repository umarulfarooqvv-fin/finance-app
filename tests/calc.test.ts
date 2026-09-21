import { describe, expect, it } from 'vitest';
import { evaluateAmount, insertOperator, isExpression } from '@/lib/calc';
import { parseUserAmount } from '@/lib/money';

const ok = (s: string) => {
  const r = evaluateAmount(s);
  if (!r.ok) throw new Error(`expected ${s} to evaluate, got ${r.reason}`);
  return r;
};
const bad = (s: string) => {
  const r = evaluateAmount(s);
  if (r.ok) throw new Error(`expected ${s} to fail, got ${r.amount}`);
  return r.reason;
};

describe('evaluateAmount', () => {
  it('leaves a plain figure exactly as parseUserAmount would', () => {
    for (const s of ['0.01', '1', '450', '1234.56', '1,234.56', '₹99.90']) {
      const mine = ok(s);
      const theirs = parseUserAmount(s);
      expect(theirs.ok).toBe(true);
      expect(mine.paise).toBe(theirs.ok ? theirs.paise : NaN);
      expect(mine.expression).toBe(false);
    }
  });

  it('adds the case this exists for', () => {
    expect(ok('450+230+120').amount).toBe(800);
    expect(ok('450+230+120').terms).toBe(3);
    expect(ok('450+230+120').expression).toBe(true);
  });

  /* The reason it computes in paise: this sum is 680.2499999999999 in floats,
     and a ledger a paisa out on some rows cannot be reconciled against a bank
     that is never out at all. */
  it('is exact where floating point is not', () => {
    expect(ok('450.15+230.10').amount).toBe(680.25);
    expect(ok('450.15+230.10').paise).toBe(68025);
    expect(ok('0.1+0.2').amount).toBe(0.3);
    expect(ok('1.1+2.2').amount).toBe(3.3);
  });

  it('subtracts, for a refund taken off a total', () => {
    expect(ok('1000-150').amount).toBe(850);
    expect(ok('1000-150-50').amount).toBe(800);
  });

  /* "60*3" has to mean sixty rupees three times, not sixty paise times three
     hundred — which is what multiplying two paise values naively would give. */
  it('multiplies money by a count', () => {
    expect(ok('60*3').amount).toBe(180);
    expect(ok('60x3').amount).toBe(180);
    expect(ok('60×3').amount).toBe(180);
    expect(ok('12.50*4').amount).toBe(50);
  });

  it('divides, for a bill split', () => {
    expect(ok('1200/3').amount).toBe(400);
    expect(ok('1200÷4').amount).toBe(300);
    expect(ok('100/3').amount).toBe(33.33);
  });

  it('respects precedence and brackets', () => {
    expect(ok('100+50*2').amount).toBe(200);
    expect(ok('(100+50)*2').amount).toBe(300);
    expect(ok('(1000-100)/3').amount).toBe(300);
  });

  it('handles spaces and rupee signs anywhere', () => {
    expect(ok(' ₹450 + ₹230 ').amount).toBe(680);
    expect(ok('1,200 + 800').amount).toBe(2000);
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(bad('')).toBe('empty');
    expect(bad('450+')).toBe('syntax');
    expect(bad('(450+230')).toBe('syntax');
    expect(bad('abc')).toBe('syntax');
    expect(bad('450/0')).toBe('divide-by-zero');
  });

  it('keeps the existing limits', () => {
    expect(bad('1.234')).toBe('too-precise');
    expect(bad('9999999*100')).toBe('out-of-range');
  });

  /* A stray sign is forgiven because it cannot change the answer: "450++230"
     is 450 + (+230), and a doubled key is a far likelier explanation than an
     intent nobody has. The preview under the field shows the result before it
     is saved, which is what makes forgiveness safe here. */
  it('forgives a doubled sign, which cannot change the value', () => {
    expect(ok('450++230').amount).toBe(680);
    expect(ok('450+-230').amount).toBe(220);
  });

  /* A leading minus stays readable so validation can give its own message
     about using a category to say where money went, rather than this
     rejecting it as a syntax error first. */
  it('evaluates a negative rather than choking on it', () => {
    expect(ok('-50').amount).toBe(-50);
    expect(ok('100-150').amount).toBe(-50);
  });

  it('never runs eval', () => {
    // A string that would be catastrophic if it reached eval.
    expect(bad('process.exit(1)')).toBe('syntax');
    expect(bad('1;console.log(1)')).toBe('syntax');
  });
});

describe('isExpression', () => {
  it('knows a sum from a figure', () => {
    expect(isExpression('450')).toBe(false);
    expect(isExpression('1,234.56')).toBe(false);
    expect(isExpression('-50')).toBe(false);
    expect(isExpression('450+230')).toBe(true);
    expect(isExpression('60x3')).toBe(true);
  });
});

/* The operators are buttons because a numeric keypad cannot type them, so the
   insert has to behave the way a calculator's does. */
describe('insertOperator', () => {
  const at = (v: string, i: number, op: string) => insertOperator(v, i, i, op);

  it('appends at the end', () => {
    expect(at('450', 3, '+')).toEqual({ value: '450+', caret: 4 });
  });

  it('inserts at the caret, not the end', () => {
    expect(at('450230', 3, '+')).toEqual({ value: '450+230', caret: 4 });
  });

  /* Tapping + then × means ×. Without this a mistyped tap becomes a syntax
     error the reader has to find and delete, and the total vanishes until
     they do. */
  it('replaces a trailing operator instead of stacking one on it', () => {
    expect(at('450+', 4, '×')).toEqual({ value: '450×', caret: 4 });
    expect(at('450×', 4, '÷')).toEqual({ value: '450÷', caret: 4 });
    expect(at('450-', 4, '+')).toEqual({ value: '450+', caret: 4 });
  });

  it('replaces a selection', () => {
    expect(insertOperator('450+230', 3, 7, '×')).toEqual({ value: '450×', caret: 4 });
  });

  it('survives a caret beyond the text', () => {
    expect(at('450', 99, '+')).toEqual({ value: '450+', caret: 4 });
  });

  it('produces something the evaluator can read', () => {
    const a = at('450', 3, '+');
    const b = insertOperator(`${a.value}230`, 7, 7, '×');
    expect(evaluateAmount(`${b.value}2`).ok).toBe(true);
    expect(evaluateAmount('450+230×2')).toMatchObject({ ok: true, amount: 910 });
  });
});
