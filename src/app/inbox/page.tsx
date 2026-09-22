import Link from 'next/link';
import { headers } from 'next/headers';
import { capturesReady, listCaptures } from '@/lib/captures';
import { visionConfig } from '@/lib/ai/vision';
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

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';

  const captures: Capture[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    note: r.note ?? '',
    bytes: r.bytes,
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
