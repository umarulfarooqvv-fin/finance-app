'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Calculator as CalcIcon, Delete, GripHorizontal, X } from 'lucide-react';
import { evaluateAmount, insertOperator, isExpression } from '@/lib/calc';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   A calculator that floats over any page.

   For the sums that are not one entry: checking a statement's total by hand,
   splitting a bill before deciding what to log, working out what is left of a
   budget. It opens from the header, or from beside an amount box — and when
   it came from an amount box, its answer can be PUT IN that box or ADDED to
   what is already there.

   "Add" writes "current + result" into the box rather than the sum itself,
   so the amount field's own working line shows what was added to what. The
   answer is on screen before anything is saved, which is the amount box's
   whole rule and stays true here.

   It closes when anything outside it is tapped and comes back exactly as it
   was left: the same sum, the same answer, where it was dragged to. The sum
   also survives a reload (localStorage, per device, a convenience only).

   The arithmetic is lib/calc's — integer paise, no eval — so this and the
   amount box can never disagree about what 450.15 + 230.10 is.

   INSIDE AN ENTRY DIALOG. Radix makes everything outside a modal inert: the
   body stops taking pointer events, a press outside closes the dialog, and
   focus is pulled back in. So the calculator sets its own pointer-events,
   the Dialog ignores presses that land on [data-calculator], and every key
   here is a button that does not take focus (mousedown is prevented) — focus
   never leaves the dialog, so the trap has nothing to fight.
   =========================================================================== */

type Target = {
  /** What is in the amount box now. */
  get: () => string;
  set: (v: string) => void;
};

type CalcState = {
  open: boolean;
  target: Target | null;
  openFor: (target: Target | null) => void;
  close: () => void;
  toggle: () => void;
};

const Ctx = createContext<CalcState | null>(null);

export function useCalculator(): CalcState | null {
  return useContext(Ctx);
}

const STORE = 'calculator.v1';
type Saved = { expr: string; x: number; y: number };

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Saved>;
  } catch {
    return {};
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private mode — the calculator still works, it just forgets */
  }
}

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const openFor = useCallback((t: Target | null) => {
    setTarget(t);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    setTarget(null);
    // Opened on its own, it takes the keyboard: a search box left focused
    // would otherwise swallow the sum being typed.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen((o) => !o);
  }, []);

  const value = useMemo(() => ({ open, target, openFor, close, toggle }), [open, target, openFor, close, toggle]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <FloatingCalculator />
    </Ctx.Provider>
  );
}

/** The header's button. */
export function CalculatorToggle() {
  const calc = useCalculator();
  if (!calc) return null;
  return (
    <button
      type="button"
      data-calculator-toggle=""
      onClick={calc.toggle}
      aria-pressed={calc.open}
      aria-label={calc.open ? 'Close the calculator' : 'Open the calculator'}
      title="Calculator"
      className={
        calc.open
          ? 'grid h-8 w-8 place-items-center rounded-full border border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'grid h-8 w-8 place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)]'
      }
    >
      <CalcIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

const KEYS: { k: string; label?: string; kind?: 'op' | 'fn' | 'eq' }[] = [
  { k: 'C', kind: 'fn' }, { k: '(', kind: 'fn' }, { k: ')', kind: 'fn' }, { k: '÷', kind: 'op' },
  { k: '7' }, { k: '8' }, { k: '9' }, { k: '×', kind: 'op' },
  { k: '4' }, { k: '5' }, { k: '6' }, { k: '-', label: '−', kind: 'op' },
  { k: '1' }, { k: '2' }, { k: '3' }, { k: '+', kind: 'op' },
  { k: '.' }, { k: '0' }, { k: 'back', kind: 'fn' }, { k: '=', kind: 'eq' },
];

