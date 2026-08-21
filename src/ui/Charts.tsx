'use client';

import { useId, useState } from 'react';
import { formatDay, formatMonth, type Day } from '../domain/time.ts';
import { money, moneyCompact } from './format.ts';
import { cx } from './primitives.tsx';

/* ===========================================================================
   Charts, in plain SVG.

   No charting library: every form here is a handful of rects and a path, and a
   dependency would cost more bytes than the code it replaces while making the
   marks harder to control.

   House rules, applied throughout:
     - Thin marks, 4px rounded data-ends anchored to the baseline, 2px lines.
     - Recessive grid and axes; the data is the darkest thing on screen.
     - Selective direct labels — never a number on every mark.
     - A hover layer by default: these are interactive surfaces, not images.
     - Single-hue by default. Multiple hues are for identity, and identity
       here always carries a text label too, so colour is never the only cue.
   =========================================================================== */

const AXIS = 'var(--color-ink-3)';
const GRID = 'var(--color-line)';

/* --- Ranked bars ---------------------------------------------------------
   The right form for "which categories are biggest": magnitude compared
   against a common baseline, sorted, with the label beside each bar. A pie
   would make the same comparison harder for no gain. */

export type BarDatum = { key: string; total: number; share: number; count?: number };

export function RankedBars({
  data, limit = 8, hue = 'var(--color-accent)', onEmpty = 'Nothing to show',
}: {
  data: BarDatum[];
  limit?: number;
  hue?: string;
  onEmpty?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = data.slice(0, limit);
  const max = Math.max(...rows.map((r) => r.total), 0);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-3)]">{onEmpty}</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="group relative flex items-center gap-3"
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="w-24 shrink-0 truncate text-xs text-[var(--color-ink-2)]" title={r.key}>
            {r.key}
          </span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-raised)]">
            <span
              className="absolute inset-y-0 left-0 rounded-full transition-[width]"
              style={{ width: `${max > 0 ? Math.max(1.5, (r.total / max) * 100) : 0}%`, background: hue }}
            />
          </span>
          <span className="num w-20 shrink-0 text-right text-xs tabular-nums">{money(r.total)}</span>
          <span className="num w-10 shrink-0 text-right text-[11px] text-[var(--color-ink-3)]">
            {(r.share * 100).toFixed(0)}%
          </span>
          {hover === r.key && r.count ? (
            <span className="pointer-events-none absolute -top-6 left-24 z-10 rounded-md bg-[var(--color-ink)] px-2 py-1 text-[11px] text-[var(--color-canvas)] shadow-[var(--shadow-pop)]">
              {r.count} {r.count === 1 ? 'transaction' : 'transactions'}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* --- Daily columns -------------------------------------------------------
   Discrete days are columns, not a line: a line implies a continuous quantity
   between points, and there is no such thing as spend "at 2:30pm on Tuesday"
   interpolated from its neighbours. */

export function DailyColumns({ data, height = 120 }: { data: { day: Day; total: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-3)]">No days to show</p>;
  }

  const max = Math.max(...data.map((d) => d.total), 1);
  const w = 100 / data.length;
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <div className="flex items-end gap-px" style={{ height }} role="img" aria-label="Daily spending">
        {data.map((d, i) => {
          const h = (d.total / max) * 100;
          return (
            <div
              key={d.day}
              className="relative flex h-full flex-1 cursor-default items-end"
              style={{ minWidth: `${w}%` }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Full-height hit target: the bar itself is too thin to hover. */}
              <span className="absolute inset-0" />
              <span
                className={cx(
                  'w-full rounded-t-[4px] transition-colors',
                  hover === i ? 'bg-[var(--color-ink)]' : 'bg-[var(--color-accent)]',
                )}
                style={{ height: `${Math.max(d.total > 0 ? 2 : 0, h)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-[var(--color-ink-3)]">
        <span>{formatDay(data[0]!.day)}</span>
        <span>{formatDay(data[data.length - 1]!.day)}</span>
      </div>

      {active ? (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-md bg-[var(--color-ink)] px-2 py-1 text-[11px] whitespace-nowrap text-[var(--color-canvas)] shadow-[var(--shadow-pop)]">
          {formatDay(active.day)} · {money(active.total)}
        </div>
      ) : null}
    </div>
  );
}

/* --- Monthly trend -------------------------------------------------------
   Change over time on a continuous scale: a line, with a crosshair on hover
   and only the extremes labelled directly. */

export function TrendLine({
  data, height = 160,
}: {
  data: { month: string; total: number }[];
  height?: number;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-3)]">Not enough history yet</p>;
  }

  const W = 600;
  const H = height;
  const pad = { top: 12, right: 12, bottom: 22, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const max = Math.max(...data.map((d) => d.total), 1);
  const x = (i: number) => pad.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(' ');
  const area = `${path} L${x(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  // Four gridlines is enough to read a value off; more becomes a ledger.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: y(max * f) }));
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Monthly spending trend"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={clipId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={pad.left} x2={W - pad.right} y1={t.y} y2={t.y} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={t.y + 3} textAnchor="end" fontSize={9} fill={AXIS}>
              {moneyCompact(t.v)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${clipId})`} />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {active && hover !== null ? (
          <>
            <line
              x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH}
              stroke="var(--color-ink-3)" strokeWidth={1} strokeDasharray="3 3"
            />
            {/* A surface-coloured ring keeps the marker readable over the line. */}
            <circle cx={x(hover)} cy={y(active.total)} r={5} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
          </>
        ) : null}

        {/* Invisible columns give each point a hit target far wider than the mark. */}
        {data.map((d, i) => (
          <rect
            key={d.month}
            x={x(i) - innerW / (data.length - 1) / 2}
            y={pad.top}
            width={innerW / (data.length - 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        <text x={pad.left} y={H - 6} fontSize={9} fill={AXIS}>
          {formatMonth(data[0]!.month)}
        </text>
        <text x={W - pad.right} y={H - 6} textAnchor="end" fontSize={9} fill={AXIS}>
          {formatMonth(data[data.length - 1]!.month)}
        </text>
      </svg>

      {active ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-md bg-[var(--color-ink)] px-2 py-1 text-[11px] whitespace-nowrap text-[var(--color-canvas)] shadow-[var(--shadow-pop)]">
          {formatMonth(active.month)} · {money(active.total)}
        </div>
      ) : null}
    </div>
  );
}
