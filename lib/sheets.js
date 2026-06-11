// Client for the Apps Script write proxy (apps-script/Code.gs).
// All writes to the Daily Spent sheet go through this — the app never edits
// the sheet by any other route, and never touches Form columns it shouldn't.

const URL_ = () => process.env.APPS_SCRIPT_URL;
const TOKEN = () => process.env.APPS_SCRIPT_TOKEN;

export function writesEnabled() {
  return Boolean(URL_() && TOKEN());
}

async function call(action, payload = {}) {
  if (!writesEnabled()) {
    throw new Error('Apps Script not configured. Set APPS_SCRIPT_URL and APPS_SCRIPT_TOKEN in .env.local (see SETUP.md).');
  }
  const res = await fetch(URL_(), {
    method: 'POST',
    // text/plain avoids preflight; Apps Script parses the body itself
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: TOKEN(), action, ...payload }),
    redirect: 'follow', // Apps Script responds via 302 → script.googleusercontent.com
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!json.ok) throw new Error(json.error || 'Apps Script error');
  return json;
}

/** Append a new transaction row (columns A–E only). Returns { row }. */
export function appendRow({ timestamp, amount, method, category, remarks }) {
  return call('append', { timestamp, amount, method, category, remarks });
}

/** Update columns A–E of an existing row. */
export function updateRow({ row, timestamp, amount, method, category, remarks }) {
  return call('update', { row, timestamp, amount, method, category, remarks });
}

/** Persist a verified flag in the AppMeta tab (never in Form Responses 1). */
export function setMeta({ txId, row, verified, note }) {
  return call('setMeta', { txId, row, verified, note });
}

/** Read all metadata rows (used to hydrate verified flags on fresh installs). */
export function getMeta() {
  return call('getMeta');
}

export function ping() {
  return call('ping');
}
