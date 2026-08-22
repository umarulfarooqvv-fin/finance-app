/* ===========================================================================
   The shape every write returns.

   Pure and framework-free so it can be imported by client components, server
   actions and tests alike. The wrapper that produces it lives in actions.ts,
   which is server-only.

   One envelope, never a thrown exception. That single convention is what lets
   the client layer be uniform: one error presentation, one disabled-button
   rule, and no unhandled rejection leaving a button stuck on "Saving…".
   =========================================================================== */

/** Field name -> message. Rendered next to the input that caused it. */
export type FieldErrors = Record<string, string>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string, fieldErrors?: FieldErrors): ActionResult<T> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** True when the failure is something the user can fix in the form. */
export function hasFieldErrors<T>(r: ActionResult<T>): boolean {
  return !r.ok && Boolean(r.fieldErrors && Object.keys(r.fieldErrors).length);
}
