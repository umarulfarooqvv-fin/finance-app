import {
  ArrowLeftRight, BookOpen, CreditCard, Home, LineChart,
  MessageCircleQuestion, Search, Settings, Wallet, type LucideIcon,
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
        label: 'Spending',
        href: '/spending',
        icon: LineChart,
        hint: 'Where the money goes',
        keywords: ['expenses', 'categories', 'trend', 'analytics', 'charts', 'monthly'],
        match: ['/spending'],
        primary: true,
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
        label: 'Ledgers',
        href: '/ledgers',
        icon: BookOpen,
        hint: 'Lent, borrowed and instalments',
        keywords: ['credit given', 'who owes me', 'lent', 'borrowed', 'emi', 'instalment',
                   'debt', 'people'],
        match: ['/ledgers'],
        primary: true,
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
        label: 'Search',
        href: '/search',
        icon: Search,
        hint: 'Find a transaction',
        keywords: ['find', 'lookup'],
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        hint: 'Cards, accounts and data',
        keywords: ['config', 'preferences', 'cards', 'limits', 'opening balance'],
        match: ['/settings'],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** The destinations the phone tab bar shows. */
export const PRIMARY_NAV_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((i) => i.primary);

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
