import Link from 'next/link';
import { headers } from 'next/headers';
import { listCaptures } from '@/lib/captures';
import { visionConfig } from '@/lib/ai/vision';
import { readCaptureDrafts, type CaptureDrafts } from '@/lib/capture-drafts';
import { getSnapshot } from '@/lib/snapshot';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { describeUsage } from '@/lib/ai/usage';
import { readAiUsage } from '@/lib/ai/usage-store';
import { nowIST } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, SectionTitle } from '@/components/ui/primitives';
import { InboxClient, type Capture } from './inbox-client';
import { VoiceDrafts } from './voice-drafts';
import { readVoiceDrafts } from '@/lib/voice-drafts';
import { ShortcutRecipe } from '@/components/shortcut-recipe';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
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
  const vision = visionConfig();
  const reading = vision.name !== 'off';
  /* Everything the inbox needs, fetched at once — these were five round-trips
     in a row. The three app_config reads go out as ONE request (see
     lib/config), and listCaptures answering is itself the proof the captures
     table exists, so the separate probe is gone. */
  const [rows, drafts, snap, usage, voices] = await Promise.all([
    listCaptures('pending').catch(() => null),
    /* What the AI already read out of each waiting photo, mostly at the
       moment it arrived — so the inbox opens with the rows on screen. */
    reading ? readCaptureDrafts() : Promise.resolve<CaptureDrafts>({}),
    getSnapshot(),
    // How much of the provider's allowance is left, as of its last reply.
    reading ? readAiUsage() : Promise.resolve(null),
    readVoiceDrafts(),
  ]);
  const ready = rows !== null;
  /* The bank's own labels ("Federal CC XX16") mapped to this ledger's names,
     so a reading fills the Paid-from field the way /import would. */
  const bankMethods = bankMethodsFrom(snap.config);
  const aiUsage = reading ? describeUsage(usage, nowIST()) : null;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';

  const captures: Capture[] = (rows ?? []).map((r) => ({
    id: r.id,
    ts: r.ts,
    note: r.note ?? '',
    bytes: r.bytes,
    draft: drafts[r.id]?.text ?? null,
    draftError: drafts[r.id]?.error ?? null,
  }));

  const waiting = [
    voices.length ? `${voices.length} voice ${voices.length === 1 ? 'note' : 'notes'}` : '',
    captures.length || !voices.length ? `${captures.length} ${captures.length === 1 ? 'photo' : 'photos'}` : '',
  ].filter(Boolean).join(' and ');

  return (
    <Page>
      <PageHeader
        title="Inbox"
        subtitle={ready ? `${waiting} waiting to become entries` : 'Not set up yet'}
      />

      <VoiceDrafts drafts={voices} />

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
      ) : captures.length === 0 && voices.length > 0 ? null : (
        <Panel padded={false}>
          <div className="p-4 sm:p-5">
            <InboxClient
              captures={captures}
              defaultTs={nowIST()}
              visionEnabled={vision.name !== 'off'}
              visionLabel={vision.label}
              bankMethods={bankMethods}
              aiUsage={aiUsage}
            />
          </div>
        </Panel>
      )}

      {/* Setup instructions, read once — folded by default, remembered. */}
      <CollapsiblePanel
        id="inbox-shortcut"
        className="mt-4"
        title="Send a photo from your iPhone"
        action={
          <Link href="/shortcuts" className="text-xs font-normal text-[var(--color-accent)]">
              all Shortcuts
            </Link>
        }
      >
        <ShortcutRecipe recipe={recipe('photo')} origin={origin} />
      </CollapsiblePanel>
    </Page>
  );
}
