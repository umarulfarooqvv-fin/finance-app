import 'server-only';
import { classify } from '@/lib/classify';
import { DEFAULT_ACCOUNTS, DEFAULT_CARDS } from '@/lib/defaults';
import { nowIST } from '@/lib/time';
import type { Account, Card, Income, Snapshot, Transaction } from '@/lib/types';
import { select, storeConfigured, storeVersion } from '@/lib/supabase';

/* ===========================================================================
   Loading the world into memory, once.

   v2 mirrored Postgres into a SQLite file on every cold start so the engine
   could run SQL against it. That bought a native module, a Node version pin, a
   /tmp carve-out on Vercel and a bootstrap step in front of every request — to
   query about half a megabyte of data.

   This holds the rows in a plain object instead. The store keeps a monotonic
   version counter that a Postgres trigger bumps on every write, so staying
   fresh costs one tiny query: if the number has not moved, the cached snapshot
   is still exactly right and nothing is refetched.
   =========================================================================== */

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;

/**
 * Build a transaction from a stored row.
 *
 * `kind`, `card_affected`, `card_direction` and `tags` are DERIVED columns —
 * they are whatever the app version that wrote the row decided, and 2,468 of
 * these rows were classified by v2's rules. Reading them back would freeze
 * those rules into the data permanently: every classifier improvement would
 * apply only to rows written after it shipped.
 *
 * So they are re-derived here from the raw fields the user actually entered
 * (method, category, remarks), which are the only real source of truth. The
 * stored columns stay as a cache for anything querying Postgres directly.
 *
 * This is what made the whole history land under one "Unassigned" debtor —
 * v2's parser never extracted a person — and what let v2's looser n/m regex
 * invent 25 instalment plans out of ordinary remarks.
 */
function toTransaction(r: Row): Transaction {
  const method = str(r['method']);
  const category = str(r['category']);
  const remarks = str(r['remarks']);
  const cls = classify({ method, category, remarks });

  const ts = str(r['ts'], '');
  const amount = num(r['amount']);

  return {
    id: str(r['id']),
    ts: ts || null,
    amount,
    method,
    category,
    remarks,
    kind: cls.kind,
    cardAffected: cls.cardAffected,
    cardDirection: cls.cardDirection,
    tags: cls.tags,
    // Reconciliation state is real user input, not derived — always trusted.
    verified: bool(r['verified']),
    needsReview: amount === null || cls.kind === 'unknown',
    deleted: bool(r['deleted']),
    source: str(r['source'], 'app'),
  };
}

function toIncome(r: Row): Income {
  const ts = str(r['ts'], '');
  return {
    id: str(r['id']),
    ts: ts || null,
    amount: num(r['amount']),
    source: str(r['source']),
    account: str(r['account']),
    remarks: str(r['remarks']),
    needsReview: bool(r['needs_review']),
    deleted: bool(r['deleted']),
  };
}

/** Parse an app_config value, which is stored as a JSON string. */
function parseConfigValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Merge stored card settings over the audited defaults.
 * The user's own edits always win; defaults only fill gaps, so re-deploying
 * can never silently reset a credit limit or an opening balance.
 */
function mergeCards(stored: unknown): Card[] {
  if (!Array.isArray(stored) || !stored.length) return DEFAULT_CARDS;
  const byName = new Map(DEFAULT_CARDS.map((c) => [c.name, c]));
  const out: Card[] = [];
  for (const raw of stored as Partial<Card>[]) {
    if (!raw?.name) continue;
    const base = byName.get(raw.name) ?? {
      name: raw.name, billDate: 1, graceDays: 15, dueDay: null, dueCycle: 'same' as const,
      creditLimit: 0, openingBalance: 0, openingDate: null, slot: 1, active: true,
    };
    out.push({ ...base, ...raw });
    byName.delete(raw.name);
  }
  // Any default card the stored config never mentioned still belongs.
  out.push(...byName.values());
  return out;
}

function mergeAccounts(stored: unknown): Account[] {
  if (!Array.isArray(stored) || !stored.length) return DEFAULT_ACCOUNTS;
  return stored as Account[];
}

/** Read everything, in parallel. */
async function loadSnapshot(version: number): Promise<Snapshot> {
  const [txRows, incRows, cfgRows] = await Promise.all([
    select<Row>('transactions', { order: 'ts.asc' }),
    select<Row>('income', { order: 'ts.asc' }),
    select<Row>('app_config'),
  ]);

  const config: Record<string, unknown> = {};
  for (const row of cfgRows) {
    config[str(row['key'])] = parseConfigValue(row['value']);
  }

  return {
    transactions: txRows.map(toTransaction),
    income: incRows.map(toIncome),
    cards: mergeCards(config['cards']),
    accounts: mergeAccounts(config['accounts']),
    config,
    version,
    loadedAt: nowIST(),
  };
}

/* --- Cache ----------------------------------------------------------------
   Module scope survives between warm invocations on Vercel and for the whole
   process locally. `inflight` collapses concurrent first-hits so a cold start
   serving several requests at once loads the data once, not once per request.

   The version check is CHEAP but it is not FREE — one network round-trip.
   Measured from a laptop in India against the Sydney instance it costs ~464ms
   warm, and running it on every page view put that latency under every single
   render. (In production the function and the database share a region, so the
   same hop is single-digit milliseconds — but paying it per request was still
   wrong.)

   So the check is throttled: inside the revalidate window the cached snapshot
   is served with no I/O at all. Writes from this process call
   invalidateSnapshot() and are visible immediately; a write from somewhere
   else — the phone Shortcut hitting a different lambda — becomes visible
   within the window. That bounded staleness is the trade the blueprint's
   30-second permission cache and 60-second profile cookie make too. */

const REVALIDATE_AFTER_MS = 30_000;

let cached: Snapshot | null = null;
let validatedAt = 0;
let inflight: Promise<Snapshot> | null = null;

export type SnapshotOptions = {
  /** Skip the version check and refetch unconditionally. */
  force?: boolean;
};

export async function getSnapshot(opts: SnapshotOptions = {}): Promise<Snapshot> {
  if (!storeConfigured()) {
    // Local dev with no credentials: an empty world beats a crash, and the UI
    // renders its empty states instead of a stack trace.
    return {
      transactions: [], income: [], cards: DEFAULT_CARDS, accounts: DEFAULT_ACCOUNTS,
      config: {}, version: 0, loadedAt: nowIST(),
    };
  }

  if (!opts.force && cached) {
    // Inside the window, trust the cache outright — no network at all.
    if (Date.now() - validatedAt < REVALIDATE_AFTER_MS) return cached;
    try {
      const version = await storeVersion();
      validatedAt = Date.now();
      if (version === cached.version) return cached;
    } catch {
      // Version check failed: serve what we have rather than falling over.
      // Not stamping validatedAt means the next request retries rather than
      // treating an unreachable store as a successful validation.
      return cached;
    }
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const version = await storeVersion().catch(() => Date.now());
      const snap = await loadSnapshot(version);
      cached = snap;
      validatedAt = Date.now();
      return snap;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Drop the cache so the next read refetches. Call after any write. */
export function invalidateSnapshot(): void {
  cached = null;
  validatedAt = 0;
}

/** Test seam: install a snapshot directly, bypassing the network. */
export function __setSnapshot(snap: Snapshot | null): void {
  cached = snap;
  validatedAt = snap ? Date.now() : 0;
}

/** Cache state, for the settings screen and for tests. */
export function snapshotCacheAge(): { cached: boolean; msSinceValidated: number } {
  return { cached: cached !== null, msSinceValidated: cached ? Date.now() - validatedAt : 0 };
}
