/* ===========================================================================
   Carrying rows from the Inbox to /import.

   The two pages are separate routes, so the rows a photo was read into have
   to survive one navigation. sessionStorage rather than a query string: the
   text is several lines long, and query strings are recorded in request logs.
   Rather than the server, because there is nothing to store — this is a draft
   in flight between two screens, and if it is lost the photo is still sitting
   in the inbox with its reading intact.
   =========================================================================== */

/** Where the Inbox leaves rows for /import to pick up, once. */
export const IMPORT_DRAFT_KEY = 'pfm:import-draft';

/** The rows, and the photos they were read from. */
export type HandedOver = { text: string; captureIds: string[] };
