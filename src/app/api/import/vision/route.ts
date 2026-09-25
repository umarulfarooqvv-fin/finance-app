import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readReceipts, visionConfigured, type VisionImage } from '@/lib/ai/vision';
import { isAllowedImage, MAX_IMAGE_BYTES } from '@/lib/storage';
import { nowIST } from '@/lib/time';
import { describeUsage, isLimited } from '@/lib/ai/usage';
import { readAiUsage, recordAiUsage } from '@/lib/ai/usage-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   Turning freshly-picked photos into paste-rows text, in the browser tab.

   The counterpart to /api/inbox/convert, which does the same thing for a
   photo already sitting in the capture inbox. This one never touches
   storage — the images are read into memory, sent to the model, and
   discarded; nothing here is kept unless the person pastes the result and
   presses Import.
   =========================================================================== */

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  if (!visionConfigured()) {
    return bad('Photo conversion is not set up. See IMPORT_AI in .env.example.', 501);
  }

  // A limit in force: say so now rather than spend a request on a refusal.
  const now = nowIST();
  const usage = await readAiUsage();
  if (isLimited(usage, now)) return bad(describeUsage(usage, now)!.text, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return bad('Could not read the uploaded photos.');

  const files = form.getAll('file').filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length === 0) return bad('No photos were attached.');

  const images: VisionImage[] = [];
  for (const file of files) {
    const mime = (file.type || 'image/jpeg').toLowerCase();
    if (!isAllowedImage(mime)) return bad(`${mime} is not an image this app accepts.`);
    if (file.size > MAX_IMAGE_BYTES) {
      return bad(`${file.name || 'One of those photos'} is over the 20MB limit.`);
    }
    images.push({ bytes: await file.arrayBuffer(), mime });
  }

  // Uploaded now, so "now" is the best anchor for a date with no year on it.
  const result = await readReceipts(images, now.slice(0, 10));
  await recordAiUsage(result.usage);
  if (!result.ok) return bad(result.error, 502);
  return NextResponse.json({ ok: true, text: result.text });
}
