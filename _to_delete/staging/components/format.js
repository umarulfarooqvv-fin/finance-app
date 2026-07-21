export const inr = (n) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);

export const inr0 = (n) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "06, June 26 at Sat" — matches the sheet's display style */
export function sheetDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}, ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)} at ${DAYS[d.getDay()]}`;
}

export function shortDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}

export function shortDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${shortDate(isoStr)}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
