'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { foldForSearch } from '@/lib/search-text';
import { normaliseTag, tagKey, TAG_MAX } from '@/lib/user-tags';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   The tag field: chips, and a box that offers tags already in use.

   REUSE IS THE POINT. A tag typed slightly differently each time —
   "Bangalore trip", "Banglore Trip", "blr trip" — is three occasions, and its
   total is split three ways. So the box lists existing tags as you type, an
   exact match (however cased) takes the existing spelling, and only a name
   that matches nothing makes a new tag.

   Enter or comma adds what is typed; Backspace on an empty box removes the
   last chip. Every control is a button, so it works on a phone keyboard
   without any key at all.
   =========================================================================== */

export function TagInput({
  value, onChange, suggestions, id, compact = false, placeholder = 'Add a tag — e.g. Banglore Trip',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags already in use, most used first. */
  suggestions: string[];
  id?: string;
  /** Smaller, for a table row. */
  compact?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const chosen = useMemo(() => new Set(value.map(tagKey)), [value]);
  const q = foldForSearch(text.trim());
  const matches = useMemo(
    () => suggestions
      .filter((s) => !chosen.has(tagKey(s)) && (!q || foldForSearch(s).includes(q)))
      .slice(0, 6),
    [suggestions, chosen, q],
  );
  const exact = suggestions.find((s) => tagKey(s) === tagKey(text));

  function add(raw: string) {
    // An existing tag's spelling wins over what was typed.
    const known = suggestions.find((s) => tagKey(s) === tagKey(raw));
    const t = known ?? normaliseTag(raw);
    if (!t || chosen.has(tagKey(t))) { setText(''); return; }
    onChange([...value, t]);
    setText('');
  }

  const remove = (t: string) => onChange(value.filter((v) => tagKey(v) !== tagKey(t)));

  const fresh = normaliseTag(text);
  const showList = open && (matches.length > 0 || (fresh && !exact));

  return (
    <div className="relative">
      <div
        className={cx(
          'flex flex-wrap items-center gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] focus-within:border-[var(--color-accent)]',
          compact ? 'min-h-8 px-1.5 py-1' : 'min-h-10 px-2 py-1.5',
        )}
        onClick={() => input.current?.focus()}
      >
        {value.map((t) => (
          <span
            key={tagKey(t)}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--color-accent-soft)] py-0.5 pl-2 pr-1 text-[11px] font-medium text-[var(--color-accent)]"
          >
            <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{t}</span>
            <button
              type="button"
              aria-label={`Remove the tag ${t}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); remove(t); }}
              className="grid h-4 w-4 place-items-center rounded-full hover:bg-[var(--color-accent)] hover:text-white"
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          value={text}
          maxLength={TAG_MAX + 5}
          role="combobox"
          aria-expanded={Boolean(showList)}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            const v = e.target.value;
            // A comma ends a tag, the way it does in every tag box.
            if (v.includes(',')) { v.split(',').slice(0, -1).forEach(add); setText(v.split(',').at(-1) ?? ''); }
            else setText(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter adds a tag and must never submit the form around it.
              e.preventDefault();
              if (text.trim()) add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              remove(value[value.length - 1]!);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className={cx(
            'min-w-[8rem] flex-1 bg-transparent outline-none placeholder:text-[var(--color-ink-3)]',
            compact ? 'text-xs' : 'text-sm',
          )}
        />
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-pop)]"
        >
          {matches.map((s) => (
            <li key={tagKey(s)} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(s)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--color-raised)]"
              >
                <Tag className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                {s}
              </button>
            </li>
          ))}
          {fresh && !exact ? (
            <li role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(text)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-accent)] hover:bg-[var(--color-raised)]"
              >
                <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                Create the tag &ldquo;{fresh}&rdquo;
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** A row of read-only tag chips, for lists. */
export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <span className={cx('inline-flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <span
          key={tagKey(t)}
          className="inline-flex max-w-[min(12rem,100%)] items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--color-accent)]"
        >
          <Tag className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t}</span>
        </span>
      ))}
    </span>
  );
}
