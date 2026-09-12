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

export async function readConfigKey<T>(key: string): Promise<T | null> {
  const rows = await select('app_config', { filters: { key: `eq.${key}` }, limit: 1 });
  const raw = rows[0]?.value;
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
