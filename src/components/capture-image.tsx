'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ===========================================================================
   An image that may be a format the browser cannot decode.

   An iPhone camera saves HEIC by default, and this app accepts it — Safari on
   iOS and macOS decodes HEIC in a plain <img> natively. Chrome and most
   desktop browsers do not, and the tag then renders nothing: no broken-image
   icon, no error a person would notice, just an empty box where a receipt
   should be. That is worse than an ugly fallback, because it looks like the
   photo never attached at all.

   `onError` catches the failed decode and swaps in a link to the same file
   instead. It cannot render HEIC either, but the browser's own "open with"
   handling can hand it to something that does — Photos, Preview, another tab
   — rather than a silent blank.
   =========================================================================== */
/**
 * The address of a capture's image.
 *
 * Versioned because the route serves with a year-long "immutable" cache, and
 * what it serves CAN change once: a HEIC stored before conversion is now sent
 * as JPEG. A browser that cached the HEIC would keep showing a blank tile for
 * a year. Bump this when the served bytes for an existing id change again.
 */
export const captureSrc = (id: string) => `/api/capture/${id}?v=2`;

export function SafeImage({
  src, alt = '', className, loading,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'flex flex-col items-center justify-center gap-1 bg-[var(--color-raised)] text-center text-[10px] leading-tight text-[var(--color-ink-3)] hover:text-[var(--color-accent)]',
          className,
        )}
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
        Can&rsquo;t preview here — open it
      </a>
    );
  }

  return <img src={src} alt={alt} className={className} loading={loading} onError={() => setFailed(true)} />;
}
