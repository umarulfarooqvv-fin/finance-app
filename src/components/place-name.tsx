'use client';

import { useEffect, useState } from 'react';
import { formatPlace, type Place } from '@/lib/place';

/* ===========================================================================
   A place's NAME, on screen before anything is saved.

   A place with a label is shown as it is. One without — coordinates from the
   browser, or a photo whose name has not been looked up yet — asks
   /api/place-name once and shows "Finding the place…" meanwhile, so the
   person confirming an entry reads "Lulu Mall, Edappally", not two numbers.

   Answers are kept for the page's life, by coordinates to ~10m, so a list of
   drafts from one shop asks once.
   =========================================================================== */

const known = new Map<string, Promise<string | null>>();
const keyOf = (p: Place) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

function lookup(p: Place): Promise<string | null> {
  const key = keyOf(p);
  let hit = known.get(key);
  if (!hit) {
    hit = fetch(`/api/place-name?lat=${p.lat}&lon=${p.lon}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; name?: string | null }) => (j.ok ? (j.name ?? null) : null))
      .catch(() => null);
    known.set(key, hit);
  }
  return hit;
}

/** The place's name: its own label, else one looked up. */
export function usePlaceName(place: Place | null | undefined): { name: string | null; looking: boolean } {
  const [found, setFound] = useState<{ key: string; name: string | null } | null>(null);
  const key = place && !place.label ? keyOf(place) : null;

  useEffect(() => {
    if (!place || place.label || !key) return;
    let live = true;
    void lookup(place).then((name) => { if (live) setFound({ key, name }); });
    return () => { live = false; };
    // Keyed on the place to ~10m: a new object for the same spot is not a new place.
  }, [key]);

  if (!place) return { name: null, looking: false };
  if (place.label) return { name: place.label, looking: false };
  if (found?.key === key) return { name: found.name, looking: false };
  return { name: null, looking: true };
}

/** The line itself: the name, "Finding the place…", or the coordinates. */
export function PlaceText({ place }: { place: Place }) {
  const { name, looking } = usePlaceName(place);
  return <>{name ?? (looking ? 'Finding the place…' : formatPlace(place))}</>;
}
