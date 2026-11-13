import { round2 } from '@/lib/analytics';
import { payeeKey } from '@/lib/payee-hint';
import { monthKey, shiftMonth, type Day } from '@/lib/time';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   Family costs shared between brothers — /family.

   Some family costs are paid by the owner (and are already entries in this
   ledger), some by a brother (who does not use this app, so they are typed in
   on the family page). This puts both together, per cost GROUP, and says what
   each person has put in against what their share is.

   Two kinds of group:

     shared  — a cost split EQUALLY among the people in the split on the date
               it was paid. A brother who joins later shares only what is paid
               after he joined. Balance = paid − share.
     pledge  — a promise of a fixed amount a month from each person, e.g. the
               car: ₹5,000 a month each from Sept 2025. Due = monthly × the
               months since the later of the group's start and the person's
               joining, this month included. Balance = paid − due.

   WHICH OF THE OWNER'S ENTRIES BELONG to a group: an entry tagged with one of
   the group's words, or whose description contains one as whole words
   ("car contribution" matches "Car Contribution 6 (Tyre Change)" but not
   "Car fuel"). One that matched wrongly can be left out (`exclude`).

   Stored as `family` in app_config. Nothing here changes the ledger: a
   brother's payment is not an entry, and adding the owner's entries to a
   group does not touch them.

   Pure: snapshot + config in, the view out.
   =========================================================================== */

export const FAMILY_KEY = 'family';

export type FamilyMember = {
  id: string;
  name: string;
  /** The owner — whose payments are this ledger's entries. */
  me?: boolean;
  /** The first day this person is in the split. */
  from: Day;
};

export type FamilyGroup = {
  id: string;
  name: string;
  kind: 'shared' | 'pledge';
  /** Tags or words that pull the owner's entries into this group. */
  match: string[];
  /** For a pledge: what each person puts in a month, and from which day. */
  monthly?: number;
  from?: Day;
  /** Counted in the summary at the top. Off for a cost kept apart, e.g. a hospital case. */
  inTotal: boolean;
  /** The owner's entries that matched but do not belong. */
  exclude?: string[];
};

/** A payment typed in on the family page — a brother's, or one of the owner's not in the ledger. */
export type FamilyPayment = {
  id: string;
  group: string;
  member: string;
  amount: number;
  day: Day;
  note?: string;
};

export type FamilyConfig = {
  members: FamilyMember[];
  groups: FamilyGroup[];
  payments: FamilyPayment[];
};

/** What the page starts with before anything is saved — to be edited, not trusted. */
export const FAMILY_START: FamilyConfig = {
  members: [
    { id: 'me', name: 'Me', me: true, from: '2000-01-01' },
    { id: 'b1', name: 'Brother', from: '2000-01-01' },
  ],
  groups: [
    { id: 'car', name: 'Car', kind: 'pledge', match: ['car contribution'], monthly: 5000, from: '2025-09-01', inTotal: true },
    {
      id: 'uppa', name: 'Uppa’s hospital', kind: 'shared', inTotal: false,
      match: ['Uppa Neuro & Cardio Condition', 'EMS Hospital (Uppa)', 'Malabar HospitaL (Uppa)'],
    },
  ],
  payments: [],
};

