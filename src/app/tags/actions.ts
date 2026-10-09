'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { idsWithLabel, idsWithTag, rewriteRemarks, type RewriteResult } from '@/lib/tag-writes';
import { addTag, labelToTag, normaliseTag, removeTag, renameTag } from '@/lib/user-tags';

/* ===========================================================================
   Tagging many entries at once — from a selection on Entries, or across a
   whole tag on the Tags page. Each goes through the guarded write path, so
   it is session-checked, audited, and every money page is refreshed.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

const PATHS = [...MONEY_PATHS, '/tags', '/import'];

const needTag = (raw: string | undefined, field = 'tag') =>
  normaliseTag(raw ?? '') ? null : { [field]: 'Give the tag a name.' };

export const tagEntriesAction = guardedAction(
  {
    name: 'tag entries',
    validate: (i: { ids: string[]; tag: string; remove?: boolean }) =>
      !Array.isArray(i.ids) || i.ids.length === 0
        ? { ids: 'Choose at least one entry.' }
        : i.ids.length > 1000
          ? { ids: 'Tag at most 1,000 entries at a time.' }
          : needTag(i.tag),
    revalidate: PATHS,
  },
  async (i, ctx): Promise<RewriteResult> => {
    const tag = normaliseTag(i.tag)!;
    return rewriteRemarks(
      i.ids,
      (r) => (i.remove ? removeTag(r, tag) : addTag(r, tag)),
      ctx,
      { type: i.remove ? 'tags.remove' : 'tags.add', detail: { tag } },
    );
  },
);

export const renameTagAction = guardedAction(
  {
    name: 'rename tag',
    validate: (i: { from: string; to: string }) => needTag(i.from, 'from') ?? needTag(i.to, 'to'),
    revalidate: PATHS,
  },
  async (i, ctx): Promise<RewriteResult> => {
    const from = normaliseTag(i.from)!;
    const to = normaliseTag(i.to)!;
    return rewriteRemarks(await idsWithTag(from), (r) => renameTag(r, from, to), ctx, {
      type: 'tags.rename', detail: { from, to },
    });
  },
);

/** Takes the tag off every entry. The entries themselves are untouched. */
export const deleteTagAction = guardedAction(
  {
    name: 'remove tag',
    validate: (i: { tag: string }) => needTag(i.tag),
    revalidate: PATHS,
  },
  async (i, ctx): Promise<RewriteResult> => {
    const tag = normaliseTag(i.tag)!;
    return rewriteRemarks(await idsWithTag(tag), (r) => removeTag(r, tag), ctx, {
      type: 'tags.delete', detail: { tag },
    });
  },
);

/** "Dinner (Banglore Trip)" → "Dinner [Banglore Trip]", on every entry that has the label. */
export const labelToTagAction = guardedAction(
  {
    name: 'make a tag from a label',
    validate: (i: { label: string; tag: string }) =>
      (i.label ?? '').trim() ? needTag(i.tag) : { label: 'Which label?' },
    revalidate: PATHS,
  },
  async (i, ctx): Promise<RewriteResult> => {
    const tag = normaliseTag(i.tag)!;
    return rewriteRemarks(await idsWithLabel(i.label), (r) => labelToTag(r, i.label, tag), ctx, {
      type: 'tags.from-label', detail: { label: i.label, tag },
    });
  },
);
