import { describe, expect, it } from 'vitest';
import { buildIcs, icsEscape, icsFold } from '@/lib/ics';
import type { Due } from '@/lib/upcoming';

const due = (over: Partial<Due> = {}): Due => ({
  kind: 'bill',
  id: 'bill:Coral:2026-09-25',
  title: 'Coral bill',
  amount: 2312.16,
  on: '2026-10-12',
  daysAway: 3,
  card: 'Coral',
  ...over,
});

const opts = { leadDays: [3, 0], generatedAt: '2026-09-20T12:00:00' };
/* A calendar alert shows its summary on the lock screen, so the figure is
   opt-in. Tests that care about the amount ask for it explicitly. */
const withMoney = { ...opts, showAmounts: true };

describe('icsEscape', () => {
  /* A semicolon or comma in a remark splits one event into fragments the
     calendar reads as garbage; a newline forges whole properties. */
  it('escapes the characters that carry meaning in a value', () => {
    expect(icsEscape('Rent; Aug, paid')).toBe('Rent\\; Aug\\, paid');
    expect(icsEscape('a\\b')).toBe('a\\\\b');
    expect(icsEscape('one\ntwo')).toBe('one\\ntwo');
    expect(icsEscape('one\r\ntwo')).toBe('one\\ntwo');
  });

  it('cannot be used to inject a calendar property', () => {
    const out = icsEscape('x\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:forged');
    expect(out).not.toMatch(/\n/);
  });
});

describe('icsFold', () => {
  it('leaves a short line alone', () => {
    expect(icsFold('SUMMARY:short')).toBe('SUMMARY:short');
  });

  /* Folding is measured in OCTETS. A rupee sign is three bytes, so counting
     characters emits lines a parser rejects on a feed full of money. */
  it('folds by byte length, not character count', () => {
    const line = `SUMMARY:${'₹'.repeat(40)}`;
    for (const part of icsFold(line).split('\r\n')) {
      expect(Buffer.from(part, 'utf8').length).toBeLessThanOrEqual(76);
    }
  });

  it('never splits a character in half', () => {
    const line = `SUMMARY:${'₹'.repeat(40)}`;
    const rejoined = icsFold(line).split('\r\n ').join('');
    expect(rejoined).toBe(line);
    expect(rejoined).not.toContain('�');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs([due()], opts);

  it('is a well-formed calendar', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(1);
    // CRLF throughout, as the spec requires.
    expect(ics.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
  });

  it('carries the card into the entry, and the amount only when asked', () => {
    expect(ics).toContain('SUMMARY:Coral bill');
    expect(ics).toContain('On Coral');
    // Off by default: the lock screen cannot be blurred.
    expect(ics).not.toContain('2312.16');
    expect(buildIcs([due()], withMoney)).toContain('2312.16');
  });

  /* Re-publishing must update the phone's existing entry, not add a second
     copy of the same bill every refresh. */
  it('gives an event a stable id derived from the due', () => {
    const again = buildIcs([due()], { ...opts, generatedAt: '2026-09-21T08:00:00' });
    const uid = (s: string) => s.match(/UID:(.*)\r\n/)![1];
    expect(uid(again)).toBe(uid(ics));
  });

  it('writes one alarm per lead day, furthest out first', () => {
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics.indexOf('TRIGGER:-P3D')).toBeLessThan(ics.indexOf('TRIGGER:-PT0M'));
  });

  it('drops a nonsensical lead rather than emitting a broken trigger', () => {
    const odd = buildIcs([due()], { ...opts, leadDays: [-1, 2.5, 1000, 3] });
    expect(odd.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(odd).toContain('TRIGGER:-P3D');
  });

  it('handles a due with no knowable amount', () => {
    const none = buildIcs([due({ amount: null, title: 'Netflix' })], withMoney);
    expect(none).toContain('SUMMARY:Netflix');
    expect(none).not.toContain('₹');
  });

  it('escapes a title on its way in', () => {
    const nasty = buildIcs([due({ title: 'Rent; Aug, flat' })], opts);
    expect(nasty).toContain('SUMMARY:Rent\\; Aug\\, flat');
  });

  it('is an empty calendar when nothing is due', () => {
    const empty = buildIcs([], opts);
    expect(empty).not.toContain('BEGIN:VEVENT');
    expect(empty).toContain('END:VCALENDAR');
  });
});
