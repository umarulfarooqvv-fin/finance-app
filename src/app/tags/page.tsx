import { getSnapshot } from '@/lib/snapshot';
import { labelSuggestions, tagSummaries } from '@/lib/tag-summary';
import { tagKey } from '@/lib/user-tags';
import { Page, PageHeader } from '@/components/layout/page-header';
import { TagsClient } from './tags-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Every tag, and what each occasion cost.

   Tags are made where entries are written — the entry form, a selection on
   Entries, Import, or "[Tag]" typed in the Shortcut's remarks. This page is
   where they are looked at as a whole: totals, the span of days, which
   categories the money went to, and housekeeping (rename, remove).
   =========================================================================== */

export default async function TagsPage() {
  const snap = await getSnapshot();
  const tags = tagSummaries(snap);
  const listed = new Set(tags.filter((t) => t.stored > 0).map((t) => tagKey(t.tag)));
  // A label already shown as an old-style tag is offered there, not twice.
  const shownLegacy = new Set(tags.filter((t) => t.stored === 0).map((t) => tagKey(t.tag)));
  const suggestions = labelSuggestions(snap).filter(
    (s) => !listed.has(tagKey(s.label)) && !shownLegacy.has(tagKey(s.label)),
  );

  return (
    <Page>
      <PageHeader
        title="Tags"
        subtitle={listed.size
          ? `${listed.size} ${listed.size === 1 ? 'tag' : 'tags'} · trips, occasions, anything that cuts across categories`
          : 'Trips, occasions, anything that cuts across categories'}
      />
      <TagsClient tags={tags} suggestions={suggestions} />
    </Page>
  );
}
