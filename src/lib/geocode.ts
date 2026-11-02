import 'server-only';
import { addressFromLookup, nameFromLookup } from '@/lib/place';

/* ===========================================================================
   Coordinates to a name a person recognises, from OpenStreetMap's Nominatim.

   Only for an entry that arrived WITHOUT a name — the iPhone resolves one for
   free and that one always wins. Called after the reply (`after()`), so a slow
   or absent lookup only ever means a pin with numbers instead of a name.

   Nominatim's terms: an identifying User-Agent, at most one request a second.
   One person's entries never come close. Nothing but the two numbers is sent.
   =========================================================================== */

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export type Lookup = { name: string | null; address: string[] };

/* One person's lookups never come near Nominatim's one-a-second rule on
   their own, but a list of drafts asks for several at once. So requests go
   out one after another, a second apart, and an answer is remembered for the
   life of the server instance — a spot does not move. */
const remembered = new Map<string, Promise<Lookup | null>>();
let queue: Promise<unknown> = Promise.resolve();

export function lookupPlace(lat: number, lon: number): Promise<Lookup | null> {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const hit = remembered.get(key);
  if (hit) return hit;
  const run = queue.then(() => fetchLookup(lat, lon));
  queue = run.then(() => new Promise((r) => setTimeout(r, 1100)));
  // A failure is not remembered: the next view asks again.
  remembered.set(key, run.then((v) => { if (!v) remembered.delete(key); return v; }));
  return remembered.get(key)!;
}

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  return (await lookupPlace(lat, lon))?.name ?? null;
}

async function fetchLookup(lat: number, lon: number): Promise<Lookup | null> {
  const url = `${ENDPOINT}?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'PersonalFinanceManager/3.0 (single-user app)' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return { name: nameFromLookup(json), address: addressFromLookup(json) };
  } catch {
    return null;
  }
}
