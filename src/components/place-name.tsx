'use client';

import { useEffect, useState } from 'react';
import { formatPlace, type Place } from '@/lib/place';

/* ===========================================================================
   A place's NAME and ADDRESS, on screen before anything is saved.

   Asks /api/place-name once per spot (to ~10m) for the page's life, and shows
   "Finding the place…" meanwhile — so the person confirming an entry reads
   "Kozhikode Ferokh Palakkad Road, Ernad, Malappuram 676517", not two
   numbers. A place that already has a label shows it at once; the address
   arrives a moment later.
   =========================================================================== */

type Found = { name: string | null; address: string[] };

const known = new Map<string, Promise<Found | null>>();
const keyOf = (p: Place) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

function lookup(p: Place): Promise<Found | null> {
  const key = keyOf(p);
  let hit = known.get(key);
  if (!hit) {
    hit = fetch(`/api/place-name?lat=${p.lat}&lon=${p.lon}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; name?: string | null; address?: string[] }) =>
        j.ok ? { name: j.name ?? null, address: j.address ?? [] } : null)
      .catch(() => null);
    known.set(key, hit);
  }
  return hit;
}

/** The place's name (its own label first) and its address lines. A
    labelled place is looked up only when its address is wanted. */
export function usePlaceName(place: Place | null | undefined, wantAddress = true): {
  name: string | null;
  address: string[];
  looking: boolean;
} {
  const [found, setFound] = useState<{ key: string; value: Found | null } | null>(null);
  const key = place && (wantAddress || !place.label) ? keyOf(place) : null;

  useEffect(() => {
    if (!place || !key) return;
    let live = true;
    void lookup(place).then((value) => { if (live) setFound({ key, value }); });
    return () => { live = false; };
    // Keyed on the place to ~10m: a new object for the same spot is not a new place.
  }, [key]);

  if (!place) return { name: null, address: [], looking: false };
  const value = found?.key === key ? found.value : undefined;
  return {
    name: place.label || value?.name || null,
    address: value?.address ?? [],
    looking: key !== null && value === undefined,
  };
}

/** One line: the name, then — with `area` — where it is: "Downhill, Ernad,
    Malappuram, 673642". Without, a labelled place costs no lookup at all,
    which is what a long list wants. */
export function PlaceText({ place, area: withArea = false }: { place: Place; area?: boolean }) {
  const { name, address, looking } = usePlaceName(place, withArea);
  if (!name) return <>{looking ? 'Finding the place…' : formatPlace(place)}</>;
  const area = address.filter((l) => l !== name).slice(1, 4).join(', ');
  return <>{area ? `${name} · ${area}` : name}</>;
}

/** Every line, as Maps shows an address. */
export function PlaceAddress({ place }: { place: Place }) {
  const { address, looking } = usePlaceName(place);
  if (address.length === 0) {
    return looking ? <span className="text-[11px] text-[var(--color-ink-3)]">Finding the address…</span> : null;
  }
  return (
    <span className="flex flex-col text-[11px] leading-4 text-[var(--color-ink-3)]">
      {address.map((l) => <span key={l} className="sensitive">{l}</span>)}
    </span>
  );
}
