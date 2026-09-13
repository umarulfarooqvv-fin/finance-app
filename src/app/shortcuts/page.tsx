import { headers } from 'next/headers';
import { RECIPES } from '@/lib/shortcuts';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, SectionTitle } from '@/components/ui/primitives';
import { ShortcutRecipe } from '@/components/shortcut-recipe';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Every way the phone can put something into this app, in one place.

   Three Shortcuts, three jobs: a spend, money coming in, and a photo for when
   there is no time to type anything at all. They share one endpoint shape and
   one token, so building the second is mostly copying the first.

   The recipes come from lib/shortcuts.ts rather than being written out here,
   because they are also shown on the page each endpoint belongs to, and prose
   duplicated in two places drifts — the income panel documented a `ts` field
   the spending endpoint did not accept.
   =========================================================================== */

export default async function ShortcutsPage() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';

  return (
    <Page>
      <PageHeader
        title="iPhone Shortcuts"
        subtitle="Three ways to get something in without opening the app"
      />

      <Panel className="mb-4">
        <SectionTitle>Before you start</SectionTitle>
        <p className="text-xs text-[var(--color-ink-2)]">
          All three send the same header:{' '}
          <code className="rounded bg-[var(--color-raised)] px-1 py-0.5 text-[11px]">x-token</code>,
          set to your <code className="rounded bg-[var(--color-raised)] px-1 py-0.5 text-[11px]">INGEST_TOKEN</code>.
          It is in <code className="rounded bg-[var(--color-raised)] px-1 py-0.5 text-[11px]">.env.local</code>{' '}
          on your machine and in the Vercel project&rsquo;s environment variables. It is deliberately
          not shown here — printing a server secret onto a page puts it in the page source and in
          every screenshot of it.
        </p>
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          Put the token in the header, never in the URL: query strings are recorded in server
          request logs. These endpoints sit outside the app&rsquo;s PIN because each one checks this
          token instead.
        </p>
      </Panel>

      {RECIPES.map((r) => (
        <Panel key={r.slug} className="mb-4">
          <SectionTitle>{r.title}</SectionTitle>
          <ShortcutRecipe recipe={r} origin={origin} />
        </Panel>
      ))}

      <Panel>
        <SectionTitle>If something does not arrive</SectionTitle>
        <ul className="flex flex-col gap-1.5 text-[11px] text-[var(--color-ink-3)]">
          <li>
            The response says what went wrong in plain words. Add a{' '}
            <strong>Show Result</strong> action after Get Contents of URL while you are building the
            Shortcut, and remove it once it works.
          </li>
          <li>
            <code>Unauthorized</code> means the token is wrong or missing. It is the{' '}
            <code>x-token</code> header, not a URL parameter.
          </li>
          <li>
            A spend needs <code>amount</code>, <code>method</code> and <code>category</code>; income
            also needs <code>type</code> set to <code>income</code>. Anything it cannot classify is
            still saved and flagged for review rather than refused.
          </li>
        </ul>
      </Panel>
    </Page>
  );
}
