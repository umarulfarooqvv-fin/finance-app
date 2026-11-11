import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from './helpers';
import type { Snapshot, Transaction } from '@/lib/types';

/* The writing half of adding drafts without being asked. The rules are tested
   in draft-entries.test.ts; this checks what is done with their answer —
   against a database that is a few objects in memory. */

const db = vi.hoisted(() => ({
  captures: [] as { id: string; ts: string; bytes: number }[],
  readings: {} as Record<string, { text?: string; hidden?: string[]; added?: { raw: string; tx: string }[] }>,
  config: {} as Record<string, unknown>,
  snap: null as unknown,
  created: [] as { id: string; input: Record<string, unknown>; source: string }[],
  used: [] as { capture: string; tx: string }[],
  failOn: '' as string,
}));

vi.mock('@/lib/captures', () => ({
  listCaptures: async () => db.captures,
  markUsed: async (capture: string, tx: string) => { db.used.push({ capture, tx }); },
}));
vi.mock('@/lib/capture-places', () => ({ readCapturePlaces: async () => ({}) }));
vi.mock('@/lib/places', () => ({ placeFromPhoto: async () => {} }));
vi.mock('@/lib/snapshot', () => ({
  getSnapshot: async () => db.snap,
  invalidateSnapshot: () => {},
}));
vi.mock('@/lib/config', () => ({
  readConfigKey: async (k: string) => (k === 'capture_drafts' ? db.readings : db.config[k] ?? null),
  writeConfigKey: async (k: string, v: unknown) => { db.config[k] = v; },
  updateConfigKey: async (k: string, mutate: (c: unknown) => unknown) => {
    if (k !== 'capture_drafts') throw new Error(`unexpected key ${k}`);
    db.readings = mutate(db.readings) as typeof db.readings;
    return db.readings;
  },
}));
vi.mock('@/lib/transactions', async (original) => {
  const real = await original<typeof import('@/lib/transactions')>();
  return {
    idFromKey: real.idFromKey,
    createTransaction: async (input: Record<string, unknown> & { clientKey: string }, _ctx: unknown, source: string) => {
      if (db.failOn && String(input['remarks']).includes(db.failOn)) throw new Error('database said no');
      const id = await real.idFromKey(input.clientKey);
      const again = db.created.some((c) => c.id === id);
      if (!again) db.created.push({ id, input, source });
      return { id, duplicate: again };
    },
  };
});

const { autoAddDrafts, draftKey, photoEntries } = await import('@/lib/draft-auto');
const { idFromKey } = await import('@/lib/transactions');

const CTX = { actor: 'photo-auto', via: 'ingest-token' } as const;
const NOW = '2026-11-10T21:55:00';

const bakery = '10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery Coolbar';
const suhail = '10/11/2026 15:22 | 2800 | Fi |  | Muhammed Suhail';
const tea = '10/11/2026 16:00 | 40 | Scapia | Food | Tea';

const entry = (over: Partial<Transaction>): Transaction => ({
  id: 'e1', ts: '2026-11-10T21:52:30', amount: 202, method: 'Scapia', category: 'Food', remarks: 'Bakery',
  userTags: [], kind: 'spend', cardAffected: 'Scapia', cardDirection: 'debt+', tags: {}, verified: false,
  needsReview: false, deleted: false, source: 'shortcut', ...over,
} as Transaction);

function world(photos: Record<string, string>, transactions: Transaction[] = []) {
  db.captures = Object.keys(photos).map((id) => ({ id, ts: NOW, bytes: 1 }));
  db.readings = Object.fromEntries(Object.entries(photos).map(([id, text]) => [id, { text }]));
  db.config = {};
  db.snap = makeSnapshot({ transactions }) as Snapshot;
  db.created = [];
  db.used = [];
  db.failOn = '';
}

beforeEach(() => { delete process.env.PHOTO_AUTO_ADD; });

