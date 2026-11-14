import { isSpend } from '@/lib/analytics';
import { round2 } from '@/lib/money';
import type { Place } from '@/lib/place';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   Where the money goes, by AREA — the analysis under the map.

   A pin is one shop; an area is the locality it sits in, which is what a
   person means by "where do I spend": Downhill, Pathaikkara, Pallimukh. The
   area is the last part of a place's name ("Ration Shop, Downhill" →
   "Downhill"), the way OpenStreetMap and the Shortcut both write it; a
   nameless place falls into a cell of about a kilometre.

   HONEST ABOUT COVERAGE. Only entries that carry a location are on the map,
   and that is a fraction of the spending. `coverage` says how much of the
   period's spend the figures below can see, so "most of it is in Downhill"
   is never read as more than it is.

   Spend by the app's own definition (lib/analytics isSpend). Pure.
   =========================================================================== */

export type AreaRow = {
  area: string;
  spent: number;
  count: number;
  /** Of the located spend. */
  share: number;
  /** The categories most spent on there, biggest first (at most two). */
  categories: { category: string; spent: number }[];
  places: number;
};

export type PlacedBuy = { id: string; ts: string; amount: number; remarks: string; category: string; where: string };

export type PlaceAnalytics = {
  coverage: {
    /** All spend in the period, and the part with a location. */
    spent: number;
    placedSpent: number;
    count: number;
    placedCount: number;
    /** The first located entry — before it, nothing could be on the map. */
    since: string | null;
  };
  areas: AreaRow[];
  /** The biggest single located spends, biggest first. */
  biggest: PlacedBuy[];
};

/** The locality a place belongs to. */
export function areaOf(p: Place): string {
  const label = (p.label ?? '').trim();
  if (!label) return `Near ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
  // "Shop, Road · Area, District, PIN" — the part before any "·" detail, its last comma piece.
  const head = label.split('·')[0]!.trim();
  const parts = head.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? head;
}

const shopOf = (p: Place) => (p.label ?? '').split('·')[0]!.split(',')[0]!.trim() || areaOf(p);

export function placeAnalytics(
  transactions: Transaction[],
  places: Record<string, Place>,
  month: string | null,
  biggestN = 5,
): PlaceAnalytics {
  const firstPlaced = transactions
    .filter((t) => !t.deleted && t.ts && places[t.id])
    .reduce<string | null>((a, t) => (a === null || t.ts! < a ? t.ts! : a), null);
  /* All time is measured from the first located entry: years from before
     locations were recorded would only say "not located", never "elsewhere". */
  const inPeriod = (t: Transaction) => (month ? t.ts!.slice(0, 7) === month : !firstPlaced || t.ts!.slice(0, 10) >= firstPlaced.slice(0, 10));
  const spends = transactions.filter((t) => isSpend(t) && inPeriod(t));

  const placed = spends.filter((t) => places[t.id]);
  const placedSpent = placed.reduce((a, t) => a + t.amount!, 0);

  const byArea = new Map<string, { spent: number; count: number; cats: Map<string, number>; shops: Set<string> }>();
  for (const t of placed) {
    const p = places[t.id]!;
    const key = areaOf(p);
    const row = byArea.get(key) ?? { spent: 0, count: 0, cats: new Map(), shops: new Set() };
    row.spent += t.amount!;
    row.count += 1;
    const cat = t.category.trim() || 'No category yet';
    row.cats.set(cat, (row.cats.get(cat) ?? 0) + t.amount!);
    row.shops.add(shopOf(p).toLowerCase());
    byArea.set(key, row);
  }

  const areas: AreaRow[] = [...byArea.entries()]
    .map(([area, r]) => ({
      area,
      spent: round2(r.spent),
      count: r.count,
      share: placedSpent > 0 ? r.spent / placedSpent : 0,
      categories: [...r.cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([category, spent]) => ({ category, spent: round2(spent) })),
      places: r.shops.size,
    }))
    .sort((a, b) => b.spent - a.spent || b.count - a.count);

  const biggest = [...placed]
    .sort((a, b) => b.amount! - a.amount! || (a.ts! < b.ts! ? 1 : -1))
    .slice(0, biggestN)
    .map((t) => ({ id: t.id, ts: t.ts!, amount: t.amount!, remarks: t.remarks, category: t.category, where: shopOf(places[t.id]!) }));

  return {
    coverage: {
      spent: round2(spends.reduce((a, t) => a + t.amount!, 0)),
      placedSpent: round2(placedSpent),
      count: spends.length,
      placedCount: placed.length,
      since: firstPlaced,
    },
    areas,
    biggest,
  };
}
