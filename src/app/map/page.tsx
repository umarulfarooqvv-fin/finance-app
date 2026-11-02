import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { currentSnapshot } from '@/lib/views';
import { loadPlaces } from '@/lib/places';
import { mapPins, placedMonths } from '@/lib/map-pins';
import { formatMonth, monthKey } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Empty, Money, Panel, cx } from '@/components/ui/primitives';
import { MapClient } from './map-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Where the money went, on a map. One pin per place (lib/map-pins), sized by
   what was spent there, and a list of the places underneath — the list is
   the part that works with the map scrolled away, or with no network for
   tiles at all.

   Entries get a place from the Shortcut, from the photo they were made from,
   or from the entry form (lib/places).
   =========================================================================== */

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const { snap, today } = await currentSnapshot();
  const places = await loadPlaces(snap.version);

  const months = placedMonths(snap.transactions, places);
  const asked = typeof sp['m'] === 'string' ? sp['m'] : null;
  // Default: this month if anything was placed in it, else everything.
  const month = asked === 'all' ? null
    : asked && /^\d{4}-\d{2}$/.test(asked) ? asked
      : months.includes(monthKey(today)) ? monthKey(today) : null;

  const pins = mapPins(snap.transactions, places, month);
  const placed = pins.reduce((a, p) => a + p.count, 0);

  const chip = (label: string, m: string, on: boolean) => (
    <Link
      key={m}
      href={`/map?m=${m}`}
      className={cx(
        'shrink-0 rounded-full border px-3 py-1 text-xs',
        on
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-3)] hover:text-[var(--color-ink)]',
      )}
    >
      {label}
    </Link>
  );

  return (
    <Page>
      <PageHeader
        title="Map"
        subtitle={`${placed.toLocaleString('en-IN')} ${placed === 1 ? 'entry' : 'entries'} at ${pins.length} ${pins.length === 1 ? 'place' : 'places'}${month ? ` · ${formatMonth(month)}` : ''}`}
      />

      {months.length === 0 ? (
        <Panel>
          <Empty
            title="No entries with a location yet"
            hint="New entries made in the app ask for your location. From the iPhone Shortcut, send x-lat and x-lon headers with each entry or photo."
          />
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {chip('All time', 'all', month === null)}
            {months.slice(0, 12).map((m) => chip(formatMonth(m), m, m === month))}
          </div>

          <MapClient pins={pins} />

          <Panel className="mt-4" padded={false}>
            <ul>
              {pins.map((p) => (
                <li key={p.key} className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 last:border-b-0">
                  <MapPin className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="sensitive truncate text-sm">
                      {p.label ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}
                    </div>
                    <div className="truncate text-[11px] text-[var(--color-ink-3)]">
                      {p.count} {p.count === 1 ? 'entry' : 'entries'} · {p.entries.slice(0, 3).map((e) => e.remarks || e.category).join(', ')}
                    </div>
                  </div>
                  <Money value={p.spent} size="sm" className="shrink-0" />
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </Page>
  );
}
