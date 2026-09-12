'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/* ===========================================================================
   Speak an entry.

   Transcription happens ON THE DEVICE, through the browser's speech API. No
   audio is uploaded, recorded or stored anywhere — only the resulting text is
   sent to be parsed. That is worth knowing for an app that holds a complete
   record of someone's spending.

   The result is always a draft the user confirms. Speech recognition mishears
   numbers in particular ("fifty" and "fifteen" are a coin flip on a noisy
   street), so nothing here writes a transaction.

   Support is uneven — Safari and Chrome implement this behind the webkit
   prefix, Firefox does not implement it at all — so the control hides itself
   entirely where it would not work, rather than offering a button that fails.
   Typing remains the primary path; this is a shortcut, never the only way in.
   =========================================================================== */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceInputProps = {
  /** Called with the final transcript once the user stops speaking. */
  onTranscript: (transcript: string) => void;
  /** True while the parent is parsing, so the button shows progress. */
  parsing?: boolean;
  disabled?: boolean;
};

export function VoiceInput({ onTranscript, parsing, disabled }: VoiceInputProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Feature detection runs after mount: `window` does not exist during the
  // server render, and rendering a button that then disappears would be worse
  // than not rendering one.
  useEffect(() => {
    setSupported(speechCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;

    setError(null);
    setHeard('');

    const rec = new Ctor();
    // Indian English: the recogniser handles rupee amounts and local place
    // names far better under en-IN than under en-US.
    rec.lang = 'en-IN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) text += alt.transcript;
      }
      setHeard(text);
    };

    rec.onerror = (e) => {
      setListening(false);
      setError(
        e.error === 'not-allowed'
          ? 'Microphone access was refused. Allow it in your browser settings, or type the entry.'
          : e.error === 'no-speech'
            ? 'Nothing was heard. Try again, closer to the microphone.'
            : 'Speech recognition failed. Type the entry instead.',
      );
    };

    rec.onend = () => {
      setListening(false);
      // `heard` is read from state at the moment recognition ends, which is
      // after the last onresult has run.
      setHeard((final) => {
        if (final.trim()) onTranscript(final.trim());
        return final;
      });
    };

    recognition.current = rec;
    setListening(true);
    rec.start();
  }, [onTranscript]);

  // Never leave the microphone open behind a closed dialog.
  useEffect(() => () => recognition.current?.abort(), []);

  if (!supported) return null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={listening ? 'danger' : 'secondary'}
        onClick={listening ? stop : start}
        disabled={disabled || parsing}
        className="w-full"
        aria-pressed={listening}
      >
        {parsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Working out what you said…
          </>
        ) : listening ? (
          <>
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            Stop
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" aria-hidden="true" />
            Speak the entry
          </>
        )}
      </Button>

      {listening || heard ? (
        <p
          className={cn(
            'rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-xs',
            heard ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-ink-3)]',
          )}
          aria-live="polite"
        >
          {heard || 'Listening… try "four eighty for lunch on Coral".'}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11px] font-medium text-[var(--color-neg)]">
          {error}
        </p>
      ) : null}

      {!listening && !heard && !error ? (
        <p className="text-[11px] text-[var(--color-ink-3)]">
          Speech is recognised on your device — no audio is uploaded.
        </p>
      ) : null}
    </div>
  );
}
