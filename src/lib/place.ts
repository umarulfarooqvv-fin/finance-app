/* ===========================================================================
   Where money was spent, as the phone reported it.

   An entry or a photo can carry the phone's location, so "Food" a month later
   still says WHICH food — "Lulu Mall, Edappally". It is whatever the phone
   said, never inferred, and it never changes an amount, a card or a total:
   it is shown beside the entry, linked to a map, and pinned on /map.

   Forgiving about the shape, like the rest of the Shortcut endpoints, because
   the Shortcut's location actions hand over different things:

     - `lat` and `lon` as two fields ("Get Details of Locations" → Latitude,
       Longitude). `latitude`, `lng`, `long` and `longitude` work too.
     - one `location` field holding both: "12.9716, 77.5946", or an Apple
       Maps link with `ll=12.9716,77.5946` in it.
     - an optional `place`: the street or name the phone resolved, shown in
       place of the bare numbers. Without one, the server looks a name up
       (lib/geocode) after the save.

   Pure: field getters and JSON in, places and labels out.
   =========================================================================== */

export type Place = { lat: number; lon: number; label?: string };

const LAT = ['lat', 'latitude'];
const LON = ['lon', 'lng', 'long', 'longitude'];
const BOTH = ['location', 'coords', 'll'];
const LABEL = ['place', 'address'];

function first(get: (key: string) => unknown, keys: string[]): string {
  for (const k of keys) {
    const v = get(k);
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * A number in range, to six places (about 10cm) — or null.
 *
 * Tolerant of how a phone writes one: "9.9312° N", "−76.26" (a typographic
 * minus), "9,9312" (a comma decimal, from a region that writes them so), a
 * stray space. A hemisphere letter sets the sign: S and W are negative.
 */
function coord(raw: string, limit: number): number | null {
  let s = raw.replace(/[\s\u00a0°]/g, '').replace(/[\u2212\u2013]/g, '-');
  let sign = 1;
  const hemi = s.match(/[NSEW]$/i);
  if (hemi) {
    if (/[SW]/i.test(hemi[0])) sign = -1;
    s = s.slice(0, -1);
  }
  if (/^-?\d{1,3},\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(s)) return null;
  const n = sign * Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 1e6) / 1e6;
}

/** What arrived for a place, raw, for a reply that has to say why none was
    read. Truncated: it is shown back to the phone, not stored. */
export function placeInputs(get: (key: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, keys] of [['lat', LAT], ['lon', LON], ['location', BOTH], ['place', LABEL]] as const) {
    const v = first(get, [...keys]);
    if (v) out[name] = v.slice(0, 80);
  }
  return out;
}

/* What iOS sends as a location's Name when it has none: the word itself.
   Kept, it would label every pin "Location"; dropped, the place is named
   from OpenStreetMap instead. */
const PLACEHOLDERS = new Set(['location', 'current location', 'my location', 'unknown']);
const meaningful = (label: string) => (PLACEHOLDERS.has(label.toLowerCase()) ? '' : label);

export function parsePlace(get: (key: string) => unknown): Place | null {
  let lat = coord(first(get, LAT), 90);
  let lon = coord(first(get, LON), 180);

  if (lat == null || lon == null) {
    // Both in one string. Decimals required, so a postcode in an address
    // ("Kochi 682001") is never mistaken for a coordinate.
    const both = first(get, BOTH).match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
    lat = both ? coord(both[1]!, 90) : null;
    lon = both ? coord(both[2]!, 180) : null;
  }
  if (lat == null || lon == null) return null;
  // 0,0 is in the sea off Africa: a location service that had nothing.
  if (lat === 0 && lon === 0) return null;

  const label = meaningful(first(get, LABEL).replace(/\s+/g, ' ').slice(0, 200));
  return label ? { lat, lon, label } : { lat, lon };
}

/** "12.9716, 77.5946" — four places is about 10m, plenty to read. */
export function formatPlace(p: Place): string {
  return p.label || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
}

/** Opens Apple Maps on the phone, and the web map anywhere else. */
export function mapsUrl(p: Place): string {
  const q = encodeURIComponent(p.label || 'Photo taken here');
  return `https://maps.apple.com/?ll=${p.lat},${p.lon}&q=${q}`;
}

/** A label from an OpenStreetMap reverse lookup: "Lulu Mall, Edappally".
    The named thing first (a shop, a hospital), then the area it is in — the
    two things that make a place recognisable. Null when there is nothing. */
export function nameFromLookup(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { name?: unknown; display_name?: unknown; address?: Record<string, unknown> };
  const a = j.address ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = k === 'name' ? j.name : a[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const what = pick('name', 'amenity', 'shop', 'tourism', 'building', 'road');
  const area = pick('suburb', 'neighbourhood', 'quarter', 'city_district', 'village', 'town', 'city');
  const parts = [...new Set([what, area].filter(Boolean))];
  if (parts.length > 0) return parts.join(', ').slice(0, 200);
  if (typeof j.display_name === 'string' && j.display_name.trim()) {
    return j.display_name.split(',').slice(0, 2).map((x) => x.trim()).join(', ').slice(0, 200);
  }
  return null;
}
