import 'server-only';
import { nameFromLookup } from '@/lib/place';

/* ===========================================================================
   Coordinates to a name a person recognises, from OpenStreetMap's Nominatim.

   Only for an entry that arrived WITHOUT a name — the iPhone resolves one for
   free and that one always wins. Called after the reply (`after()`), so a slow
   or absent lookup only ever means a pin with numbers instead of a name.

   Nominatim's terms: an identifying User-Agent, at most one request a second.
   One person's entries never come close. Nothing but the two numbers is sent.
   =========================================================================== */

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `${ENDPOINT}?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'PersonalFinanceManager/3.0 (single-user app)' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return nameFromLookup(await res.json());
  } catch {
    return null;
  }
}
