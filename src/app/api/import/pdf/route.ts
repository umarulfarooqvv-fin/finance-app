import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* ===========================================================================
   The text of a statement PDF — a Google Pay statement, a bank's.

   Text, not rows: the page runs the same parser on it as on a paste, so a PDF
   and its copied text read identically, and what was read is shown in the box
   where it can be checked. A viewer's copy of a Google Pay PDF arrives with
   every space missing ("PaidtoMuhammedFaisal"); reading the file itself keeps
   them, which is why this exists.

   Nothing is stored. The file is read in memory and dropped.
   =========================================================================== */

/** A statement is a few hundred KB; this leaves room for a long one. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return bad(auth.error, 401);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('Choose a PDF statement.');
  if (file.size > MAX_PDF_BYTES) return bad('That PDF is larger than 10 MB.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  // "%PDF" — refuse anything else before handing it to a parser.
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return bad('That file is not a PDF.');
  }

  /* A bank statement is usually locked with a password. It is used to open
     this one file, in memory, and goes nowhere else: not stored, not logged,
     not sent back. */
  const password = form?.get('password');

  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    let pdf;
    try {
      pdf = await getDocumentProxy(bytes, typeof password === 'string' && password ? { password } : {});
    } catch (err) {
      const e = err as { name?: string; code?: number };
      if (e?.name === 'PasswordException') {
        // pdf.js: code 1 = a password is needed, 2 = the one given is wrong.
        return NextResponse.json({
          ok: false,
          needsPassword: true,
          error: e.code === 2 ? 'That password did not open the PDF.' : 'This PDF is locked. Enter its password to read it.',
        }, { status: 401 });
      }
      throw err;
    }
    // Lines kept apart per page: a bank statement's rows are read line by line.
    const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
    const text = (Array.isArray(pages) ? pages : [pages]).join('\n');
    const clean = String(text ?? '').trim();
    if (!clean) {
      return bad('No text in that PDF — it may be a scanned image. Photograph it and use Choose photos instead.');
    }
    return NextResponse.json({ ok: true, text: clean, pages: totalPages });
  } catch {
    return bad('Could not read that PDF.');
  }
}
