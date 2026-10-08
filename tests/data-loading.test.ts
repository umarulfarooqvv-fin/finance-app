import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countRows, selectAllParallel } from '@/lib/supabase';
import { readConfigKey } from '@/lib/config';

/* The loaders behind page speed: parallel pages for the snapshot, and one
   request for several app_config keys. Both are checked against a fake
   PostgREST so the tests say what goes over the wire, not just what comes
   back. */

type Call = { url: URL; method: string };
let calls: Call[] = [];
const original = globalThis.fetch;

function fakeStore(rows: { id: string }[], config: Record<string, string> = {}) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const table = url.pathname.split('/').pop();
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': `*/${rows.length}` } });
    }
    if (table === 'app_config') {
      const keys = (url.searchParams.get('key') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map((k) => k.replace(/"/g, ''));
      const out = keys.filter((k) => k in config).map((k) => ({ key: k, value: config[k] }));
      return new Response(JSON.stringify(out), { status: 200 });
    }
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset'));
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 });
  }) as typeof fetch;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}` }));

beforeEach(() => {
  calls = [];
  vi.stubEnv('SUPABASE_URL', 'https://example.test');
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-key');
});
afterEach(() => {
  globalThis.fetch = original;
  vi.unstubAllEnvs();
});

describe('selectAllParallel', () => {
  it('fetches every page at once when the count is known', async () => {
    const rows = ids(2655);
    fakeStore(rows);
    const n = await countRows('transactions');
    expect(n).toBe(2655);
    calls = [];
    const got = await selectAllParallel('transactions', { order: 'ts.asc,id.asc' }, n);
    expect(got).toHaveLength(2655);
    expect(new Set(got.map((r) => r.id)).size).toBe(2655);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1000', '2000']);
  });

  it('keeps going when rows were added after the count', async () => {
    fakeStore(ids(2400));
    const got = await selectAllParallel('transactions', { order: 'ts.asc,id.asc' }, 1500);
    expect(got).toHaveLength(2400);
  });

  it('still reads everything with no count at all', async () => {
    fakeStore(ids(1000));
    const got = await selectAllParallel('transactions', { order: 'ts.asc,id.asc' }, null);
    expect(got).toHaveLength(1000);
  });
});

describe('readConfigKey batching', () => {
  it('asks for keys read together in ONE request, and shares a repeated key', async () => {
    fakeStore([], { a: '{"x":1}', b: '[2]', c: '"three"' });
    const [a, b, c, a2] = await Promise.all([
      readConfigKey('a'), readConfigKey('b'), readConfigKey('c'), readConfigKey('a'),
    ]);
    expect([a, b, c, a2]).toEqual([{ x: 1 }, [2], 'three', { x: 1 }]);
    expect(calls).toHaveLength(1);
  });

  it('returns null for a key that is not there', async () => {
    fakeStore([], {});
    expect(await readConfigKey('missing')).toBeNull();
  });

  it('reads again on the next turn — nothing is cached', async () => {
    fakeStore([], { a: '1' });
    await readConfigKey('a');
    await readConfigKey('a');
    expect(calls).toHaveLength(2);
  });
});
