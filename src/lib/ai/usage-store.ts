import 'server-only';
import { readConfigKey, writeConfigKey } from '@/lib/config';
import type { AiUsage } from '@/lib/ai/usage';

/* ===========================================================================
   The last allowance the provider reported, kept so the app can show it.

   In app_config beside the other small JSON the app keeps, and replaced
   whole on every read: it is a reading of a gauge, not a history, and only
   the latest one means anything. A failure to store it never fails the read
   it came from — the photo's rows matter more than the gauge.
   =========================================================================== */

const KEY = 'ai_usage';

export async function readAiUsage(): Promise<AiUsage | null> {
  try {
    return await readConfigKey<AiUsage>(KEY);
  } catch {
    return null;
  }
}

export async function recordAiUsage(usage: AiUsage | undefined): Promise<void> {
  if (!usage) return;
  try {
    await writeConfigKey(KEY, usage);
  } catch (err) {
    console.error('[ai-usage]', err instanceof Error ? err.message : err);
  }
}
