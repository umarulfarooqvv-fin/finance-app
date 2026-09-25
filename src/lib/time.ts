/* ===========================================================================
   Wall-clock time, with no timezone anywhere in the arithmetic.

   Every timestamp in this system is IST wall time written as a naive ISO
   string: "YYYY-MM-DDTHH:MM:SS", no offset, no Z. That is what the Postgres
   `ts` column holds and what the phone Shortcut sends. It is deliberate: the
   day a transaction belongs to is the day Farooq was living in when he made
   it, and no UTC conversion may ever move it across midnight.

   The rule this module enforces: a JS `Date` is used in exactly ONE function
   (`nowIST`), to ask the host what time it is. Every other operation works on
   the string's own components. That makes the whole engine immune to the
   server's timezone — the Vercel box runs in UTC and gets identical answers to
   the laptop running in IST.

   Naive ISO strings also sort lexicographically in chronological order, so
   comparison is just `<` and `>`. No parsing needed on the hot path.
   =========================================================================== */

/** IST wall clock, "YYYY-MM-DDTHH:MM:SS". Comparable with < and >. */
export type Instant = string;
/** A calendar day, "YYYY-MM-DD". Also comparable with < and >. */
export type Day = string;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export type Civil = {
  y: number;
  m: number; // 1-12, NOT the 0-11 that Date uses
  d: number;
  hh: number;
  mm: number;
  ss: number;
};

/** The one place that reads the host clock. Formats it as IST wall time. */
export function nowIST(at: Date = new Date()): Instant {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  // en-CA with hour12:false yields "24" for midnight in some ICU versions.
  const hh = g('hour') === '24' ? '00' : g('hour');
  return `${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}:${g('second')}`;
}

export function toCivil(t: Instant): Civil {
  return {
    y: Number(t.slice(0, 4)),
    m: Number(t.slice(5, 7)),
    d: Number(t.slice(8, 10)),
    hh: Number(t.slice(11, 13)) || 0,
    mm: Number(t.slice(14, 16)) || 0,
    ss: Number(t.slice(17, 19)) || 0,
  };
}

export function fromCivil(c: Civil): Instant {
  return `${pad(c.y, 4)}-${pad(c.m)}-${pad(c.d)}T${pad(c.hh)}:${pad(c.mm)}:${pad(c.ss)}`;
}

/** "YYYY-MM-DDTHH:MM:SS" -> "YYYY-MM-DD". Pure slice; no parsing. */
export function dayOf(t: Instant): Day {
  return t.slice(0, 10);
}

export function startOfDay(d: Day): Instant {
  return `${d}T00:00:00`;
}

/** Inclusive upper bound for a day. Seconds resolution matches the stored data. */
export function endOfDay(d: Day): Instant {
  return `${d}T23:59:59`;
}

/* --- Calendar arithmetic (Howard Hinnant's civil<->days algorithms) ---------
   These convert a proleptic Gregorian date to a day number and back, using
   only integer maths. No Date, no timezone, no DST. */

export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

export function dayNumber(d: Day): number {
  return daysFromCivil(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)));
}

export function dayFromNumber(n: number): Day {
  const c = civilFromDays(n);
  return `${pad(c.y, 4)}-${pad(c.m)}-${pad(c.d)}`;
}

export function addDays(d: Day, n: number): Day {
  return dayFromNumber(dayNumber(d) + n);
}

/** An instant moved by a number of seconds, across midnight and month ends.
    Civil arithmetic on the wall clock, like everything else here — no Date. */
export function addSeconds(t: Instant, n: number): Instant {
  const c = toCivil(t);
  const total = dayNumber(dayOf(t)) * 86_400 + c.hh * 3_600 + c.mm * 60 + c.ss + Math.round(n);
  const days = Math.floor(total / 86_400);
  const rest = total - days * 86_400;
  return `${dayFromNumber(days)}T${pad(Math.floor(rest / 3_600))}:${pad(Math.floor((rest % 3_600) / 60))}:${pad(rest % 60)}`;
}

/** Whole days from `a` to `b`. Positive when b is later. */
export function daysBetween(a: Day, b: Day): number {
  return dayNumber(b) - dayNumber(a);
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/**
 * Build a Day for `dayOfMonth` in the given month, CLAMPED to the month's real
 * length. This is why the function exists: a card billing on the 31st must land
 * on 28-Feb, not roll forward into March. Constructing `new Date(y, 1, 31)`
 * silently rolls over — a latent bug for any bill date past the 28th.
 */
export function dayInMonth(y: number, m: number, dayOfMonth: number): Day {
  let yy = y;
  let mm = m;
  while (mm > 12) {
    mm -= 12;
    yy += 1;
  }
  while (mm < 1) {
    mm += 12;
    yy -= 1;
  }
  return `${pad(yy, 4)}-${pad(mm)}-${pad(Math.min(dayOfMonth, daysInMonth(yy, mm)))}`;
}

/** Shift a year/month pair by n months, normalised. */
export function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

/** "YYYY-MM" bucket key, used everywhere monthly aggregation happens. */
export function monthKey(t: Instant | Day): string {
  return t.slice(0, 7);
}

export function monthStart(key: string): Day {
  return `${key}-01`;
}

export function monthEnd(key: string): Day {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return `${key}-${pad(daysInMonth(y, m))}`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** 0 = Monday. Derived from the day number, so no Date involved. */
export function weekdayIndex(d: Day): number {
  return ((dayNumber(d) % 7) + 10) % 7;
}

export function weekdayName(d: Day): string {
  return WEEKDAYS[weekdayIndex(d)] ?? '';
}

export function monthShort(m: number): string {
  return MONTHS_SHORT[m - 1] ?? '';
}

/** "12 Jun 2026" — the app's standard date rendering. */
export function formatDay(d: Day): string {
  const y = d.slice(0, 4);
  const m = Number(d.slice(5, 7));
  const dd = Number(d.slice(8, 10));
  return `${dd} ${monthShort(m)} ${y}`;
}

/** "12 Jun, Fri" — compact form for dense tables. */
export function formatDayShort(d: Day): string {
  const m = Number(d.slice(5, 7));
  const dd = Number(d.slice(8, 10));
  return `${dd} ${monthShort(m)}, ${weekdayName(d)}`;
}

export function formatMonth(key: string): string {
  return `${monthShort(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`;
}

/** "in 11 days" / "3 days ago" / "today" — relative to a reference day. */
export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
}
