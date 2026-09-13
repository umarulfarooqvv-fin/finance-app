'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/* ===========================================================================
   Building the Shortcut, in the fewest steps that work.

   THE TOKEN IS NEVER RENDERED. INGEST_TOKEN is a server secret; printing it
   would put it in the page source, in the RSC payload, and in any screenshot
   of this screen.

   The recommended shape posts the photo as the raw request body, because that
   is the one Shortcuts action that needs no fiddling: pick the photo, set the
   body to File, done. The endpoint also accepts multipart and base64 for
   anyone who already has a Shortcut built the other way.
   =========================================================================== */

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[11px]">
          {value}
        </code>
        <Button
          type="button" variant="ghost" size="icon" aria-label={`Copy ${label}`}
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

const STEPS = [
  ['Take Photo', 'or Select Photos, if you are sending one you already took'],
  ['Get Contents of URL', 'the action below does the work'],
  ['Method', 'POST'],
  ['Headers', 'x-token — your INGEST_TOKEN, and Content-Type — image/jpeg'],
  ['Request Body', 'File, then pick the Photo from the first step'],
];

export function CaptureSetup({ origin }: { origin: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--color-ink-2)]">
        Five actions in the Shortcuts app. Add it to the home screen or the Action Button and a
        photo of the shop or the bill lands here in one tap — to be turned into an entry when there
        is time.
      </p>

      <Copyable label="URL" value={`${origin}/api/capture`} />

      <ol className="flex flex-col gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
        {STEPS.map(([name, detail], i) => (
          <li key={name} className="flex gap-2.5 text-[11px]">
            <span className="num shrink-0 text-[var(--color-ink-3)]">{i + 1}.</span>
            <span className="min-w-0">
              <strong className="font-medium">{name}</strong>
              <span className="text-[var(--color-ink-3)]"> — {detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-[var(--color-ink-3)]">
        Optional: add <code>?note=...</code> to the URL to attach a line of text, or{' '}
        <code>?ts=YYYY-MM-DDTHH:MM:SS</code> to say when the photo was taken. Without a{' '}
        <code>ts</code> the server&rsquo;s clock is used. The same photo sent twice is one capture,
        not two — the id is derived from the image itself, so a retry over a bad connection cannot
        fill the inbox with duplicates.
      </p>

      <p className="text-[11px] text-[var(--color-ink-3)]">
        Photos are stored privately and are only ever served back through this app while you are
        signed in. They are never made public, and nothing reads them automatically — the amount on
        a bill is typed by you, not guessed from the picture.
      </p>
    </div>
  );
}
