import {
  ArrowLeftRight, BellRing, Users, Split, BookOpen, Camera, CreditCard, Home, LineChart, Map as MapIcon, MessageCircleQuestion, Scale, ScanLine, Search, Settings, Sheet, Smartphone, Tag, TrendingUp, Upload, Wallet, type LucideIcon,
} from 'lucide-react';

/* ===========================================================================
   Navigation as data — the single source of truth for destinations.

   Three surfaces render from this one array: the sidebar, the phone tab bar,
   and the command palette. Adding a destination in one place makes it appear
   in all three, which is the whole point; the blueprint's version also feeds
   an app launcher off the same list.

   The blueprint's item shape carries `requiredPerm` and `adminOnly`. This app
   has one user, so those are dropped — but `keywords` is kept and matters more
   here than it looks: it is what lets the palette find "Cards" when you type
   "bill", or "Ledgers" when you type "who owes me".
   =========================================================================== */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** One line, shown in the palette under the label. */
  hint?: string;
  /** Extra terms the palette should match on. */
  keywords?: string[];
  /** Sub-paths that should light this destination up as active. */
  match?: string[];
  /** Shown in the phone tab bar. */
  primary?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Today',
        href: '/',
        icon: Home,
        hint: 'Reserve, what needs paying, this month',
        keywords: ['home', 'dashboard', 'reserve', 'summary', 'overview'],
        primary: true,
      },
    ],
  },
  {
    title: 'Money',
    items: [
      {
        label: 'Cards',
        href: '/cards',
        icon: CreditCard,
        hint: 'Statements, balances and due dates',
        keywords: ['credit', 'bill', 'due', 'statement', 'debt', 'limit', 'utilisation',
                   'edge', 'coral', 'icici', 'scapia', 'one card', 'super money'],
        match: ['/cards'],
        primary: true,
      },
      {
        label: 'Entries',
        href: '/transactions',
        icon: ArrowLeftRight,
        hint: 'Every transaction, grouped by day and filterable',
        keywords: ['transactions', 'history', 'list', 'entries', 'rows', 'find',
                   'search', 'filter', 'ledger', 'all activity'],
        match: ['/transactions'],
        primary: true,
      },
      {
        label: 'Sheet',
        href: '/sheet',
        icon: Sheet,
        hint: 'Every entry as a spreadsheet: filter, sort, group, total, pivot',
        keywords: ['spreadsheet', 'excel', 'table', 'grid', 'pivot', 'sort', 'filter',
                   'analyse', 'analyze', 'export', 'csv', 'sum', 'total'],
        match: ['/sheet'],
      },
      {
        label: 'Map',
        href: '/map',
        icon: MapIcon,
        hint: 'Where the money was spent, as pins on a map',
        keywords: ['map', 'location', 'place', 'where', 'shop', 'gps', 'pin', 'nearby', 'area'],
        match: ['/map'],
      },
      {
        label: 'Tags',
        href: '/tags',
        icon: Tag,
        hint: 'Trips and occasions, and what each one cost',
        keywords: ['tag', 'label', 'trip', 'occasion', 'event', 'travel', 'hospital',
                   'wedding', 'group', 'project'],
        match: ['/tags'],
      },
      {
        label: 'Spending',
        href: '/spending',
        icon: LineChart,
        hint: 'Where the money goes',
        keywords: ['expenses', 'categories', 'trend', 'analytics', 'charts', 'monthly'],
        match: ['/spending'],
        primary: true,
      },
      {
        label: 'Income',
        href: '/income',
        icon: TrendingUp,
        hint: 'Money coming in, and how to post it from the Shortcut',
        keywords: ['inflow', 'salary', 'freelance', 'earnings', 'received', 'credit return',
                   'paid to me', 'revenue'],
        match: ['/income'],
      },
      {
        label: 'Money',
        href: '/money',
        icon: Wallet,
        hint: 'Net worth, accounts and income',
        keywords: ['net worth', 'balance', 'bank', 'accounts', 'income', 'salary', 'savings'],
        match: ['/money'],
        primary: true,
      },
      {
        label: 'Tally',
        href: '/tally',
        icon: Scale,
        hint: 'Date-wise statement: in, out and the running balance',
        keywords: ['reconcile', 'reconciliation', 'statement', 'check', 'balance', 'bank',
                   'day by day', 'in and out', 'audit'],
        match: ['/tally'],
      },
      {
        label: 'Ledgers',
        href: '/ledgers',
        icon: BookOpen,
        hint: 'Lent, borrowed and instalments',
        keywords: ['credit given', 'who owes me', 'lent', 'borrowed', 'emi', 'instalment',
                   'debt', 'people'],
        match: ['/ledgers'],
        primary: true,
      },
      {
        label: 'Family',
        href: '/family',
        icon: Users,
        hint: 'Family costs shared with brothers: who paid, each share',
        keywords: ['family', 'brother', 'brothers', 'share', 'split', 'car', 'contribution',
                   'uppa', 'hospital', 'sister', 'pool'],
        match: ['/family'],
      },
      {
        label: 'Splits',
        href: '/splits',
        icon: Split,
        hint: 'Trips and meals with friends: who paid, who pays whom',
        keywords: ['split', 'friends', 'trip', 'share', 'settle', 'who owes', 'dinner', 'outing', 'splitwise'],
        match: ['/splits'],
      },
    ],
  },
  {
    title: 'Tools',
    items: [
      {
        label: 'Ask',
        href: '/ask',
        icon: MessageCircleQuestion,
        hint: 'Questions answered from your records',
        keywords: ['ai', 'chat', 'question', 'claude', 'query'],
        match: ['/ask'],
        primary: true,
      },

      {
        label: 'Inbox',
        href: '/inbox',
        icon: Camera,
        hint: 'Photos waiting to become entries',
        keywords: ['photo', 'capture', 'camera', 'bill', 'receipt', 'later', 'pending',
                   'shortcut', 'upload', 'image'],
        match: ['/inbox'],
      },
      {
        label: 'Check a statement',
        href: '/reconcile',
        icon: ScanLine,
        hint: 'Paste a card statement and match it against your entries',
        keywords: ['reconcile', 'statement', 'bank', 'credit card', 'match', 'paste',
                   'extra charge', 'fee', 'compare', 'verify'],
        match: ['/reconcile'],
      },
      {
        label: 'Import a batch',
        href: '/import',
        icon: Upload,
        hint: 'Paste many entries at once, from screenshots or a spreadsheet',
        keywords: ['import', 'bulk', 'batch', 'paste', 'backlog', 'missed', 'catch up',
                   'screenshot', 'upi', 'csv', 'spreadsheet', 'many', 'several'],
        match: ['/import'],
      },
      {
        label: 'Reminders',
        href: '/reminders',
        icon: BellRing,
        hint: 'Bills, EMIs and subscriptions before they are late',
        keywords: ['reminder', 'alert', 'notification', 'notify', 'due', 'upcoming',
                   'emi', 'instalment', 'installment', 'subscription', 'recurring',
                   'calendar', 'push'],
        match: ['/reminders'],
      },
      {
        label: 'Search',
        href: '/search',
        icon: Search,
        hint: 'Find a transaction',
        keywords: ['find', 'lookup'],
      },
      {
        label: 'Shortcuts',
        href: '/shortcuts',
        icon: Smartphone,
        hint: 'Post a spend, income or a photo from your iPhone',
        keywords: ['iphone', 'shortcut', 'siri', 'api', 'ingest', 'token', 'automation',
                   'action button', 'quick add', 'post'],
        match: ['/shortcuts'],
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        hint: 'Cards, accounts and data',
        keywords: ['config', 'preferences', 'cards', 'limits', 'opening balance',
                   'tab bar', 'tabs', 'arrange', 'reorder', 'order', 'menu', 'bottom bar'],
        match: ['/settings'],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** The destinations the phone tab bar shows by default. */
export const PRIMARY_NAV_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((i) => i.primary);

/* ---------------------------------------------------------------------------
   The phone tab bar is the owner's to arrange: which pages, in what order.

   Kept in a cookie, like the theme, so the server renders the right bar on
   first paint instead of the default one flickering into the chosen one. It is
   a per-device preference — the desktop has the full rail and no tab bar.
   --------------------------------------------------------------------------- */

export const TABS_COOKIE = 'nav_tabs';
/** 'auto' = most used first; anything else = the owner's own order. */
export const TABS_MODE_COOKIE = 'nav_tabs_mode';
/** Pages by use, most first — written by the visit tracker for 'auto'. */
export const RANK_COOKIE = 'nav_rank';
/** Seven tabs plus More is what fits a phone's width at a readable size. */
export const MAX_TABS = 7;
export const MIN_TABS = 2;
/** Today is always the first tab, in every mode — home is where the thumb starts. */
export const HOME_HREF = '/';

export type TabsMode = 'fixed' | 'auto';

function hrefsToItems(raw: string | null | undefined): NavItem[] {
  const byHref = new Map(ALL_NAV_ITEMS.map((i) => [i.href, i]));
  const seen = new Set<string>();
  const out: NavItem[] = [];
  let text = raw ?? '';
  try { text = decodeURIComponent(text); } catch { /* already plain */ }
  for (const href of text.split(',')) {
    const item = byHref.get(href.trim());
    if (!item || seen.has(item.href)) continue;
    seen.add(item.href);
    out.push(item);
  }
  return out;
}

/**
 * The tab bar. Today first, always. Then either the owner's own order, or —
 * in 'auto' — the most used pages first, filled out from that order when
 * there is not yet enough history.
 */
export function tabsFrom(
  raw: string | null | undefined,
  opts: { mode?: TabsMode; rank?: string | null } = {},
): NavItem[] {
  const chosen = hrefsToItems(raw);
  const base = chosen.length >= MIN_TABS ? chosen : PRIMARY_NAV_ITEMS;
  const home = ALL_NAV_ITEMS.find((i) => i.href === HOME_HREF)!;
  const ordered = opts.mode === 'auto' ? [...hrefsToItems(opts.rank), ...base] : base;
  const out: NavItem[] = [home];
  for (const item of ordered) {
    if (out.length === MAX_TABS) break;
    if (!out.some((o) => o.href === item.href)) out.push(item);
  }
  return out;
}

/** Fired on window when the order changes, so the bar follows at once. */
export const TABS_EVENT = 'nav-tabs-change';

const cookie = (name: string, value: string) =>
  `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;

export function tabsCookie(hrefs: string[]): string {
  return cookie(TABS_COOKIE, hrefs.join(','));
}
export function tabsModeCookie(mode: TabsMode): string {
  return cookie(TABS_MODE_COOKIE, mode);
}
export function rankCookie(hrefs: string[]): string {
  return cookie(RANK_COOKIE, hrefs.join(','));
}

/**
 * Which destination is active for a pathname.
 *
 * Longest match wins, so a nested route highlights its own destination rather
 * than lighting up a parent as well.
 */
export function resolveActiveHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of ALL_NAV_ITEMS) {
    const candidates = item.match ?? [item.href];
    for (const c of candidates) {
      const hit = c === '/' ? pathname === '/' : pathname === c || pathname.startsWith(`${c}/`);
      if (hit && (best === null || c.length > best.length)) best = item.href === '/' ? '/' : c;
    }
    // An exact href match always wins over a prefix match on a shorter parent.
    if (pathname === item.href && (best === null || item.href.length >= best.length)) {
      best = item.href;
    }
  }
  return best;
}

export function isActive(pathname: string, item: NavItem): boolean {
  const active = resolveActiveHref(pathname);
  if (active === null) return false;
  return active === item.href || (item.match ?? []).includes(active);
}

/** Free-text match for the command palette. */
export function matchesQuery(item: NavItem, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const hay = [item.label, item.hint ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

/** The destination a pathname belongs to — `/cards/Scapia` is Cards. */
export function navItemFor(pathname: string): NavItem | null {
  return ALL_NAV_ITEMS.find((item) => isActive(pathname, item)) ?? null;
}
