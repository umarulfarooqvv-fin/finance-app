import { MAX_AMOUNT } from '@/lib/money';

/* ===========================================================================
   Adding up in the amount box.

   A single entry is often several figures: three receipts from one shop, a
   bill split four ways, four coffees at sixty. Doing that arithmetic in
   another app and typing the answer here loses the working — and a typo in
   the total is invisible forever, because nothing records what it was meant
   to be the sum of.

   So the amount box takes "450+230+120" and shows what it makes before it is
   saved.

   IT COMPUTES IN PAISE, AS INTEGERS, for the same reason parseUserAmount
   does: 450.15 + 230.10 in floating point is 680.2499999999999, and a ledger
   that is a paisa out on some rows and not others cannot be reconciled
   against a bank that is never out at all.

   NO eval, NO Function. This is a hand-written parser over a fixed grammar.
   The input is typed by the app's owner, but an expression evaluator built on
   eval is a habit that outlives the context it was safe in.
   =========================================================================== */

export type CalcResult =
  | { ok: true; amount: number; paise: number; terms: number; expression: boolean }
  | { ok: false; reason: 'empty' | 'syntax' | 'divide-by-zero' | 'out-of-range' | 'too-precise' };

/** True when the text uses arithmetic rather than being one plain figure. */
export function isExpression(text: string): boolean {
  return /[+\-*/x×÷()]/.test(String(text ?? '').replace(/^\s*-/, '').trim());
}

type Token = { kind: 'num'; paise: number } | { kind: 'op'; op: string };

function tokenize(text: string): Token[] | null {
  const clean = String(text ?? '')
    .replace(/[₹,\s]/g, '')
    // The symbols a person actually types on a phone keypad.
    .replace(/[x×]/gi, '*')
    .replace(/÷/g, '/');

  const tokens: Token[] = [];
  let i = 0;
  while (i < clean.length) {
    const c = clean[i]!;

    if ('+-*/()'.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i += 1;
      continue;
    }

    const m = /^\d*(?:\.\d*)?/.exec(clean.slice(i));
    if (!m || m[0] === '' || m[0] === '.') return null;
    const raw = m[0];
    const [whole = '0', frac] = raw.split('.');
    if (frac !== undefined && frac.length > 2) return null;
    // Digits to paise directly — never whole * 100 on a float.
    const paise = Number(whole || '0') * 100 + Number(((frac ?? '') + '00').slice(0, 2));
    if (!Number.isFinite(paise)) return null;
    tokens.push({ kind: 'num', paise });
    i += raw.length;
  }
  return tokens;
}

/**
 * Recursive-descent over: expr := term (('+'|'-') term)*
 *                         term := unary (('*'|'/') unary)*
 *                         unary := '-'? factor
 *                         factor := number | '(' expr ')'
 *
 * Values are paise. Adding and subtracting them is exact integer work.
 * Multiplying two paise values and dividing by 100 is what makes "60*3" mean
 * sixty rupees three times rather than sixty paise times three hundred.
 */
function parse(tokens: Token[]): { paise: number; terms: number } | 'syntax' | 'divide-by-zero' {
  let pos = 0;
  let terms = 0;
  let failed: 'syntax' | 'divide-by-zero' | null = null;

  const peek = () => tokens[pos];
  const eatOp = (...ops: string[]) => {
    const t = peek();
    if (t && t.kind === 'op' && ops.includes(t.op)) { pos += 1; return t.op; }
    return null;
  };

  function factor(): number {
    if (failed) return 0;
    const t = peek();
    if (!t) { failed = 'syntax'; return 0; }
    if (t.kind === 'num') { pos += 1; terms += 1; return t.paise; }
    if (t.op === '(') {
      pos += 1;
      const v = expr();
      if (!eatOp(')')) { failed ??= 'syntax'; return 0; }
      return v;
    }
    failed = 'syntax';
    return 0;
  }

  function unary(): number {
    if (eatOp('-')) return -unary();
    if (eatOp('+')) return unary();
    return factor();
  }

  function term(): number {
    let v = unary();
    for (;;) {
      const op = eatOp('*', '/');
      if (!op || failed) return v;
      const rhs = unary();
      if (failed) return v;
      if (op === '*') {
        v = Math.round((v * rhs) / 100);
      } else {
        if (rhs === 0) { failed = 'divide-by-zero'; return 0; }
        v = Math.round((v * 100) / rhs);
      }
    }
  }

  function expr(): number {
    let v = term();
    for (;;) {
      const op = eatOp('+', '-');
      if (!op || failed) return v;
      const rhs = term();
      if (failed) return v;
      v = op === '+' ? v + rhs : v - rhs;
    }
  }

  const value = expr();
  if (failed) return failed;
  if (pos !== tokens.length) return 'syntax';
  return { paise: value, terms };
}

/**
 * Evaluate what is in the amount box.
 *
 * A plain figure comes back unchanged, so this can sit in front of every
 * amount input without changing what typing one number does.
 */
export function evaluateAmount(text: string | number | null | undefined): CalcResult {
  const raw = String(text ?? '').trim();
  if (raw === '') return { ok: false, reason: 'empty' };

  const tokens = tokenize(raw);
  if (!tokens || tokens.length === 0) {
    // Distinguish "1.234" from "1+" so the message can be useful.
    return { ok: false, reason: /\.\d{3,}/.test(raw) ? 'too-precise' : 'syntax' };
  }

  const parsed = parse(tokens);
  if (parsed === 'syntax') return { ok: false, reason: 'syntax' };
  if (parsed === 'divide-by-zero') return { ok: false, reason: 'divide-by-zero' };

  const amount = parsed.paise / 100;
  if (!Number.isFinite(amount)) return { ok: false, reason: 'syntax' };
  if (Math.abs(amount) > MAX_AMOUNT) return { ok: false, reason: 'out-of-range' };

  return {
    ok: true,
    amount,
    paise: parsed.paise,
    terms: parsed.terms,
    expression: isExpression(raw),
  };
}

/* Any operator this app writes or accepts, for the trailing-operator rule. */
const TRAILING_OP = /[+\-*/x\u00d7\u00f7]\s*$/i;

/**
 * Put an operator into an expression at the caret.
 *
 * REPLACES A TRAILING OPERATOR rather than appending to it, which is what
 * every calculator does: tapping + and then × means ×, not "+×". Without it a
 * mistyped tap becomes a syntax error the reader then has to find and delete,
 * and the running total disappears until they do.
 *
 * Returns the new text and where the caret belongs in it.
 */
export function insertOperator(
  value: string,
  start: number,
  end: number,
  op: string,
): { value: string; caret: number } {
  const lo = Math.max(0, Math.min(start, value.length));
  const hi = Math.max(lo, Math.min(end, value.length));

  let before = value.slice(0, lo);
  const after = value.slice(hi);

  if (TRAILING_OP.test(before)) before = before.replace(TRAILING_OP, '');

  return { value: before + op + after, caret: before.length + op.length };
}
