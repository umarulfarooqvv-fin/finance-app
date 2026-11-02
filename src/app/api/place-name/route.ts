import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { reverseGeocode } from '@/lib/geocode';
import { parsePlace } from '@/lib/place';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   A name for a pair of coordinates, while the form is still open.

   So the place can be read and confirmed BEFORE an entry is saved — "spent
   at Lulu Mall, Edappally" is a check a person can make; "11.1000, 76.0636"
   is not. The same OpenStreetMap lookup the server does after a save, asked
   for earlier; only the two numbers leave.

   Session-guarded like /api/remarks: where somebody has been is theirs.
   =========================================================================== */

export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const place = parsePlace((k) => url.searchParams.get(k));
  if (!place) return NextResponse.json({ ok: false, error: 'Not a location.' }, { status: 400 });

  const name = await reverseGeocode(place.lat, place.lon);
  return NextResponse.json({ ok: true, name });
}
