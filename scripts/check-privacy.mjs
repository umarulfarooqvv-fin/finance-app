#!/usr/bin/env node
/* ===========================================================================
   Build gate: money must reach the screen through <Money> or <Private>.

   Privacy mode is only a single switch if every amount goes through one
   component. The moment a page formats a figure itself, that figure stays
   visible when everything around it is blurred — and nobody notices until
   they are already sharing their screen.

   So this fails the build when a component renders a formatted money value
   outside the choke point. The blueprint's lesson: make a dangerous omission
   impossible by construction rather than remembered by luck.

   Run: npm run check:privacy   (also runs as part of `npm run build`)
   =========================================================================== */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const files = globSync('src/**/*.{ts,tsx}');

/** `{money(...)}` or `{amount(...)}` rendered directly into JSX. */
const RENDERED_MONEY = /\{\s*(?:money|amount|moneyCompact)\s*\(/;

/** Evidence that the value is inside the choke point. */
const GUARDED = /\bsensitive\b|<Private\b|<Money\b/;

/* A guard often sits on a wrapping element a line or two above, e.g.
     <span className="sensitive">
       {money(total)}
     </span>
   so the check looks at a small window rather than the single line. This is a
   heuristic, not a parser: it can be fooled by a guard that happens to sit
   nearby without enclosing the value. It is a build gate meant to catch the
   common omission, and it is deliberately noisy rather than silent. */
const WINDOW = 2;

/* Files allowed to format money directly, with the reason each is exempt. */
const ALLOWED = new Map([
  ['src/lib/format.ts', 'defines the formatters'],
  ['src/components/ui/primitives.tsx', 'defines <Money>, the choke point'],
  ['src/lib/ai/tools.ts', 'server-side JSON for the model, never rendered'],
  /* A notification body, not a render — there is no DOM to blur. The figure
     is included only when ReminderSettings.showAmounts is on, which is off by
     default precisely because a lock screen cannot be blurred. */
  ['src/lib/push.ts', 'notification payload, gated on showAmounts'],
]);

const problems = [];

for (const file of files) {
  const rel = file.replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;

  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    if (!RENDERED_MONEY.test(line)) return;
    // Inside an aria-label or title the value is not visible on screen, so it
    // is not a privacy leak — and a screen reader user is not the threat here.
    if (/aria-label|title=|placeholder|alt=/.test(line)) return;

    const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join('\n');
    if (GUARDED.test(near)) return;

    problems.push(`${rel}:${i + 1}\n    ${line.trim()}`);
  });
}

if (problems.length) {
  console.error('\nPrivacy check FAILED — money rendered outside <Money>/<Private>:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('Wrap the value in <Money> (preferred) or <Private>, or add a');
  console.error('documented exemption in scripts/check-privacy.mjs.\n');
  process.exit(1);
}

console.log(`Privacy check passed — ${files.length} files, no unguarded money rendering.`);
