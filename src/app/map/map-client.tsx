'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { money } from '@/lib/format';
import { formatDayShort } from '@/lib/time';
import { mapsUrl } from '@/lib/place';
import type { Pin } from '@/lib/map-pins';

/* ===========================================================================
   The map. Leaflet over OpenStreetMap tiles, loaded in the browser only (it
   reaches for `window` the moment it is imported).

   Circles, not marker images: Leaflet's default marker is a PNG whose path
   breaks under a bundler, and a circle can say how much was spent by its
   size. Its colour is a CSS class, so it follows the theme like everything
   else; the tiles are inverted in dark mode (globals.css, `.map-tiles`).

   A popup's figures carry `.num .sensitive`, so privacy mode blurs them here
   exactly as it does on every other page.
   =========================================================================== */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function popup(p: Pin): string {
  const shown = p.entries.slice(0, 8);
  const rows = shown.map((e) => `
    <li class="map-pop-row">
      <span class="map-pop-what">${esc(e.remarks || e.category)}<small>${esc(formatDayShort(e.ts.slice(0, 10)))} · ${esc(e.method || '—')}</small></span>
      <span class="num sensitive">${esc(money(e.amount))}</span>
    </li>`).join('');
  const more = p.entries.length > shown.length ? `<li class="map-pop-more">and ${p.entries.length - shown.length} more</li>` : '';
  const title = p.label ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
  return `
    <div class="map-pop">
      <strong class="sensitive">${esc(title)}</strong>
      <div class="map-pop-sum">${p.count} ${p.count === 1 ? 'entry' : 'entries'} · spent <span class="num sensitive">${esc(money(p.spent))}</span></div>
      <ul>${rows}${more}</ul>
      <a href="${esc(mapsUrl({ lat: p.lat, lon: p.lon, ...(p.label ? { label: p.label } : {}) }))}" target="_blank" rel="noopener noreferrer">Open in Maps</a>
    </div>`;
}

export function MapClient({ pins }: { pins: Pin[] }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: import('leaflet').Map | null = null;
    let gone = false;

    void import('leaflet').then((L) => {
      if (gone) return;
      map = L.map(el, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'map-tiles',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      // Area tracks spend, so a pin twice as big means twice the money.
      const top = Math.max(1, ...pins.map((p) => p.spent));
      for (const p of pins) {
        const r = 6 + 16 * Math.sqrt(Math.max(0, p.spent) / top);
        L.circleMarker([p.lat, p.lon], { radius: r, className: 'map-pin', weight: 2, fillOpacity: 0.35 })
          .bindPopup(popup(p), { maxWidth: 280 })
          .addTo(map);
      }

      if (pins.length === 1) map.setView([pins[0]!.lat, pins[0]!.lon], 16);
      else if (pins.length > 1) map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lon] as [number, number])), { padding: [32, 32], maxZoom: 16 });
      else map.setView([10.0, 76.3], 11);
    });

    return () => { gone = true; map?.remove(); };
  }, [pins]);

  return (
    <div
      ref={box}
      role="region"
      aria-label="Map of where money was spent"
      className="relative z-0 h-[55vh] min-h-[280px] w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)]"
    />
  );
}
