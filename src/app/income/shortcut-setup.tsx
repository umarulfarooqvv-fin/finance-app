'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/* ===========================================================================
   How to post income from the iPhone Shortcut.

   THE TOKEN IS NEVER RENDERED. INGEST_TOKEN is a server secret; printing it
   here would put it in the page source, in any screenshot of this screen, and
   in the RSC payload. The instructions name the header it goes in and leave
   the value to be pasted from wherever it is kept.

   The origin is resolved on the SERVER from the request's own Host header, so
   it is right on localhost and on the deployed domain with nothing to
   configure. Reading window.location here instead rendered an empty string on
   the server and the real origin on the client, which is a hydration
   mismatch — React discards the server HTML and re-renders the whole subtree.
   =========================================================================== */

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[11px] whitespace-nowrap">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
              () => undefined,
            );
          }}
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-[var(--color-pos)]" aria-hidden="true" />
            : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

export function ShortcutSetup({ origin }: { origin: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--color-ink-2)]">
        The same endpoint the Daily Spent Shortcut already uses. Adding{' '}
        <code className="rounded bg-[var(--color-raised)] px-1 py-0.5 text-[11px]">type=income</code>{' '}
        files the entry as money coming in rather than going out.
      </p>

      <Copyable label="URL" value={`${origin}/api/entry`} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Method &amp; headers
          </span>
          <ul className="flex flex-col gap-0.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-[11px]">
            <li><code>POST</code></li>
            <li><code>Content-Type: application/json</code></li>
            <li><code>x-token: &lt;your INGEST_TOKEN&gt;</code></li>
          </ul>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Fields
          </span>
          <ul className="flex flex-col gap-0.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-[11px]">
            <li><code>type</code> — <span className="text-[var(--color-ink-3)]">income</span></li>
            <li><code>amount</code> — <span className="text-[var(--color-ink-3)]">required</span></li>
            <li><code>source</code> — <span className="text-[var(--color-ink-3)]">Salary, Freelance…</span></li>
            <li><code>account</code> — <span className="text-[var(--color-ink-3)]">Fi, Jupiter, None…</span></li>
            <li><code>remarks</code> — <span className="text-[var(--color-ink-3)]">optional</span></li>
            <li><code>ts</code> — <span className="text-[var(--color-ink-3)]">optional, YYYY-MM-DDTHH:MM:SS</span></li>
          </ul>
        </div>
      </div>

      <Copyable
        label="Example body"
        value='{"type":"income","amount":"45000","source":"Salary","account":"Fi","remarks":"March Salary"}'
      />

      <p className="text-[11px] text-[var(--color-ink-3)]">
        Put the token in the <code>x-token</code> header, not in the URL — query strings are recorded
        in server request logs. <code>category</code> and <code>method</code> are accepted as aliases
        for <code>source</code> and <code>account</code>, so one Shortcut can post both kinds with
        the same field names. Leave <code>ts</code> out and the server clock is used; posting the
        same entry twice updates the first rather than recording a second.
      </p>
    </div>
  );
}
