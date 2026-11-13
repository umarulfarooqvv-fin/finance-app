import { FAMILY_START, familyFrom, type FamilyConfig } from '@/lib/family';
import { ME, splitsFrom, type Split } from '@/lib/splits';

/* ===========================================================================
   What an iPhone Shortcut sends to /api/share, read into one decision.

   A Shortcut picks names from menus (the GET of /api/share lists them), so
   this matches by NAME, case-insensitively: the group "Car", the brother
   "Ikka", the split "Wayanad trip", the friend "Ashiq". "Me" (or "You", or
   blank) is the owner. A split left out means the newest one.

   Pure: the stored config and the body in; what to do, or why not, out.
   =========================================================================== */

export type ShareBody = Record<string, string>;

export type ShareIntent =
  | { to: 'family'; group: string; groupName: string; member: string; mine: boolean; amount: number; day: string; note: string }
  | { to: 'split'; split: string; splitName: string; payer: string; mine: boolean; amount: number; day: string; note: string; method: string }
  | { error: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isMe = (who: string) => who.trim() === '' || ['me', 'you', 'myself', 'i'].includes(who.trim().toLowerCase());

/** The menus a Shortcut shows: groups and people, splits and their people. */
export function shareMenus(config: Record<string, unknown>) {
  const { cfg } = familyFrom(config);
  const splits = splitsFrom(config).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 15);
  return {
    family: {
      groups: cfg.groups.map((g) => g.name),
      people: cfg.members.map((m) => (m.me ? 'Me' : m.name)),
    },
    splits: splits.map((s) => ({ name: s.name, people: ['Me', ...s.people.map((p) => p.name)] })),
  };
}

export function readShare(config: Record<string, unknown>, body: ShareBody, today: string): ShareIntent {
  const amount = Number(String(body['amount'] ?? '').replace(/[₹,\s]/g, ''));
  if (!(amount > 0)) return { error: 'amount: send how much was paid.' };
  if (Math.round(amount * 100) !== amount * 100) return { error: 'amount: at most two decimals.' };
  const day = /^\d{4}-\d{2}-\d{2}/.test(body['day'] ?? '') ? body['day']!.slice(0, 10) : today;
  const note = (body['note'] ?? body['remarks'] ?? '').trim();
  const who = body['by'] ?? body['payer'] ?? body['member'] ?? '';
  const to = (body['to'] ?? '').trim().toLowerCase();

  if (to === 'family') {
    const { cfg, saved } = familyFrom(config);
    const family: FamilyConfig = saved ? cfg : FAMILY_START;
    const group = family.groups.find((g) => same(g.name, body['group'] ?? ''));
    if (!group) return { error: `group: one of ${family.groups.map((g) => g.name).join(', ')}.` };
    const owner = family.members.find((m) => m.me);
    const member = isMe(who) ? owner : family.members.find((m) => same(m.name, who));
    if (!member) return { error: `by: Me or one of ${family.members.filter((m) => !m.me).map((m) => m.name).join(', ')}.` };
    return { to: 'family', group: group.id, groupName: group.name, member: member.id, mine: Boolean(member.me), amount, day, note };
  }

  if (to === 'split') {
    const splits = splitsFrom(config).sort((a, b) => (a.day < b.day ? 1 : -1));
    const wanted = (body['split'] ?? '').trim();
    const split: Split | undefined = wanted ? splits.find((s) => same(s.name, wanted)) : splits[0];
    if (!split) return { error: splits.length ? `split: one of ${splits.map((s) => s.name).join(', ')}.` : 'split: make one on the Splits page first.' };
    const mine = isMe(who);
    const friend = mine ? null : split.people.find((p) => same(p.name, who));
    if (!mine && !friend) return { error: `by: Me or one of ${split.people.map((p) => p.name).join(', ')}.` };
    const method = (body['method'] ?? '').trim();
    if (mine && !method) return { error: 'method: what you paid with — Fi, Scapia, Cash…' };
    return { to: 'split', split: split.id, splitName: split.name, payer: mine ? ME : friend!.id, mine, amount, day, note, method };
  }

  return { error: 'to: "family" or "split".' };
}