const isDay = (v: unknown): v is Day => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The stored config, cleaned; the starting suggestion when nothing is saved. */
export function familyFrom(config: Record<string, unknown>): { cfg: FamilyConfig; saved: boolean } {
  const raw = config[FAMILY_KEY];
  if (!raw || typeof raw !== 'object') return { cfg: FAMILY_START, saved: false };
  const r = raw as Record<string, unknown>;

  const members: FamilyMember[] = [];
  for (const m of Array.isArray(r['members']) ? r['members'] : []) {
    const o = (m ?? {}) as Record<string, unknown>;
    if (!str(o['id']) || !str(o['name'])) continue;
    members.push({ id: str(o['id']), name: str(o['name']), from: isDay(o['from']) ? o['from'] : '2000-01-01', ...(o['me'] ? { me: true } : {}) });
  }
  const groups: FamilyGroup[] = [];
  for (const g of Array.isArray(r['groups']) ? r['groups'] : []) {
    const o = (g ?? {}) as Record<string, unknown>;
    if (!str(o['id']) || !str(o['name'])) continue;
    const pledge = o['kind'] === 'pledge';
    groups.push({
      id: str(o['id']),
      name: str(o['name']),
      kind: pledge ? 'pledge' : 'shared',
      match: (Array.isArray(o['match']) ? o['match'] : []).map(str).filter(Boolean),
      ...(pledge && Number(o['monthly']) > 0 ? { monthly: Number(o['monthly']) } : {}),
      ...(pledge && isDay(o['from']) ? { from: o['from'] } : {}),
      inTotal: o['inTotal'] !== false,
      exclude: (Array.isArray(o['exclude']) ? o['exclude'] : []).map(str).filter(Boolean),
    });
  }
  const payments: FamilyPayment[] = [];
  for (const p of Array.isArray(r['payments']) ? r['payments'] : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const amount = Number(o['amount']);
    if (!str(o['id']) || !str(o['group']) || !str(o['member']) || !(amount > 0) || !isDay(o['day'])) continue;
    payments.push({ id: str(o['id']), group: str(o['group']), member: str(o['member']), amount, day: o['day'], ...(str(o['note']) ? { note: str(o['note']) } : {}) });
  }
  return { cfg: { members, groups, payments }, saved: true };
}

/** Whether one of the owner's entries belongs to a group by its words or tags. */
export function matchesGroup(t: Pick<Transaction, 'remarks' | 'userTags'>, group: Pick<FamilyGroup, 'match'>): boolean {
  const text = ` ${payeeKey(t.remarks)} `;
  const tags = t.userTags.map((x) => x.trim().toLowerCase());
  return group.match.some((m) => {
    if (tags.includes(m.trim().toLowerCase())) return true;
    const key = payeeKey(m);
    return key !== '' && text.includes(` ${key} `);
  });
}

/** An entry tagged with the group's own name belongs to it — what the Shortcut sends. Tag only: "Car" as a word would catch "Car fuel". */
export function taggedWith(t: Pick<Transaction, 'userTags'>, name: string): boolean {
  const key = name.trim().toLowerCase();
  return key !== '' && t.userTags.some((x) => x.trim().toLowerCase() === key);
}

export type FamilyRow = {
  /** The entry's id, or the typed payment's. */
  id: string;
  day: Day;
  amount: number;
  member: string;
  note: string;
  /** From the owner's ledger, or typed in on the family page. */
  from: 'ledger' | 'typed';
};

export type MemberTally = {
  member: string;
  paid: number;
  /** Shared: their part of what was paid. Pledge: what they promised so far. */
  owed: number;
  /** paid − owed: above zero they are ahead, below they are behind. */
  balance: number;
};

export type GroupView = {
  group: FamilyGroup;
  total: number;
  rows: FamilyRow[];
  tally: MemberTally[];
  /** Pledge only: month by month, what each person put in. */
  months: { key: string; paid: Record<string, number> }[];
};

export type FamilyView = {
  members: FamilyMember[];
  groups: GroupView[];
  /** Over the groups counted in the total. */
  summary: MemberTally[];
};

const active = (m: FamilyMember, day: Day) => m.from <= day;

/** Months from `from`'s month to `to`'s, both included; 0 when `from` is later. */
export function monthsBetween(from: Day, to: Day): number {
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return Math.max(0, b - a + 1);
}

