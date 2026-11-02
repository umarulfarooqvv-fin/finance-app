import { isSpend } from '@/lib/analytics';
import { round2 } from '@/lib/money';
import type { Place } from '@/lib/place';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   Entries on a map: one pin per PLACE, not per entry.

   Ten coffees at the same café are one pin that says ten, not ten pins
   stacked on one spot where only the top one can be tapped. Entries share a
   pin when they carry the same name, or — nameless — fall within about 100m
   of each other (three decimal places of a degree).

   The pin's figure is SPEND by the app's own definition: a card bill paid at
   a bank branch is on the map but adds nothing, as everywhere else.

   Pure: transactions and places in, pins out.
   =========================================================================== */

export type PinEntry = {
  id: string;
  ts: string;
  amount: number;
  remarks: string;
  category: string;
  method: string;
};

export type Pin = {
  key: string;
  lat: number;
  lon: number;
  label: string | null;
  spent: number;
  count: number;
  /** Newest first. */
  entries: PinEntry[];
};

const near = (n: number) => n.toFixed(3);

export function mapPins(
  transactions: Transaction[],
  places: Record<string, Place>,
  month: string | null,
): Pin[] {
  const pins = new Map<string, Pin & { latSum: number; lonSum: number }>();
  for (const t of transactions) {
    const p = places[t.id];
    if (!p || t.deleted || !t.ts || t.amount == null) continue;
    if (month && t.ts.slice(0, 7) !== month) continue;

    const key = p.label ? `n:${p.label.toLowerCase()}` : `c:${near(p.lat)},${near(p.lon)}`;
    let pin = pins.get(key);
    if (!pin) {
      pin = { key, lat: 0, lon: 0, label: p.label ?? null, spent: 0, count: 0, entries: [], latSum: 0, lonSum: 0 };
      pins.set(key, pin);
    }
    pin.latSum += p.lat;
    pin.lonSum += p.lon;
    pin.count += 1;
    if (isSpend(t)) pin.spent += t.amount;
    pin.entries.push({
      id: t.id, ts: t.ts, amount: t.amount, remarks: t.remarks, category: t.category, method: t.method,
    });
  }

  return [...pins.values()]
    .map(({ latSum, lonSum, ...pin }) => ({
      ...pin,
      lat: latSum / pin.count,
      lon: lonSum / pin.count,
      spent: round2(pin.spent),
      entries: pin.entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    }))
    .sort((a, b) => b.spent - a.spent || b.count - a.count);
}

/** Months that have at least one placed entry, newest first. */
export function placedMonths(transactions: Transaction[], places: Record<string, Place>): string[] {
  const out = new Set<string>();
  for (const t of transactions) if (places[t.id] && t.ts && !t.deleted) out.add(t.ts.slice(0, 7));
  return [...out].sort().reverse();
}
