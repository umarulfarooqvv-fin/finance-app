import type { Due } from '@/lib/upcoming';

/* ===========================================================================
   The reminder feed, as a calendar.

   Push notifications are the sharp end of this feature and the fragile one:
   they need the app on the Home Screen, a granted permission, and a
   subscription Apple may quietly drop after weeks of not opening the app. An
   EMI that goes unpaid because a push subscription lapsed is exactly the
   failure this feature exists to prevent.

   So the same dues are also published as a calendar the phone subscribes to
   once. It needs no permission, no install, and no service worker; iOS keeps
   refreshing it whether or not the app is ever opened again. It is slower —
   the refresh interval is the phone's to choose — which is why it is the
   backstop and not the headline.

   EVERY TIME IS UTC. Writing local times would need a VTIMEZONE block that has
   to stay correct forever; an absolute instant cannot drift, and the phone
   renders it in whatever zone it is in.
   =========================================================================== */

/** 09:00 IST, which is 03:30 UTC. Early enough to act on the same day. */
const HOUR_UTC = 3;
const MINUTE_UTC = 30;
const DURATION_MINUTES = 30;

/**
 * Escape a value for a text field.
 *
 * RFC 5545 gives backslash, semicolon and comma meaning inside a value, and a
 * newline ends the property outright. A remark like "Rent; Aug, paid" would
 * otherwise split one event into fragments a calendar reads as garbage — and
 * an unescaped newline lets any remark forge whole calendar properties.
 */
export function icsEscape(text: string): string {
  return (text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a line to 75 octets, per RFC 5545.
 *
 * Measured in OCTETS, not characters: a rupee sign is three bytes in UTF-8, so
 * counting characters would emit lines that parsers reject on a feed whose
 * every event carries a ₹.
 */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off to a lead byte.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return out.join('\r\n ');
}

/**
 * A UTC timestamp, with minutes carried into hours.
 *
 * Written without the carry, an event starting at 03:30 and lasting 30 minutes
 * ended at "036000Z" — minute sixty, which is not a time. Some parsers take
 * it, some reject the whole event, and the one that rejects it does so
 * silently on a phone with no console.
 */
function stamp(day: string, h: number, m: number): string {
  const total = h * 60 + m;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${day.replace(/-/g, '')}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00Z`;
}

const KIND_LABEL: Record<Due['kind'], string> = {
  bill: 'Card bill',
  emi: 'EMI',
  subscription: 'Subscription',
};

/**
 * A calendar of everything due.
 *
 * `leadDays` becomes one alarm per lead on every event, so a three-day and a
 * same-day warning are two alerts on one entry rather than two entries.
 *
 * `generatedAt` is a parameter rather than a clock read: a feed that changes
 * on every fetch cannot be diffed or tested.
 */
export function buildIcs(
  dues: Due[],
  opts: { leadDays: number[]; generatedAt: string; domain?: string; showAmounts?: boolean },
): string {
  const domain = opts.domain ?? 'finance.local';
  const dtstamp = `${opts.generatedAt.slice(0, 10).replace(/-/g, '')}T${opts.generatedAt.slice(11, 19).replace(/:/g, '')}Z`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Finance//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Finance reminders',
    // Ask the phone to come back hourly. It is a hint, not a promise.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const due of dues) {
    /* Same reasoning as a push notification: a calendar alert shows its
       summary on the lock screen, where nothing is blurred. */
    const money = !opts.showAmounts || due.amount == null ? '' : ` — \u20b9${due.amount.toFixed(2)}`;
    const summary = `${due.title}${money}`;
    const where = due.card ? `\\nOn ${due.card}` : '';

    lines.push(
      'BEGIN:VEVENT',
      // Derived from the due's own id, so re-publishing updates the event
      // rather than creating a second copy of it in the phone's calendar.
      `UID:${encodeURIComponent(due.id)}@${domain}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(due.on, HOUR_UTC, MINUTE_UTC)}`,
      `DTEND:${stamp(due.on, HOUR_UTC, MINUTE_UTC + DURATION_MINUTES)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(`${KIND_LABEL[due.kind]}${where}`)}`,
      'TRANSP:TRANSPARENT',
    );

    for (const lead of [...new Set(leadsFor(opts.leadDays))].sort((a, b) => b - a)) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:${lead === 0 ? '-PT0M' : `-P${lead}D`}`,
        `DESCRIPTION:${icsEscape(summary)}`,
        'END:VALARM',
      );
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Negative or absurd leads are dropped rather than emitted as broken triggers. */
function leadsFor(leadDays: number[]): number[] {
  return leadDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
}
