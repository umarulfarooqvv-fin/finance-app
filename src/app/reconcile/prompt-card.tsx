'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { EXAMPLE, STATEMENT_PROMPT } from '@/lib/statement-prompt';
import { Button } from '@/components/ui/button';

/* ===========================================================================
   The way in when the statement is a picture.

   The paste box below takes text. A bank app on a phone often gives a
   screenshot, or a PDF that will not select. An assistant can read either —
   it just has to be told the shape to hand back, and told not to be helpful
   in the ways that ruin financial data.

   So the prompt is offered right where the dead end is met, one tap from the
   clipboard. It is folded away by default because most pastes need nothing:
   the reader who already has text should not have to scroll past a wall of
   instructions to reach the box.

   The text itself lives in lib/statement-prompt, which a test feeds through
   the real parser, so what this hands out cannot drift from what the box
   below will accept.
   =========================================================================== */

export function StatementPromptCard() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(STATEMENT_PROMPT).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => undefined,
    );
  };

  return (
    <details className="mb-3 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--color-ink-2)] marker:text-[var(--color-ink-3)]">
        Only have a screenshot or a PDF? Use this prompt
      </summary>

      <div className="flex flex-col gap-2 border-t border-[var(--color-line)] px-3 py-3">
        <p className="text-[11px] text-[var(--color-ink-3)]">
          Copy this, send it to an assistant along with the statement image or PDF, then paste the
          reply into the box below. It asks for the summary box as well as the rows, so the totals
          can be checked against what you have recorded.
        </p>

        <div className="flex items-start gap-2">
          {/* Capped, because the whole point is to copy it rather than read
              it — and an uncapped block pushes the worked example, and the
              caution under it, off the bottom of the screen. */}
          <pre className="max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-2)]">
            {STATEMENT_PROMPT}
          </pre>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Copy the prompt"
            onClick={copy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-pos)]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>

        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
          What comes back looks like
        </span>
        <pre className="overflow-x-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-3)]">
          {EXAMPLE}
        </pre>

        <p className="text-[11px] text-[var(--color-ink-3)]">
          Read it before pasting. An assistant can misread a figure, so the rows are checked against
          the summary&rsquo;s own total here — but a line it invented outright is still yours to
          catch.
        </p>
      </div>
    </details>
  );
}
