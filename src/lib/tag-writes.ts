import 'server-only';
import type { Actor } from '@/lib/auth';
import { classify } from '@/lib/classify';
import { logEvent, select, update } from '@/lib/supabase';
import { MAX_REMARKS } from '@/lib/validation';
import { hasTag, splitTags } from '@/lib/user-tags';
import type { TablesInsert } from '@/types/database';

/* ===========================================================================
   Changing the tags on many entries at once.

   A tag lives inside the remarks (lib/user-tags), so every tag operation is a
   rewrite of remarks. Each row is read FRESH from the database rather than
   from the snapshot: the snapshot holds the remarks with the tags already
   split off, and writing that back would erase every other tag on the row.

   Only the remarks change. The amount, method, category and date do not, so
   an entry that was matched against a bank statement stays matched — a tag
   says what an expense was FOR, not what it was.
   =========================================================================== */

type Row = { id: string; remarks: string | null; method: string | null; category: string | null; deleted: boolean };

/** Rows by id, in batches small enough for a URL. */
async function rowsById(ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    const list = batch.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    out.push(...(await select('transactions', {
      filters: { id: `in.(${list})` },
      select: 'id,remarks,method,category,deleted',
    })) as Row[]);
  }
  return out;
}

/** Every live entry carrying this tag, however it was cased. */
export async function idsWithTag(tag: string): Promise<string[]> {
  const rows = (await select('transactions', {
    filters: { remarks: 'like.*[*', deleted: 'eq.false' },
    select: 'id,remarks',
  })) as { id: string; remarks: string | null }[];
  return rows.filter((r) => hasTag(r.remarks ?? '', tag)).map((r) => r.id);
}

/** Every live entry whose remarks mention this round-bracket label. */
export async function idsWithLabel(label: string): Promise<string[]> {
  const rows = (await select('transactions', {
    filters: { remarks: 'like.*(*', deleted: 'eq.false' },
    select: 'id,remarks',
  })) as { id: string; remarks: string | null }[];
  const want = label.trim().toLowerCase();
  return rows
    .filter((r) => [...(r.remarks ?? '').matchAll(/\(([^()]*)\)/g)].some((m) => (m[1] ?? '').trim().toLowerCase() === want))
    .map((r) => r.id);
}

export type RewriteResult = { changed: number; unchanged: number; tooLong: number };

/**
 * Apply `next` to the remarks of each entry and save the ones that changed.
 * A row whose remarks would pass the length limit is left alone and counted,
 * never cut short.
 */
export async function rewriteRemarks(
  ids: string[],
  next: (remarks: string) => string,
  ctx: Actor,
  event: { type: string; detail: Record<string, unknown> },
): Promise<RewriteResult> {
  const rows = await rowsById([...new Set(ids)]);
  const result: RewriteResult = { changed: 0, unchanged: 0, tooLong: 0 };
  const changedIds: string[] = [];

  const todo = rows.filter((r) => !r.deleted);
  // A few at a time: fast for a trip's worth of entries, gentle on the API.
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (r) => {
      const before = r.remarks ?? '';
      const after = next(before);
      if (after === before) { result.unchanged++; return; }
      if (after.length > MAX_REMARKS) { result.tooLong++; return; }

      // Derived columns kept in step, from the words alone (as on load).
      const cls = classify({ method: r.method ?? '', category: r.category ?? '', remarks: splitTags(after).text });
      await update('transactions', { id: `eq.${r.id}` }, {
        remarks: after,
        kind: cls.kind,
        card_affected: cls.cardAffected,
        card_direction: cls.cardDirection,
        tags: cls.tags as TablesInsert<'transactions'>['tags'],
        needs_review: cls.kind === 'unknown',
        updated_by: ctx.actor,
      });
      result.changed++;
      changedIds.push(r.id);
    }));
  }

  await logEvent(event.type, { ...event.detail, ...result, ids: changedIds, by: ctx.actor, via: ctx.via });
  return result;
}
