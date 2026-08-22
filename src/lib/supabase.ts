/* ===========================================================================
   Supabase access over PostgREST, using global fetch.

   No SDK: the REST surface is small and a dependency-free client keeps the
   bundle honest and works identically on Vercel and locally. The service-role
   key is server-only and must never reach the browser — every module that
   imports this file has to stay on the server side.
   =========================================================================== */

import 'server-only';

const baseUrl = () => (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY ?? '';

export function storeConfigured(): boolean {
  return Boolean(baseUrl() && serviceKey());
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!storeConfigured()) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  }
  const res = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    cache: 'no-store',
    ...init,
    headers: { ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} on ${path.split('?')[0]}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export type SelectOptions = {
  select?: string;
  /** PostgREST filters, e.g. { deleted: 'eq.false' }. */
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
};

/**
 * SELECT with automatic pagination.
 *
 * PostgREST caps every response at 1000 rows server-side. Reading a table with
 * a bare limit therefore returns a silent truncation, not an error — which is
 * exactly how a full history quietly becomes the most recent thousand rows.
 * This loops until a short page comes back.
 */
export async function select<T>(table: string, opts: SelectOptions = {}): Promise<T[]> {
  const base = new URLSearchParams();
  base.set('select', opts.select ?? '*');
  for (const [col, cond] of Object.entries(opts.filters ?? {})) base.set(col, cond);
  if (opts.order) base.set('order', opts.order);

  const want = Number.isFinite(opts.limit) ? (opts.limit as number) : Infinity;
  const pageSize = 1000;
  const out: T[] = [];

  for (let offset = 0; out.length < want; offset += pageSize) {
    const ask = Math.min(pageSize, want - out.length);
    const q = new URLSearchParams(base);
    q.set('limit', String(ask));
    q.set('offset', String(offset));
    const rows = await rest<T[]>(`${table}?${q.toString()}`);
    if (!rows?.length) break;
    out.push(...rows);
    if (rows.length < ask) break;
  }
  return out;
}

/** INSERT, or upsert on the primary key when `upsert` is set. */
export async function insert<T>(table: string, rows: T | T[], { upsert = false } = {}): Promise<T[]> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return [];
  const prefer = ['return=representation'];
  if (upsert) prefer.push('resolution=merge-duplicates');
  return rest<T[]>(table, {
    method: 'POST',
    headers: authHeaders({ Prefer: prefer.join(',') }),
    body: JSON.stringify(list),
  });
}

/** PATCH rows matching a filter, e.g. update('transactions', { id: 'eq.X' }, { verified: true }). */
export async function update<T>(
  table: string,
  filters: Record<string, string>,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const q = new URLSearchParams(filters);
  return rest<T[]>(`${table}?${q.toString()}`, {
    method: 'PATCH',
    headers: authHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
}

/**
 * The store's monotonic version counter, bumped by a Postgres trigger on every
 * write to transactions or income. One tiny query tells us whether a cached
 * snapshot is still good.
 */
export async function storeVersion(): Promise<number> {
  const rows = await rest<{ value: number }[]>('app_state?key=eq.version&select=value');
  return Number(rows?.[0]?.value ?? 0);
}

/** Append to the audit log (spec §3.10). Failures never block the caller. */
export async function logEvent(type: string, detail: unknown): Promise<void> {
  try {
    await insert('events', [{ type, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }]);
  } catch {
    // An unwritten audit line must not fail the user's action.
  }
}
