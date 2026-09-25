import Link from 'next/link';
import { headers } from 'next/headers';
import { capturesReady, listCaptures } from '@/lib/captures';
import { visionConfig } from '@/lib/ai/vision';
import { readCaptureDrafts } from '@/lib/capture-drafts';
import { getSnapshot } from '@/lib/snapshot';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { nowIST } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, SectionTitle } from '@/components/ui/primitives';
import { InboxClient, type Capture } from './inbox-client';
import { ShortcutRecipe } from '@/components/shortcut-recipe';
import { recipe } from '@/lib/shortcuts';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   The capture inbox — photos waiting to become entries.

   Why this exists: the entries made days after the fact are the ones remarked
   "Unknown food" with no method, because the detail was gone by the time there
   was a minute to type it. A photo of the shop or the bill holds the detail
   until there is.

   A capture is never the entry. It is a reminder with a picture attached, and
   turning it into a transaction is a deliberate act with the ordinary form —
   nothing here writes money on its own.
   =========================================================================== */

export default async function InboxPage() {
  const ready = await capturesReady();
  const rows = ready ? await listCaptures('pending') : [];
  const vision = visionConfig();
  /* What the AI already read out of each waiting photo, mostly at the moment
     it arrived. Loaded here so the inbox opens with the rows on screen rather
     than fetching them once it is up. */
  const drafts = vision.name !== 'off' ? await readCaptureDrafts() : {};
  /* The bank's own labels ("Federal CC XX16") mapped to this ledger's names,
     so a reading fills the Paid-from field the way /import would. */
  const bankMethods = bankMethodsFrom((await getSnapshot()).config);

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';

  const captures: Capture[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    note: r.note ?? '',
    bytes: r.bytes,
    draft: drafts[r.id]?.text ?? null,
    draftError: drafts[r.id]?.error ?? null,
  }));

  return (
    <Page>
      <PageHeader
        title="Inbox"
        subtitle={
          ready
            ? `${captures.length} ${captures.length === 1 ? 'photo' : 'photos'} waiting to become entries`
            : 'Not set up yet'
        }
      />

      {!ready ? (
        <Panel>
          <SectionTitle>One migration to run first</SectionTitle>
          <p className="text-xs text-[var(--color-ink-2)]">
            The <code className="rounded bg-[var(--color-raised)] px-1 py-0.5">captures</code> table
            does not exist yet. Run{' '}
            <code className="rounded bg-[var(--color-raised)] px-1 py-0.5">
              db/migrations/002_captures.sql
            </code>{' '}
            in the Supabase SQL editor, then reload this page. The storage bucket is already
            created.
          </p>
        </Panel>
      ) : (
        <Panel padded={false}>
          <div className="p-4 sm:p-5">
            <InboxClient
              captures={captures}
              defaultTs={nowIST()}
              visionEnabled={vision.name !== 'off'}
              visionLabel={vision.label}
              bankMethods={bankMethods}
            />
          </div>
        </Panel>
      )}

      <Panel className="mt-4">
        <SectionTitle>
          Send a photo from your iPhone
          <Link href="/shortcuts" className="ml-2 text-xs font-normal text-[var(--color-accent)]">
            all Shortcuts
          </Link>
        </SectionTitle>
        <ShortcutRecipe recipe={recipe('photo')} origin={origin} />
      </Panel>
    </Page>
  );
}
