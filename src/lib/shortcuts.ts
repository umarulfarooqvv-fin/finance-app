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
  slug: 'spend' | 'income' | 'photo' | 'voice' | 'dictate' | 'family' | 'split';
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

const PLACE_NOTE =
  'To record WHERE: add Get Current Location before Get Contents of URL, then Get Details of ' +
  'Locations three times — Latitude, Longitude and Name (or Street). Send them as headers x-lat, ' +
  'x-lon and x-place, not in the URL: an address in a query string lands in the server logs. ' +
  'The entry shows the place on Entries and on the Map; without a name, one is looked up from ' +
  'OpenStreetMap. A location that fails to save never undoes the entry.';

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
      { name: 'lat', required: false, note: 'Where — latitude, as the x-lat header (or a field). From Get Current Location.' },
      { name: 'lon', required: false, note: 'Longitude, as the x-lon header (or a field).' },
      { name: 'place', required: false, note: 'A name for it — x-place header. Looked up when left out.' },
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
      { action: 'Get Current Location', detail: 'optional — then Get Details of Locations for Latitude, Longitude, Name' },
      { action: 'Get Contents of URL', detail: 'POST, JSON, with those four as the fields below; x-lat, x-lon, x-place as headers' },
    ],
    notes: [
      TS_NOTE,
      PLACE_NOTE,
      'A card name as the category means that card\'s BILL was paid, not that you spent on it. ' +
        '"method: Fi, category: Coral" is paying the Coral bill from Fi.',
      'To attach a photo in the same step: change Request Body from JSON to Form, keep amount/' +
        'method/category/remarks as text fields, and add one more field of type File pointing at ' +
        'a Take Photo or Select Photos action earlier in the Shortcut. A photo that fails to upload ' +
        'never undoes the entry — the money is already recorded either way.',
      'To make the photo OPTIONAL rather than every time: add a Choose from Menu after "What ' +
        'for?" — prompt "Attach a photo?", items "No" and "Yes". Leave the existing JSON step ' +
        '(steps above) under "No". Under "Yes", add Take Photo (or Select Photos) then a SEPARATE ' +
        'Get Contents of URL set to Form with the File field, as described above. Both branches ' +
        'need their own x-token header — Choose from Menu branches do not share actions. Shortcuts ' +
        'sets the multipart Content-Type itself when Request Body is Form, so remove any ' +
        'Content-Type header you added by hand in that branch or the upload is rejected.',
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
      { name: 'lat', required: false, note: 'Header x-lat — where the photo was taken. Every entry made from it takes this place.' },
      { name: 'lon', required: false, note: 'Header x-lon — the longitude.' },
      { name: 'place', required: false, note: 'Header x-place — a name for that place. Looked up when left out.' },
    ],
    steps: [
      { action: 'Take Photo', detail: 'or Select Photos, for one you already took' },
      { action: 'Get Current Location', detail: 'optional — then Get Details of Locations for Latitude, Longitude, Name' },
      { action: 'Get Contents of URL', detail: 'POST to the address below' },
      { action: 'Headers', detail: 'x-token, Content-Type: image/jpeg, and x-lat / x-lon / x-place if you added the location' },
      { action: 'Request Body', detail: 'File — then pick the Photo from step 1' },
      { action: 'Add to Home Screen', detail: 'or the Action Button, so it is one tap' },
      { action: 'Quick Look', detail: 'optional, while setting up — shows what the server replied' },
    ],
    notes: [
      'The entry you make from the photo is dated when the PHOTO was taken, not when you typed it — '
        + 'and placed where it was taken, when the location was sent with it.',
      'If nothing appears here, add a Quick Look step after Get Contents of URL and run it again: '
        + 'the reply says what went wrong. A Shortcut swallows an error silently, which looks '
        + 'exactly like a photo that sent fine.',
      'The same photo sent twice is one capture — the id is derived from the image itself, so a ' +
        'retry cannot fill the inbox with duplicates of one receipt.',
      'Photos are stored privately and only ever served back through this app while you are signed ' +
        'in. With IMPORT_AI set, a new photo is sent to that provider to be read into draft rows — ' +
        'it is the one thing that leaves; with it off, nothing reads them and you type what you see.',
      'Either way the reading is a DRAFT. No entry is created from a photo without you confirming ' +
        'it, so a misread amount cannot reach the ledger on its own.',
    ],
  },
  {
    slug: 'voice',
    title: 'Speak a spend — English or Malayalam',
    why: 'Say it the way you would tell someone: "ചായക്ക് നാല്പത് രൂപ Fi-ൽ നിന്ന്" or "forty for tea from Fi".',
    path: '/api/voice?format=text',
    contentType: 'audio/mp4',
    fields: [
      { name: 'the recording', required: true, note: 'The request BODY is the audio file itself.' },
    ],
    steps: [
      { action: 'Record Audio', detail: 'Start Recording: Immediately; Finish Recording: On Tap' },
      { action: 'Get Contents of URL', detail: 'POST to the address below' },
      { action: 'Headers', detail: 'x-token' },
      { action: 'Request Body', detail: 'File — then pick the Recorded Audio from step 1' },
      { action: 'Show Notification', detail: 'with the Contents of URL — it says what was understood' },
      { action: 'Add to Home Screen', detail: 'or the Action Button, so it is one tap' },
    ],
    notes: [
      'It lands in the Inbox as a DRAFT, dated when you spoke. Open it, check the amount against '
        + 'what was heard, and tap Add entry. Nothing is saved on its own: speech is misheard, and '
        + '"two hundred and fifty for" can come out as 254.',
      'Say the amount, then pause, then the rest — "four eighty … tea … from Fi". Running "fifty for" '
        + 'together is the one mistake it makes most.',
      'The recording is sent to the AI provider to be heard (that is how Malayalam works — the iPhone '
        + 'cannot transcribe it) and is not stored anywhere. Only the words are kept, until the draft '
        + 'is added or discarded.',
      'A Malayalam note is translated to English on the way in, so the description arrives in English.',
    ],
  },
  {
    slug: 'dictate',
    title: 'Dictate a spend — English, on the phone',
    why: 'The iPhone hears it; only the words are sent. For when you would rather no audio left the phone.',
    path: '/api/voice?format=text',
    contentType: 'application/json',
    example: '{\n  "text": "four eighty for tea from Fi"\n}',
    fields: [
      { name: 'text', required: true, note: 'What was said, as the Dictate Text action heard it.' },
    ],
    steps: [
      { action: 'Dictate Text', detail: 'Language: English (India)' },
      { action: 'Get Contents of URL', detail: 'POST to the address below' },
      { action: 'Headers', detail: 'x-token' },
      { action: 'Request Body', detail: 'JSON — one field, text, set to the Dictated Text' },
      { action: 'Show Notification', detail: 'with the Contents of URL' },
    ],
    notes: [
      'Lands in the Inbox as a draft exactly like a voice note, to check and add.',
      'English only: the iPhone has no Malayalam dictation. For Malayalam, use Speak a spend.',
    ],
  },

  {
    slug: 'family',
    title: 'Family: add a payment',
    why: 'Car share, Uppa’s hospital, any family cost — who paid it, in three taps. It lands on the Family page.',
    path: '/api/share',
    contentType: 'application/json',
    example: '{"to":"family","group":"Car","by":"Ikka","amount":"5000","note":"November"}',
    fields: [
      { name: 'to', required: true, note: 'The word "family".' },
      { name: 'group', required: true, note: 'The cost, as named on the Family page — Car, Uppa’s hospital…' },
      { name: 'by', required: true, note: '"Me", or a brother’s name as on the Family page.' },
      { name: 'amount', required: true, note: 'Digits.' },
      { name: 'method', required: false, note: 'Only when by is Me: what you paid with — Fi, Cash… It also becomes an entry in your ledger.' },
      { name: 'note', required: false, note: 'A few words.' },
      { name: 'day', required: false, note: '"2026-11-13". Defaults to today.' },
    ],
    steps: [
      { action: 'Get Contents of URL', detail: 'GET the address below with the x-token header — it returns your groups and people' },
      { action: 'Get Dictionary Value', detail: '"family" → "groups", then Choose from List — "Which cost?"' },
      { action: 'Get Dictionary Value', detail: '"family" → "people", then Choose from List — "Who paid?"' },
      { action: 'Ask for Input', detail: 'Number — "How much?"' },
      { action: 'Get Contents of URL', detail: 'POST, JSON: to = family, group, by, amount (add method when it was you)' },
      { action: 'Show Notification', detail: 'with Get Dictionary Value "message" from the reply' },
    ],
    notes: [
      'A brother’s payment is kept on the Family page only — your accounts do not change.',
      'When by is Me, the money left YOUR account, so it is saved as an ordinary Family entry from the method you send, tagged with the group’s name — the group finds it by that tag.',
      'The menus come from the app each time, so a new brother or a new cost appears in the Shortcut without editing it.',
      'The same payment sent twice within a minute is saved once.',
    ],
  },

  {
    slug: 'split',
    title: 'Splits: add to a trip or meal',
    why: 'Who paid what on a trip or dinner out, from the table. It lands in the split on the Splits page.',
    path: '/api/share',
    contentType: 'application/json',
    example: '{"to":"split","split":"Wayanad trip","by":"Ashiq","amount":"600","note":"Room"}',
    fields: [
      { name: 'to', required: true, note: 'The word "split".' },
      { name: 'split', required: false, note: 'Its name on the Splits page. Left out: the newest split.' },
      { name: 'by', required: true, note: '"Me", or a friend’s name in that split.' },
      { name: 'amount', required: true, note: 'Digits.' },
      { name: 'method', required: false, note: 'Needed when by is Me — what you paid with. Saved as a Credit Given entry and added to the split.' },
      { name: 'note', required: false, note: 'What for — dinner, fuel, room.' },
      { name: 'day', required: false, note: '"2026-11-13". Defaults to today.' },
    ],
    steps: [
      { action: 'Get Contents of URL', detail: 'GET the address below with the x-token header — it returns your splits and who is in each' },
      { action: 'Get Dictionary Value', detail: '"splits", then Choose from List on each item’s "name" — "Which split?"' },
      { action: 'Choose from List', detail: 'that split’s "people" — "Who paid?"' },
      { action: 'Ask for Input', detail: 'Number — "How much?", then Text — "What for?"' },
      { action: 'If', detail: 'Who paid is Me → Choose from Menu: Fi, Scapia, Cash… for method' },
      { action: 'Get Contents of URL', detail: 'POST, JSON: to = split, split, by, amount, note (and method when it was you)' },
      { action: 'Show Notification', detail: 'with Get Dictionary Value "message" from the reply' },
    ],
    notes: [
      'A friend’s payment is kept in the split only. Yours is money that left your account, so it is saved as a Credit Given entry — the way you already log paying for the group — and picked into the split for you.',
      'A quicker version for the usual case: skip the split menu and leave split out — it goes to the newest split.',
      'Each expense is shared equally by everyone in the split; to share one among only some people, edit it on the Splits page.',
      'The same payment sent twice within a minute is saved once.',
    ],
  },
];

export function recipe(slug: Recipe['slug']): Recipe {
  const found = RECIPES.find((r) => r.slug === slug);
  if (!found) throw new Error(`No shortcut recipe named ${slug}`);
  return found;
}
