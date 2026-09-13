'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Recipe } from '@/lib/shortcuts';
import { Button } from '@/components/ui/button';

/* ===========================================================================
   One Shortcut recipe, rendered.

   Used by the Shortcuts page and by the panel on whichever page the endpoint
   belongs to, from a single definition in lib/shortcuts.ts — the prose used to
   be written out twice and had already drifted.

   THE TOKEN IS NEVER RENDERED. It is named as the header to fill in, and where
   to find it is said in words. Printing it would put a server secret into the
   page source, the RSC payload, and any screenshot of this screen.
   =========================================================================== */

export function Copyable({ label, value }: { label: string; value: string }) {
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

export function ShortcutRecipe({ recipe, origin }: { recipe: Recipe; origin: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--color-ink-2)]">{recipe.why}</p>

      <ol className="flex flex-col gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
        {recipe.steps.map((s, i) => (
          <li key={s.action + String(i)} className="flex gap-2.5 text-[11px]">
            <span className="num shrink-0 text-[var(--color-ink-3)]">{i + 1}.</span>
            <span className="min-w-0">
              <strong className="font-medium">{s.action}</strong>
              <span className="text-[var(--color-ink-3)]"> — {s.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <Copyable label="URL" value={`${origin}${recipe.path}`} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Method &amp; headers
          </span>
          <ul className="flex flex-col gap-0.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-[11px]">
            <li><code>POST</code></li>
            <li><code>Content-Type: {recipe.contentType}</code></li>
            <li><code>x-token: &lt;your INGEST_TOKEN&gt;</code></li>
          </ul>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Fields
          </span>
          <ul className="flex flex-col gap-0.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-[11px]">
            {recipe.fields.map((f) => (
              <li key={f.name}>
                <code>{f.name}</code>
                {f.required ? null : <span className="text-[var(--color-ink-3)]"> (optional)</span>}
                <span className="text-[var(--color-ink-3)]"> — {f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {recipe.example ? <Copyable label="Example body" value={recipe.example} /> : null}

      <ul className="flex flex-col gap-1.5">
        {recipe.notes.map((n) => (
          <li key={n} className="flex gap-2 text-[11px] text-[var(--color-ink-3)]">
            <span aria-hidden="true">·</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
