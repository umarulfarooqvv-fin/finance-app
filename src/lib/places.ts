import 'server-only';
import { logEvent, select, update } from '@/lib/supabase';
import { invalidateSnapshot } from '@/lib/snapshot';
import { reverseGeocode } from '@/lib/geocode';
import { readCapturePlaces } from '@/lib/capture-places';
import type { Place } from '@/lib/place';

/* ===========================================================================
   Where each entry was spent: `place_lat`, `place_lon`, `place_name` on
   transactions (db/migrations/003_places.sql).

   KEPT OUT OF THE SNAPSHOT on purpose. The engine never needs a place, and
   the snapshot's column list is what every page loads; adding these to it
   would take the whole app down on a database that has not run 003 yet.
   Here, a missing column means no pins — never a broken page — and a write
   says plainly which migration to run.

   Written apart from the entry, after it saves, exactly like a photo: a
   place that fails to save must never cost the entry itself.
   =========================================================================== */

export type PlaceMap = Record<string, Place>;

const MISSING = 'Locations need db/migrations/003_places.sql run in Supabase first.';
const isMissingColumn = (err: unknown) => err instanceof Error && /place_(lat|lon|name)/.test(err.message);

/* Cached against the snapshot's version: the Postgres trigger bumps it on
   every transactions write, a place included, so an unchanged version means
   an unchanged set of places. */
let cached: { version: number; places: PlaceMap } | null = null;

/** Every entry that has a place. Empty, never thrown, before 003 is run. */
export async function loadPlaces(version: number): Promise<PlaceMap> {
  if (cached?.version === version) return cached.places;
  try {
    const rows = await select('transactions', {
      select: 'id,place_lat,place_lon,place_name',
      filters: { place_lat: 'not.is.null' },
    });
    const places: PlaceMap = {};
    for (const r of rows) {
      if (r.place_lat == null || r.place_lon == null) continue;
      places[r.id] = r.place_name
        ? { lat: r.place_lat, lon: r.place_lon, label: r.place_name }
        : { lat: r.place_lat, lon: r.place_lon };
    }
    cached = { version, places };
    return places;
  } catch {
    return {};
  }
}

/** Set or clear one entry's place. Does not touch its money or its tick. */
export async function setTransactionPlace(
  id: string,
  place: Place | null,
  actor: string,
): Promise<void> {
  try {
    await update('transactions', { id: `eq.${id}` }, {
      place_lat: place?.lat ?? null,
      place_lon: place?.lon ?? null,
      place_name: place?.label ?? null,
      updated_by: actor,
    });
  } catch (err) {
    if (isMissingColumn(err)) throw new Error(MISSING);
    throw err;
  }
  cached = null;
  invalidateSnapshot();
  await logEvent('transaction.place', { id, place, by: actor });
}

/**
 * Give a nameless place a name, from OpenStreetMap. For `after()`: it never
 * throws, and it names only the coordinates it looked up — if the place was
 * changed meanwhile, the stale name is not written over the new one.
 */
export async function nameTransactionPlace(id: string): Promise<void> {
  try {
    const [row] = await select('transactions', {
      select: 'id,place_lat,place_lon,place_name',
      filters: { id: `eq.${id}` },
      limit: 1,
    });
    if (!row || row.place_lat == null || row.place_lon == null || row.place_name) return;
    const name = await reverseGeocode(row.place_lat, row.place_lon);
    if (!name) return;
    await update('transactions', {
      id: `eq.${id}`,
      place_lat: `eq.${row.place_lat}`,
      place_lon: `eq.${row.place_lon}`,
      place_name: 'is.null',
    }, { place_name: name });
    cached = null;
    invalidateSnapshot();
  } catch (err) {
    console.error('[place-name]', id, err instanceof Error ? err.message : err);
  }
}

/**
 * Entries made from a photo take the photo's place, when they have none of
 * their own. Never throws: the entries are already saved.
 */
export async function placeFromPhoto(captureId: string, transactionIds: string[], actor: string): Promise<void> {
  try {
    const place = (await readCapturePlaces())[captureId];
    if (!place || transactionIds.length === 0) return;
    const rows = await select('transactions', {
      select: 'id,place_lat',
      filters: { id: `in.(${transactionIds.map((t) => `"${t}"`).join(',')})` },
    });
    for (const r of rows) {
      if (r.place_lat != null) continue;
      await setTransactionPlace(r.id, place, actor);
      if (!place.label) await nameTransactionPlace(r.id);
    }
  } catch (err) {
    console.error('[place-photo]', captureId, err instanceof Error ? err.message : err);
  }
}
