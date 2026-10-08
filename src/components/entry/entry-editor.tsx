'use client';

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cx } from '@/components/ui/primitives';
import { TransactionDialog } from '@/app/transactions/transaction-dialog';
import { IncomeDialog } from '@/app/income/income-dialog';
import { loadEntryAction, type LoadedEntry } from '@/app/transactions/entry-actions';

/* ===========================================================================
   Edit an entry from wherever it is seen.

   A card's statement, the analysis, Today's recent activity, the tally — every
   list of entries used to be read-only, so correcting one meant leaving,
   opening Entries and searching for it. One editor now lives in the layout,
   and any list drops in <EditEntryButton id={…} /> beside a row.

   The button carries only the id. The form is filled from the server's
   cached snapshot on tap (entry-actions), so a server-rendered list needs no
   client code of its own, and an income row opens the income form instead.
   After a save the page refreshes, exactly as it does on Entries.
   =========================================================================== */

type Editor = {
  edit: (id: string) => Promise<void>;
  /** The id being fetched, so its button can show that something is happening. */
  loadingId: string | null;
};

const Ctx = createContext<Editor | null>(null);

export function EntryEditorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { notify } = useToast();
  const [loaded, setLoaded] = useState<LoadedEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const edit = useCallback(async (id: string) => {
    setLoadingId(id);
    try {
      const r = await loadEntryAction(id);
      if (!r.ok) {
        notify('error', r.error);
        return;
      }
      setLoaded(r.data);
      setOpen(true);
    } catch {
      notify('error', 'Could not open that entry. Check your connection and try again.');
    } finally {
      setLoadingId(null);
    }
  }, [notify]);

  const value = useMemo(() => ({ edit, loadingId }), [edit, loadingId]);
  const saved = () => router.refresh();

  return (
    <Ctx.Provider value={value}>
      {children}
      {loaded?.kind === 'transaction' ? (
        <TransactionDialog
          open={open}
          onOpenChange={setOpen}
          editing={loaded.entry}
          defaultTs={loaded.entry.ts}
          onSaved={saved}
        />
      ) : null}
      {loaded?.kind === 'income' ? (
        <IncomeDialog
          open={open}
          onOpenChange={setOpen}
          editing={loaded.entry}
          defaultTs={loaded.entry.ts}
          onSaved={saved}
          debtors={loaded.debtors}
        />
      ) : null}
    </Ctx.Provider>
  );
}

export function useEntryEditor(): Editor | null {
  return useContext(Ctx);
}

/** A pencil beside a row. Renders nothing outside the provider. */
export function EditEntryButton({
  id, label = 'Edit this entry', className,
}: {
  id: string;
  label?: string;
  className?: string;
}) {
  const editor = useEntryEditor();
  if (!editor) return null;
  const busy = editor.loadingId === id;
  return (
    <button
      type="button"
      aria-label={label}
      title="Edit"
      disabled={busy}
      onClick={(e) => {
        // Rows are sometimes links or toggles themselves.
        e.preventDefault();
        e.stopPropagation();
        void editor.edit(id);
      }}
      className={cx(
        'inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)] disabled:opacity-60',
        className,
      )}
    >
      {busy
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        : <Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}
