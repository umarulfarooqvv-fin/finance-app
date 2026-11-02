import 'server-only';
import { readConfigKey, updateConfigKey } from '@/lib/config';
import type { Place } from '@/lib/place';
import { reverseGeocode } from '@/lib/geocode';

/* ===========================================================================
   Where each capture was taken, by capture id.

   In app_config beside `capture_drafts`, for the same reason: small, keyed by
   capture, and no migration. Unlike a draft it is KEPT when the photo
   becomes an entry — the photo is still there, linked to the entry, and so
   is where it was taken. It goes only when the photo itself does (discarded
   from the inbox, or taken off an entry).
   =========================================================================== */

const KEY = 'capture_places';

export type CapturePlaces = Record<string, Place>;

export async function readCapturePlaces(): Promise<CapturePlaces> {
  try {
    return (await readConfigKey<CapturePlaces>(KEY)) ?? {};
  } catch {
    // A corrupt key costs the map pins, never the page.
    return {};
  }
}

export async function saveCapturePlace(id: string, place: Place): Promise<void> {
  await updateConfigKey<CapturePlaces>(KEY, (current) => ({ ...current, [id]: place }));
}

/** Name a photo's place from OpenStreetMap when the phone sent none. For
    `after()`: never throws. */
export async function nameCapturePlace(id: string): Promise<void> {
  try {
    const place = (await readCapturePlaces())[id];
    if (!place || place.label) return;
    const label = await reverseGeocode(place.lat, place.lon);
    if (!label) return;
    await updateConfigKey<CapturePlaces>(KEY, (current) => {
      const p = current[id];
      // Only the coordinates that were looked up.
      if (!p || p.label || p.lat !== place.lat || p.lon !== place.lon) return current;
      return { ...current, [id]: { ...p, label } };
    });
  } catch (err) {
    console.error('[capture-place-name]', id, err instanceof Error ? err.message : err);
  }
}

export async function forgetCapturePlaces(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await updateConfigKey<CapturePlaces>(KEY, (current) => {
    if (!ids.some((id) => id in current)) return current;
    const next = { ...current };
    for (const id of ids) delete next[id];
    return next;
  });
}
