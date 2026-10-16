'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { PRESETS } from '@/lib/day-spend';
import { cx } from '@/components/ui/primitives';

/* The span Today's "Spent" panel describes: a preset, or one chosen day.
   Lives in the URL (?p=yesterday, ?p=day&d=2026-10-02) like every filter in
   the app, so the back button steps out of it. */

export function SpanSelect({ value, day, today }: { value: string; day?: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(value === 'day');

  const go = (q: string) => start(() => router.push(q ? `/?${q}` : '/', { scroll: false }));

  return (
    <span className="inline-flex items-center gap-1.5">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-ink-3)]" aria-hidden="true" /> : null}
      {picking ? (
        <input
          type="date"
          max={today}
          defaultValue={day}
          aria-label="Pick a day"
          onChange={(e) => { if (e.target.value) go(`p=day&d=${e.target.value}`); }}
          className="h-8 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 text-xs"
        />
      ) : null}
      <select
        aria-label="Which days"
        value={value === 'day' || picking ? 'day' : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'day') { setPicking(true); return; }
          setPicking(false);
          go(v === 'today' ? '' : `p=${v}`);
        }}
        className={cx('h-8 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 text-xs font-medium')}
      >
        {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        <option value="day">Pick a day…</option>
      </select>
    </span>
  );
}
