import 'server-only';

/* ===========================================================================
   HEIC in, JPEG out — once, when a photo arrives.

   An iPhone camera writes HEIC, and so do Shortcuts that resize a photo
   without an explicit "Convert Image to JPEG". Two things cannot open it: the
   vision model (Groq: "400 invalid image data") and every desktop browser but
   Safari, which shows a blank tile. Asking a person to rebuild a Shortcut to
   fix a file format is asking them to do the computer's job, and it failed
   twice in practice.

   So it is converted on the way in and STORED as JPEG — once, instead of on
   every view and every read. `heic-convert` decodes with libheif compiled to
   WebAssembly and embedded in the package, so there is no native binary and
   no .wasm file for a bundler to lose; about 0.2s for a phone screenshot.
   (sharp is in node_modules through Next, but its libheif has no HEVC
   decoder: "Input buffer has corrupt header" on a real iPhone file.)

   A photo that cannot be converted is kept exactly as it came. Losing a
   receipt over its file format would be the worse outcome by far.
   =========================================================================== */

export const isHeic = (mime: string) => mime === 'image/heic' || mime === 'image/heif';

export async function heicToJpeg(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: convert } = await import('heic-convert');
  const out = await convert({ buffer: Buffer.from(bytes), format: 'JPEG', quality: 0.85 });
  const view = out instanceof Uint8Array ? out : new Uint8Array(out);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** The bytes and type to store: JPEG where the original was HEIC. */
export async function toStorable(
  bytes: ArrayBuffer,
  mime: string,
): Promise<{ bytes: ArrayBuffer; mime: string; converted: boolean }> {
  if (!isHeic(mime)) return { bytes, mime, converted: false };
  try {
    return { bytes: await heicToJpeg(bytes), mime: 'image/jpeg', converted: true };
  } catch (err) {
    console.error('[heic]', err instanceof Error ? err.message : err);
    return { bytes, mime, converted: false };
  }
}
