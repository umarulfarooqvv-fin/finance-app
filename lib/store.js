// ---------------------------------------------------------------------------
// Supabase (Postgres) data store — accessed through Supabase's built-in REST
// API (PostgREST) using global fetch, so there is NO npm dependency and it runs
// anywhere (Vercel, local). The service-role key is server-only; never ship it
// to the browser. Configure via env: SUPABASE_URL + SUPABASE_SERVICE_KEY.
// ---------------------------------------------------------------------------

const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_KEY || '';

export function storeEnabled() {
  return Boolean(URL_() && KEY());
}

function headers(extra = {}) {
  return {
    apikey: KEY(),
    Authorization: `Bearer ${KEY()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(path, init = {}) {
  if (!storeEnabled()) throw new Error('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    cache: 'no-store',
    ...init,
    // Auth headers on EVERY request (GETs included), merged with any per-call
    // extras (e.g. Prefer) — a bare select() must still send the apikey.
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** SELECT rows. opts: { select, filters:{col:'eq.val'}, order, limit }. */
export async function select(table, opts = {}) {
  const p = new URLSearchParams();
  p.set('select', opts.select || '*');
  for (const [col, cond] of Object.entries(opts.filters || {})) p.set(col, cond);
  if (opts.order) p.set('order', opts.order);
  if (opts.limit) p.set('limit', String(opts.limit));
  return rest(`${table}?${p.toString()}`);
}

/** INSERT (or upsert on primary key) an array of rows. */
export async function insert(table, rows, { upsert = false } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return [];
  const prefer = ['return=representation'];
  if (upsert) prefer.push('resolution=merge-duplicates');
  return rest(table, { method: 'POST', headers: headers({ Prefer: prefer.join(',') }), body: JSON.stringify(list) });
}

/** PATCH rows matching a filter, e.g. update('transactions', {id:'eq.X'}, {verified:true}). */
export async function update(table, filters, patch) {
  const p = new URLSearchParams();
  for (const [col, cond] of Object.entries(filters)) p.set(col, cond);
  return rest(`${table}?${p.toString()}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
}

/** Cheap monotonic version — bumps whenever transactions/income change. */
export async function getVersion() {
  try {
    const r = await select('app_state', { filters: { key: 'eq.version' }, select: 'value' });
    return r && r[0] ? Number(r[0].value) : 0;
  } catch {
    return 0;
  }
}

/** Key/value config (budgets, recurring defs, etc.). */
export async function getConfigValue(key) {
  const r = await select('app_config', { filters: { key: `eq.${key}` }, select: 'value' });
  return r && r[0] ? r[0].value : null;
}

export async function setConfigValue(key, value) {
  return insert('app_config', [{ key, value }], { upsert: true });
}
