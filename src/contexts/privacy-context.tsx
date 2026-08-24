'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/* ===========================================================================
   Privacy mode.

   The blueprint's most transferable idea is not its permission kernel — this
   app has one user — but the SHAPE of it: one auditable place decides what is
   visible, and a build check stops anyone bypassing it. Pointed at an axis
   this app actually has, that becomes screen privacy.

   A personal finance app gets used on a phone in public, shared over a video
   call, and handed to someone to look at a photo. Every one of those exposes a
   net worth and a list of who owes you money.

   BE CLEAR ABOUT WHAT THIS IS. It obscures values on screen. The numbers are
   still in the DOM and still in the page source, so this defends against a
   person looking at the screen — not against anyone with the device. It is a
   privacy affordance, not an access control. The access control is the PIN.

   Blur rather than replacement, because layout must not shift: a column of
   masked figures that jumps when you unmask it is worse than useless when you
   are trying to point at one.
   =========================================================================== */

const STORAGE_KEY = 'pfm-privacy';

type PrivacyValue = {
  /** True when values should be obscured. */
  hidden: boolean;
  toggle: () => void;
  setHidden: (v: boolean) => void;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);

export function usePrivacy(): PrivacyValue {
  const ctx = useContext(PrivacyContext);
  // A default rather than a throw: a component that renders money outside the
  // provider should show it, not crash. The build check catches the omission.
  return ctx ?? { hidden: false, toggle: () => {}, setHidden: () => {} };
}

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHiddenState] = useState(false);

  // Read the stored preference after mount. Deliberately not SSR'd: rendering
  // the server's guess and correcting it would flash real amounts on screen,
  // which is precisely the thing this exists to prevent.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setHiddenState(true);
    } catch {
      // Storage unavailable (private browsing) — default to showing.
    }
  }, []);

  const setHidden = useCallback((v: boolean) => {
    setHiddenState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch {
      // Not persisting is acceptable; the toggle still works this session.
    }
  }, []);

  const toggle = useCallback(() => setHidden(!hidden), [hidden, setHidden]);

  // A shortcut matters here: reaching for a menu while someone is already
  // looking at the screen defeats the purpose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setHidden(!hidden);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hidden, setHidden]);

  const value = useMemo(() => ({ hidden, toggle, setHidden }), [hidden, toggle, setHidden]);

  return (
    <PrivacyContext.Provider value={value}>
      <div data-privacy={hidden ? 'hidden' : 'shown'}>{children}</div>
    </PrivacyContext.Provider>
  );
}

/**
 * Wraps a sensitive value.
 *
 * The blur is applied by CSS descending from the provider's data attribute,
 * not by a conditional here. Two reasons that matters: the same `.sensitive`
 * class works inside an SVG chart, where a wrapper span cannot go; and the
 * markup does not change when the toggle flips, so nothing remounts and no
 * layout shifts.
 */
export function Private({
  children, className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={['sensitive', className].filter(Boolean).join(' ')}>{children}</span>;
}

/** Class name for values that cannot take a wrapper element — SVG text, for
    instance. Same rule, same toggle. */
export const SENSITIVE = 'sensitive';