const W = 264;
const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function FloatingCalculator() {
  const calc = useCalculator()!;
  const [expr, setExpr] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // Restore the last sum and place once, on the first open.
  useEffect(() => {
    if (!calc.open || loaded.current) return;
    loaded.current = true;
    const s = load();
    if (typeof s.expr === 'string') setExpr(s.expr);
    const x = typeof s.x === 'number' ? s.x : window.innerWidth - W - 16;
    const y = typeof s.y === 'number' ? s.y : 72;
    setPos(clamp(x, y));
  }, [calc.open]);

  useEffect(() => {
    if (pos) save({ expr, x: pos.x, y: pos.y });
  }, [expr, pos]);

  // A press anywhere outside closes it. The toggle handles itself.
  useEffect(() => {
    if (!calc.open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-calculator],[data-calculator-toggle],[data-calculator-open]')) return;
      calc.close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [calc]);

  const press = useCallback((k: string) => {
    setDone(null);
    setExpr((e) => {
      if (k === 'C') return '';
      if (k === 'back') return e.slice(0, -1);
      if (k === '=') {
        const r = evaluateAmount(e);
        return r.ok ? String(r.amount) : e;
      }
      if (k === '+' || k === '-' || k === '×' || k === '÷') {
        return insertOperator(e, e.length, e.length, k).value;
      }
      return e + k;
    });
  }, []);

  // Typing works too, as long as nothing else is being typed into.
  useEffect(() => {
    if (!calc.open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, string> = {
        '*': '×', x: '×', '/': '÷', Enter: '=', '=': '=',
        Backspace: 'back', Escape: 'esc', Delete: 'C', c: 'C',
      };
      const k = map[e.key] ?? (/^[0-9.+\-()]$/.test(e.key) ? e.key : null);
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === 'esc') calc.close();
      else press(k);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [calc, press]);

  // Keep it on screen when the window shrinks or the phone rotates.
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onGrab = (e: React.PointerEvent) => {
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const onDrop = () => { drag.current = null; };

  if (!calc.open || !pos) return null;

  const result = expr.trim() ? evaluateAmount(expr) : null;
  const answer = result?.ok ? result.amount : null;
  const current = calc.target ? evaluateAmount(calc.target.get()) : null;
  const currentAmount = current?.ok ? current.amount : null;

  const use = () => {
    if (answer === null || !calc.target) return;
    calc.target.set(String(answer));
    setDone(`Put ${fmt(answer)} in the amount`);
  };
  const add = () => {
    if (answer === null || !calc.target) return;
    const now = calc.target.get().trim();
    // Kept as a sum, so the amount box shows its working.
    calc.target.set(now && currentAmount !== null ? `${now}+${answer}` : String(answer));
    setDone(`Added ${fmt(answer)} to the amount`);
  };

  const ui = (
    <div
      ref={box}
      data-calculator=""
      role="dialog"
      aria-label="Calculator"
      style={{ left: pos.x, top: pos.y, width: W, pointerEvents: 'auto' }}
      className="fixed z-[70] select-none overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
    >
      <div
        onPointerDown={onGrab}
        onPointerMove={onMove}
        onPointerUp={onDrop}
        onPointerCancel={onDrop}
        className="flex cursor-grab touch-none items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-1.5 active:cursor-grabbing"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-ink-3)]">
          <GripHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Calculator
        </span>
        <button
          type="button"
          aria-label="Close the calculator"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={calc.close}
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2.5 text-right">
        <div className="num min-h-4 truncate text-xs text-[var(--color-ink-3)]" aria-live="polite">
          {isExpression(expr) ? expr : ' '}
        </div>
        <div className="num sensitive truncate text-2xl font-semibold">
          {answer !== null ? fmt(answer) : expr ? <span className="text-base text-[var(--color-warn)]">{expr.replace(/[^\d.]+$/, '') ? '…' : '0'}</span> : '0'}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
        {KEYS.map(({ k, label, kind }) => (
          <button
            key={k}
            type="button"
            aria-label={k === 'back' ? 'Delete the last character' : k === 'C' ? 'Clear' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press(k)}
            className={cx(
              'num h-10 rounded-[var(--radius-field)] text-sm font-medium transition-colors',
              kind === 'eq'
                ? 'bg-[var(--color-accent)] text-white hover:opacity-90'
                : kind === 'op'
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-90'
                  : kind === 'fn'
                    ? 'bg-[var(--color-raised)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                    : 'border border-[var(--color-line)] hover:bg-[var(--color-raised)]',
            )}
          >
            {k === 'back' ? <Delete className="mx-auto h-4 w-4" aria-hidden="true" /> : (label ?? k)}
          </button>
        ))}
      </div>

      {calc.target ? (
        <div className="border-t border-[var(--color-line)] px-3 py-2.5">
          <p className="mb-2 text-[11px] text-[var(--color-ink-3)]">
            {done ?? (
              <>
                Amount now:{' '}
                <span className="num sensitive text-[var(--color-ink-2)]">
                  {currentAmount !== null ? fmt(currentAmount) : 'empty'}
                </span>
              </>
            )}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={answer === null}
              onMouseDown={(e) => e.preventDefault()}
              onClick={use}
              className="h-9 rounded-[var(--radius-field)] border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-raised)] disabled:opacity-40"
            >
              Use as amount
            </button>
            <button
              type="button"
              disabled={answer === null}
              onMouseDown={(e) => e.preventDefault()}
              onClick={add}
              className="h-9 rounded-[var(--radius-field)] bg-[var(--color-accent)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Add to amount
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return createPortal(ui, document.body);
}

function clamp(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(8, window.innerWidth - W - 8);
  const maxY = Math.max(8, window.innerHeight - 120);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}