describe('adding drafts without being asked — the writes', () => {
  it('adds what the rules allow, marked as from a photo, and retires the photo', async () => {
    world({ p1: bakery });
    expect(await autoAddDrafts(CTX)).toEqual({ added: 1, left: 0 });

    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({
      source: 'photo',
      input: { amount: 202, method: 'Scapia', category: 'Food', remarks: 'K K Bakery Coolbar', ts: '2026-11-10T21:51:00' },
    });
    // Nothing left to read on the photo: it leaves the inbox, linked to its entry.
    expect(db.used).toEqual([{ capture: 'p1', tx: db.created[0]!.id }]);
    expect(db.readings['p1']).toBeUndefined();
    // And it is on the list a person is shown.
    expect(db.config['photo_auto']).toMatchObject([{ tx: db.created[0]!.id }]);
  });

  it('adds a row with no category as it is — to be asked for, not waited for', async () => {
    world({ p1: suhail });
    await autoAddDrafts(CTX);
    expect(db.created[0]!.input).toMatchObject({ amount: 2800, method: 'Fi', category: '' });
  });

  it('never adds a payment already on file, and leaves its photo waiting for the answer', async () => {
    world({ p1: bakery }, [entry({})]);
    expect(await autoAddDrafts(CTX)).toEqual({ added: 0, left: 0 });
    expect(db.created).toEqual([]);
    expect(db.used).toEqual([]);
    expect(db.readings['p1']!.text).toBe(bakery);
  });

  it('a photo with one row added and one held stays in the inbox with the held row', async () => {
    // ₹40 was already logged that day on another card: a question, not an entry.
    world({ p1: `${bakery}\n${tea}` }, [entry({ id: 'e9', amount: 40, method: 'Fi', ts: '2026-11-10T11:00:00', remarks: 'Snack' })]);
    await autoAddDrafts(CTX);
    expect(db.created).toHaveLength(1);
    expect(db.used).toEqual([]);
    expect(db.readings['p1']!.text).toBe(tea);
    expect(db.readings['p1']!.added).toEqual([{ raw: bakery, tx: db.created[0]!.id }]);
  });

  it('works through a backlog a few at a time, and running it twice adds nothing twice', async () => {
    world({ p1: bakery, p2: suhail });
    expect(await autoAddDrafts(CTX, 1)).toEqual({ added: 1, left: 1 });
    // The first is now in the ledger, as the next pass will find it.
    const first = db.created[0]!;
    (db.snap as Snapshot).transactions.push(entry({ id: first.id, ts: String(first.input['ts']), amount: Number(first.input['amount']), method: 'Fi', category: '', remarks: 'Muhammed Suhail', source: 'photo' }));
    expect(await autoAddDrafts(CTX, 1)).toEqual({ added: 1, left: 0 });
    expect(await autoAddDrafts(CTX, 1)).toEqual({ added: 0, left: 0 });
    expect(db.created).toHaveLength(2);
  });

  it('a row whose entry already exists is put away, not called its own duplicate', async () => {
    // A pass that saved the entry and was cut short before cutting the row.
    const id = await idFromKey(draftKey('p1', bakery));
    world({ p1: bakery }, [entry({ id, ts: '2026-11-10T21:51:00', source: 'photo' })]);
    expect(await autoAddDrafts(CTX)).toEqual({ added: 0, left: 0 });
    expect(db.created).toEqual([]);
    expect(db.used).toEqual([{ capture: 'p1', tx: id }]);
  });

  it('one row failing costs that row only', async () => {
    world({ p1: bakery, p2: suhail });
    db.failOn = 'Bakery';
    expect(await autoAddDrafts(CTX)).toEqual({ added: 1, left: 0 });
    expect(db.readings['p1']!.text).toBe(bakery);
    expect(db.used.map((u) => u.capture)).toEqual(['p2']);
  });

  it('PHOTO_AUTO_ADD=off adds nothing', async () => {
    world({ p1: bakery });
    process.env.PHOTO_AUTO_ADD = 'off';
    expect(await autoAddDrafts(CTX)).toEqual({ added: 0, left: 0 });
    expect(db.created).toEqual([]);
  });

  it('shows what was added, and keeps asking for a missing detail after "OK"', () => {
    const snap = makeSnapshot({
      transactions: [
        entry({ id: 'a', source: 'photo', category: '' }),
        entry({ id: 'b', source: 'photo' }),
        entry({ id: 'c', source: 'photo', deleted: true }),
      ],
    });
    const fresh = photoEntries(snap, [{ tx: 'a', at: NOW }, { tx: 'b', at: NOW }, { tx: 'c', at: NOW }]);
    expect(fresh.needs.map((r) => r.id)).toEqual(['a']);
    expect(fresh.added.map((r) => r.id)).toEqual(['b']);
    expect(fresh.unseen).toBe(2);

    const acknowledged = photoEntries(snap, []);
    expect(acknowledged.needs.map((r) => r.id)).toEqual(['a']);
    expect(acknowledged.unseen).toBe(0);
  });
});
