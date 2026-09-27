import 'server-only';
import { readConfigKey, writeConfigKey } from '@/lib/config';

/* ===========================================================================
   Voice notes waiting to become entries.

   A voice note from the iPhone is read into a draft — amount, card,
   category, description — and waits in the Inbox beside photos until a
   person opens it, checks it against what was heard, and adds it. It never
   becomes an entry by itself: speech is misheard ("two hundred and fifty
   for" became 254 in testing), and a misheard amount looks just like a real
   one once it is in a list of thousands.

   Only the TEXT is kept — what was heard and what was read from it. The
   recording itself is never stored.

   In app_config beside the other small lists, bounded, and removed when used
   or discarded.
   =========================================================================== */

const KEY = 'voice_drafts';
const KEEP = 30;

export type VoiceDraft = {
  id: string;
  /** When it was spoken — the moment the note arrived. */
  ts: string;
  /** 'audio' — a recording, read by the AI; 'dictation' — the iPhone's own text. */
  via: 'audio' | 'dictation';
  /** What was heard, in English (a Malayalam note arrives translated). */
  heard: string;
  amount: string | null;
  method: string | null;
  category: string | null;
  remarks: string;
  /** Fields the reader could not settle, for the form to flag. */
  uncertain: string[];
};

export async function readVoiceDrafts(): Promise<VoiceDraft[]> {
  try {
    return (await readConfigKey<VoiceDraft[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function saveVoiceDraft(draft: VoiceDraft): Promise<void> {
  const list = await readVoiceDrafts();
  await writeConfigKey(KEY, [draft, ...list.filter((d) => d.id !== draft.id)].slice(0, KEEP));
}

export async function forgetVoiceDraft(id: string): Promise<void> {
  const list = await readVoiceDrafts();
  await writeConfigKey(KEY, list.filter((d) => d.id !== id));
}

/** "₹480 · Food · Fi — tea", with the gaps named, for the Shortcut to show. */
export function summarise(d: Pick<VoiceDraft, 'amount' | 'method' | 'category' | 'remarks'>): string {
  const parts = [
    d.amount ? `₹${d.amount}` : 'amount?',
    d.category ?? 'category?',
    d.method ?? 'paid from?',
  ];
  return `${parts.join(' · ')}${d.remarks ? ` — ${d.remarks}` : ''}`;
}
