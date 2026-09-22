/* ===========================================================================
   The iPhone Shortcut recipes, as data.

   One definition each, rendered wherever they are needed — the Shortcuts page,
   and the panel on the page the endpoint belongs to. They were duplicated
   prose on two pages before, which is how documentation and behaviour drift
   apart: the income panel described a `ts` field that the spending endpoint
   did not yet accept.

   Pure and framework-free, so the shapes here are checked by the compiler
   against the same field names the routes read.

   THE TOKEN IS NEVER IN HERE. INGEST_TOKEN is a server secret; putting it in a
   module that reaches the browser would place it in the page source, in the
   RSC payload, and in every screenshot of the page.
   =========================================================================== */

export type RecipeField = {
  name: string;
  required: boolean;
  note: string;
};

export type RecipeStep = {
  /** The Shortcuts action to add, named as it appears in the app. */
  action: string;
  detail: string;
};

export type Recipe = {
  slug: 'spend' | 'income' | 'photo';
  title: string;
  /** One line on what it is for, in the user's terms. */
  why: string;
  path: string;
  contentType: string;
  /** The body, when it is JSON. A photo has no example — the body is the file. */
  example?: string;
  fields: RecipeField[];
  steps: RecipeStep[];
  notes: string[];
};

const IDEMPOTENT =
  'Posting the same entry twice updates the first rather than recording a second, ' +
  'so a retry over a bad connection is safe.';

const TS_NOTE =
  'Leave ts out and the server clock is used. Send one — "2026-09-13T14:30:00", ' +
  'IST, no timezone suffix — to date the entry when the money actually moved rather ' +
  'than when you got round to typing it.';

export const RECIPES: Recipe[] = [
  {
    slug: 'spend',
    title: 'Add a spend',
    why: 'The one you will use most: amount, where it came from, what it was for.',
    path: '/api/entry',
    contentType: 'application/json',
    example:
      '{"amount":"450","method":"Fi","category":"Food","remarks":"Lunch"}',
    fields: [
      { name: 'amount', required: true, note: 'Digits. "1,234.50" and "₹450" are both fine.' },
      { name: 'method', required: true, note: 'Where the money came FROM — Fi, Coral, Cash…' },
      { name: 'category', required: true, note: 'What it was for — Food, Fuel, Family…' },
      { name: 'remarks', required: false, note: 'A short description.' },
      { name: 'ts', required: false, note: 'When it happened. Defaults to now.' },
      {
        name: 'the photo', required: false,
        note: 'Optional — switch the body to Form and add a File field. Attached to this entry directly; it never goes through the inbox.',
      },
    ],
    steps: [
      { action: 'Ask for Input', detail: 'Number — "How much?"' },
      { action: 'Choose from Menu', detail: 'your payment methods: Fi, Jupiter, Cash, Coral, Scapia…' },
      { action: 'Choose from Menu', detail: 'your categories: Food, Fuel, Family, Personal…' },
      { action: 'Ask for Input', detail: 'Text — "What for?" (you can leave it blank)' },
      { action: 'Get Contents of URL', detail: 'POST, JSON, with those four as the fields below' },
    ],
    notes: [
      TS_NOTE,
      'A card name as the category means that card\'s BILL was paid, not that you spent on it. ' +
        '"method: Fi, category: Coral" is paying the Coral bill from Fi.',
      'To attach a photo in the same step: change Request Body from JSON to Form, keep amount/' +
        'method/category/remarks as text fields, and add one more field of type File pointing at ' +
        'a Take Photo or Select Photos action earlier in the Shortcut. A photo that fails to upload ' +
        'never undoes the entry — the money is already recorded either way.',
      IDEMPOTENT,
    ],
  },

  {
    slug: 'income',
    title: 'Add income',
    why: 'Money coming in — salary, freelance, or somebody paying you back.',
    path: '/api/entry',
    contentType: 'application/json',
    example:
      '{"type":"income","amount":"45000","source":"Salary","account":"Fi","remarks":"March Salary"}',
    fields: [
      { name: 'type', required: true, note: 'The literal word "income". Without it this is a spend.' },
      { name: 'amount', required: true, note: 'Must be positive.' },
      { name: 'source', required: true, note: 'Where it came from — Salary, Freelance, Credit Return…' },
      { name: 'account', required: true, note: 'Which account received it. "None" if it never reached one.' },
      { name: 'remarks', required: false, note: 'A short description.' },
      { name: 'ts', required: false, note: 'When it landed. Defaults to now.' },
    ],
    steps: [
      { action: 'Ask for Input', detail: 'Number — "How much came in?"' },
      { action: 'Choose from Menu', detail: 'Salary, Freelance, Commissions, Credit Return…' },
      { action: 'Choose from Menu', detail: 'Fi, Jupiter, SBI, Cash, None' },
      { action: 'Ask for Input', detail: 'Text — "What was it for?"' },
      { action: 'Get Contents of URL', detail: 'POST, JSON, with type set to income' },
    ],
    notes: [
      'category and method are accepted as aliases for source and account, so one Shortcut can ' +
        'post both kinds using the same field names with only type telling them apart.',
      'A Credit Return posted this way is matched to a person by the words in its remarks. ' +
        'If it matches nobody it appears on the Income page to be linked by hand — it will not ' +
        'silently settle nothing.',
      IDEMPOTENT,
    ],
  },

  {
    slug: 'photo',
    title: 'Send a photo',
    why: 'No time to type it: photograph the shop or the bill and make the entry later.',
    path: '/api/capture',
    contentType: 'image/jpeg',
    fields: [
      { name: 'the photo', required: true, note: 'The request BODY is the image itself.' },
      { name: 'note', required: false, note: 'Query string — ?note=Chai%20shop, a line to jog your memory.' },
      { name: 'ts', required: false, note: 'Query string — when the photo was taken. Defaults to now.' },
    ],
    steps: [
      { action: 'Take Photo', detail: 'or Select Photos, for one you already took' },
      { action: 'Get Contents of URL', detail: 'POST to the address below' },
      { action: 'Headers', detail: 'x-token, and Content-Type: image/jpeg' },
      { action: 'Request Body', detail: 'File — then pick the Photo from step 1' },
      { action: 'Add to Home Screen', detail: 'or the Action Button, so it is one tap' },
    ],
    notes: [
      'The entry you make from the photo is dated when the PHOTO was taken, not when you typed it.',
      'The same photo sent twice is one capture — the id is derived from the image itself, so a ' +
        'retry cannot fill the inbox with duplicates of one receipt.',
      'Photos are stored privately and only ever served back through this app while you are signed ' +
        'in. Nothing reads them automatically; you look at the picture and type what it says.',
    ],
  },
];

export function recipe(slug: Recipe['slug']): Recipe {
  const found = RECIPES.find((r) => r.slug === slug);
  if (!found) throw new Error(`No shortcut recipe named ${slug}`);
  return found;
}
