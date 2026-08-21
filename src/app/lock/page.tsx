export const dynamic = 'force-dynamic';

/**
 * The PIN screen. Deliberately plain: no nav, no data, nothing that could load
 * before the visitor is past the gate.
 */
export default async function LockPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <form
        action="/api/lock"
        method="post"
        className="w-full max-w-xs rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]"
      >
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--color-accent)] text-lg font-bold text-[var(--color-accent-ink)]">
            ₹
          </span>
          <h1 className="text-base font-semibold tracking-tight">Finance</h1>
          <p className="text-xs text-[var(--color-ink-3)]">Enter your PIN to continue</p>
        </div>

        <label htmlFor="pin" className="sr-only">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          required
          className="num w-full rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5 text-center text-lg tracking-[0.3em] outline-none focus:border-[var(--color-accent)]"
        />

        {e ? (
          <p role="alert" className="mt-2 text-center text-xs text-[var(--color-neg)]">
            That PIN did not work.
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-4 w-full rounded-[var(--radius-field)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-ink)] transition-opacity hover:opacity-90"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