function groupView(snap: Snapshot, cfg: FamilyConfig, group: FamilyGroup, today: Day): GroupView {
  const me = cfg.members.find((m) => m.me);
  const excluded = new Set(group.exclude ?? []);
  const rows: FamilyRow[] = [];

  if (me) {
    for (const t of snap.transactions) {
      if (t.deleted || !t.ts || t.amount == null || excluded.has(t.id)) continue;
      if (!matchesGroup(t, group) && !taggedWith(t, group.name)) continue;
      rows.push({ id: t.id, day: t.ts.slice(0, 10), amount: t.amount, member: me.id, note: t.remarks || t.category, from: 'ledger' });
    }
  }
  for (const p of cfg.payments) {
    if (p.group !== group.id) continue;
    rows.push({ id: p.id, day: p.day, amount: p.amount, member: p.member, note: p.note ?? '', from: 'typed' });
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const paid = new Map<string, number>(cfg.members.map((m) => [m.id, 0]));
  const owed = new Map<string, number>(cfg.members.map((m) => [m.id, 0]));
  for (const r of rows) paid.set(r.member, (paid.get(r.member) ?? 0) + r.amount);

  const months: GroupView['months'] = [];
  if (group.kind === 'pledge') {
    const start = group.from ?? '2000-01-01';
    for (const m of cfg.members) {
      const since = m.from > start ? m.from : start;
      owed.set(m.id, (group.monthly ?? 0) * monthsBetween(since, today));
    }
    // A month for every month of the pledge, newest first, so an empty one shows.
    const n = monthsBetween(start, today);
    let { y, m } = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
    for (let i = 0; i < n; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.push({ key, paid: {} });
      ({ y, m } = shiftMonth(y, m, -1));
    }
    const byKey = new Map(months.map((x) => [x.key, x]));
    for (const r of rows) {
      const slot = byKey.get(monthKey(r.day));
      if (slot) slot.paid[r.member] = round2((slot.paid[r.member] ?? 0) + r.amount);
    }
  } else {
    // Each payment split equally among whoever was in the split that day.
    for (const r of rows) {
      const sharers = cfg.members.filter((m) => active(m, r.day));
      if (sharers.length === 0) continue;
      const part = r.amount / sharers.length;
      for (const m of sharers) owed.set(m.id, (owed.get(m.id) ?? 0) + part);
    }
  }

  const tally = cfg.members.map((m) => {
    const p = round2(paid.get(m.id) ?? 0);
    const o = round2(owed.get(m.id) ?? 0);
    return { member: m.id, paid: p, owed: o, balance: round2(p - o) };
  });
  return { group, total: round2(rows.reduce((s, r) => s + r.amount, 0)), rows, tally, months };
}

export function familyView(snap: Snapshot, cfg: FamilyConfig, today: Day): FamilyView {
  const groups = cfg.groups.map((g) => groupView(snap, cfg, g, today));
  const summary = cfg.members.map((m) => {
    let paid = 0;
    let owed = 0;
    for (const g of groups) {
      if (!g.group.inTotal) continue;
      const t = g.tally.find((x) => x.member === m.id);
      paid += t?.paid ?? 0;
      owed += t?.owed ?? 0;
    }
    return { member: m.id, paid: round2(paid), owed: round2(owed), balance: round2(paid - owed) };
  });
  return { members: cfg.members, groups, summary };
}

/** Problems with a setup about to be saved, or null. */
export function familyErrors(cfg: Pick<FamilyConfig, 'members' | 'groups'>): string | null {
  if (cfg.members.length === 0) return 'Add at least one person.';
  if (cfg.members.filter((m) => m.me).length !== 1) return 'Exactly one person must be you.';
  const ids = new Set<string>();
  for (const m of cfg.members) {
    if (!m.name.trim()) return 'Every person needs a name.';
    if (!isDay(m.from)) return `${m.name}: the joining date is not a date.`;
    if (ids.has(m.id)) return 'Two people share an id.';
    ids.add(m.id);
  }
  const gids = new Set<string>();
  for (const g of cfg.groups) {
    if (!g.name.trim()) return 'Every group needs a name.';
    if (gids.has(g.id)) return 'Two groups share an id.';
    gids.add(g.id);
    if (g.kind === 'pledge') {
      if (!(Number(g.monthly) > 0)) return `${g.name}: say how much each person puts in a month.`;
      if (!isDay(g.from)) return `${g.name}: say from which day.`;
    }
  }
  return null;
}
