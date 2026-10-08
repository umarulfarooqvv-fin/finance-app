import 'server-only';
import { insert, select } from '@/lib/supabase';

/* ===========================================================================
   Reading and writing app_config.

   `app_config` is a key/value table whose values are JSON strings. It holds
   everything that is configuration rather than history: card settings, account
   opening balances, statement-cycle overrides, credit-ledger corrections.

   Until now it has been EMPTY, which is why card limits and opening balances
   all came from DEFAULT_CARDS in code and no edit could ever persist.

   One rule: a write here is read-modify-write on a single key, never a blind
   overwrite of the whole table. Two settings screens saving at once must not
   erase each other's key.
   =========================================================================== */

/* --- Batching ---------------------------------------------------------------
   A page asks for several keys — the inbox wants capture_drafts, voice_drafts
   and ai_usage; Today and Entries want photo_corrections and photo_questions —
   each through its own module. Asked one at a time, that was one round-trip
   per key, and pages awaited them in a row: the inbox paid five.

   Keys asked for in the same turn of the event loop are now fetched with ONE
   request (key=in.(…)), and the same key asked twice shares the answer. Nothing
   is cached beyond that turn, so a read is exactly as fresh as it was — the
   read-modify-write in updateConfigKey still reads right before it writes. */

type Waiter = { resolve: (raw: unknown) => void; reject: (e: unknown) => void };
let queued: Map<string, Waiter[]> | null = null;

function flush(batch: Map<string, Waiter[]>) {
  const keys = [...batch.keys()];
  // Keys are app-defined identifiers; quoting keeps any "," or ")" literal.
  const list = keys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(',');
  select('app_config', { filters: { key: `in.(${list})` }, select: 'key,value' }).then(
    (rows) => {
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      for (const [k, waiters] of batch) for (const w of waiters) w.resolve(byKey.get(k));
    },
    (err) => {
      for (const waiters of batch.values()) for (const w of waiters) w.reject(err);
    },
  );
}

function loadRaw(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!queued) {
      const batch = new Map<string, Waiter[]>();
      queued = batch;
      // setImmediate, not a microtask: callers a few awaits deep in the same
      // Promise.all still reach this before it fires.
      setImmediate(() => {
        queued = null;
        flush(batch);
      });
    }
    const waiters = queued.get(key);
    if (waiters) waiters.push({ resolve, reject });
    else queued.set(key, [{ resolve, reject }]);
  });
}

export async function readConfigKey<T>(key: string): Promise<T | null> {
  const raw = await loadRaw(key);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A value that is not JSON is corrupt rather than absent; surfacing null
    // would silently reset the setting on the next write.
    throw new Error(`Configuration under "${key}" is not valid JSON.`);
  }
}

/** Replace one key outright. */
export async function writeConfigKey(key: string, value: unknown): Promise<void> {
  await insert('app_config', [{ key, value: JSON.stringify(value) }], { upsert: true });
}

/**
 * Merge into a nested key, read-modify-write.
 *
 * `mutate` receives the current value (or a fresh object) and returns the next
 * one. Keeping the read and the write adjacent means a caller cannot
 * accidentally save a value it computed from a stale read earlier in a request.
 */
export async function updateConfigKey<T extends object>(
  key: string,
  mutate: (current: T) => T,
): Promise<T> {
  const current = ((await readConfigKey<T>(key)) ?? {}) as T;
  const next = mutate(current);
  await writeConfigKey(key, next);
  return next;
}
