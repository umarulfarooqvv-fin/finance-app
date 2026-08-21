/* ===========================================================================
   Information architecture.

   v2 shipped twenty-two sibling pages in one flat nav bar, which pushed the
   work of finding anything onto the user. The same features live here under
   six destinations, grouped by the question being asked rather than by the
   spreadsheet tab they came from:

     Today     am I OK right now, and is anything about to bite me?
     Cards     what do I owe, on which card, by when?
     Spending  where is the money going?
     Money     what do I actually have?
     Ledgers   who owes me, who do I owe, what is scheduled?
     Ask       anything not covered by the five above.

   Everything that used to be a top-level page is still reachable — as a
   section or a tab inside its destination, one level down.
   =========================================================================== */

export type NavItem = {
  href: string;
  label: string;
  /** Inline SVG path data, 24x24 grid, stroked. */
  icon: string;
  /** Sub-pages that should light this tab up as active. */
  match?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Today',
    icon: 'M3 12l9-9 9 9M5 10v10h14V10',
  },
  {
    href: '/cards',
    label: 'Cards',
    icon: 'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM2 10h20',
    match: ['/cards'],
  },
  {
    href: '/spending',
    label: 'Spending',
    icon: 'M3 3v18h18M7 15l4-5 3 3 5-7',
    match: ['/spending'],
  },
  {
    href: '/money',
    label: 'Money',
    icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    match: ['/money'],
  },
  {
    href: '/ledgers',
    label: 'Ledgers',
    icon: 'M4 4h13a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM4 16h15M9 8h6',
    match: ['/ledgers'],
  },
  {
    href: '/ask',
    label: 'Ask',
    icon: 'M21 12a9 9 0 01-9 9 8.7 8.7 0 01-4-.9L3 21l1-4.2A8.7 8.7 0 013 12a9 9 0 1118 0z',
    match: ['/ask'],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/') return pathname === '/';
  return (item.match ?? [item.href]).some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
