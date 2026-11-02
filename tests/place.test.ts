import { describe, expect, it } from 'vitest';
import { formatPlace, mapsUrl, parsePlace } from '@/lib/place';
import { draftEntries } from '@/lib/draft-entries';

const from = (o: Record<string, unknown>) => (k: string) => o[k];

describe('where a photo was taken', () => {
  it('reads latitude and longitude as two fields, under any of their names', () => {
    expect(parsePlace(from({ lat: '9.9312', lon: '76.2673' }))).toEqual({ lat: 9.9312, lon: 76.2673 });
    expect(parsePlace(from({ latitude: 9.9312, longitude: 76.2673 }))).toEqual({ lat: 9.9312, lon: 76.2673 });
    expect(parsePlace(from({ lat: '9.9312', lng: '76.2673', place: '  MG Road,\n Kochi ' })))
      .toEqual({ lat: 9.9312, lon: 76.2673, label: 'MG Road, Kochi' });
  });

  it('reads both from one string, or an Apple Maps link', () => {
    expect(parsePlace(from({ location: '9.9312, 76.2673' }))).toEqual({ lat: 9.9312, lon: 76.2673 });
    expect(parsePlace(from({ location: 'https://maps.apple.com/?ll=9.9312,76.2673&q=x' }))).toEqual({ lat: 9.9312, lon: 76.2673 });
  });

  it('refuses what is not a coordinate', () => {
    expect(parsePlace(from({}))).toBeNull();
    expect(parsePlace(from({ lat: '91', lon: '76' }))).toBeNull();
    expect(parsePlace(from({ lat: 'here', lon: '76' }))).toBeNull();
    expect(parsePlace(from({ location: 'MG Road, Kochi 682001' }))).toBeNull();
    expect(parsePlace(from({ lat: '0', lon: '0' }))).toBeNull();
  });

  it('rounds to six places, and links to a map', () => {
    const p = parsePlace(from({ lat: '9.93123456', lon: '76.26734567' }))!;
    expect(p).toEqual({ lat: 9.931235, lon: 76.267346 });
    expect(formatPlace(p)).toBe('9.9312, 76.2673');
    expect(mapsUrl(p)).toBe('https://maps.apple.com/?ll=9.931235,76.267346&q=Photo%20taken%20here');
  });

  it('rides along on the drafts read from that photo', () => {
    const photo = { id: 'p1', ts: '2026-09-25T13:54:26', bytes: 1 };
    const text = '25/09/2026 | 380 | RBL | Medicine | Arafa Medical';
    const place = { lat: 9.9312, lon: 76.2673 };
    expect(draftEntries([photo], { p1: { text } }, {}, [], { p1: place })[0]!.place).toEqual(place);
    expect(draftEntries([photo], { p1: { text } }, {}, [])[0]!.place).toBeNull();
  });
});

import { nameFromLookup } from '@/lib/place';
import { mapPins, placedMonths } from '@/lib/map-pins';
import type { Transaction } from '@/lib/types';

describe('naming a place from OpenStreetMap', () => {
  it('the named thing, then the area it is in', () => {
    expect(nameFromLookup({ name: 'Lulu Mall', address: { road: 'NH 66', suburb: 'Edappally', city: 'Kochi' } }))
      .toBe('Lulu Mall, Edappally');
    expect(nameFromLookup({ name: '', address: { road: 'MG Road', city: 'Kochi' } })).toBe('MG Road, Kochi');
    expect(nameFromLookup({ display_name: 'A, B, C, India' })).toBe('A, B');
    expect(nameFromLookup({ error: 'Unable to geocode' })).toBeNull();
    expect(nameFromLookup(null)).toBeNull();
  });
});

describe('pins on the map', () => {
  const t = (id: string, amount: number, ts: string, over: Partial<Transaction> = {}): Transaction => ({
    id, ts, amount, method: 'RBL', category: 'Food', remarks: id, userTags: [], kind: 'spend',
    cardAffected: null, cardDirection: null, tags: {}, verified: false, needsReview: false, deleted: false, source: 'app',
    ...over,
  } as Transaction);
  const cafe = { lat: 9.9312, lon: 76.2673, label: 'Cafe' };
  const txs = [
    t('a', 100, '2026-10-01T09:00:00'),
    t('b', 50, '2026-10-02T09:00:00'),
    t('c', 900, '2026-09-20T09:00:00'),
    t('d', 5000, '2026-10-03T09:00:00', { kind: 'card_payment' }),
    t('e', 10, '2026-10-04T09:00:00', { deleted: true }),
    t('f', 20, '2026-10-05T09:00:00'),
  ];
  const places = {
    a: cafe, b: { ...cafe, lat: 9.9313 }, c: cafe,
    d: { lat: 9.95, lon: 76.3 }, e: cafe,
    f: { lat: 9.95004, lon: 76.30004 },
  };

  it('one pin per place, spend only, newest first, deleted left out', () => {
    const pins = mapPins(txs, places, '2026-10');
    expect(pins).toHaveLength(2);
    const c = pins.find((p) => p.label === 'Cafe')!;
    expect(c).toMatchObject({ count: 2, spent: 150 });
    expect(c.entries.map((e) => e.id)).toEqual(['b', 'a']);
    // Nameless and within ~100m share a pin; the bill payment adds nothing.
    expect(pins.find((p) => p.label === null)).toMatchObject({ count: 2, spent: 20 });
  });

  it('all time, and the months that have places', () => {
    expect(mapPins(txs, places, null).find((p) => p.label === 'Cafe')).toMatchObject({ count: 3, spent: 1050 });
    expect(placedMonths(txs, places)).toEqual(['2026-10', '2026-09']);
  });
});
