import { describe, expect, it } from 'vitest';
import { applyClick } from '@/components/ui/selection';

/* The click rules behind every selectable list (Entries, Import, Inbox, the
   statement checker). */
const order = ['a', 'b', 'c', 'd', 'e', 'f'];
const sorted = (s: Set<string>) => [...s].sort();

describe('selecting rows', () => {
  it('a click ticks or unticks one row', () => {
    const one = applyClick(new Set<string>(), order, null, 'c', false);
    expect(sorted(one)).toEqual(['c']);
    expect(sorted(applyClick(one, order, 'c', 'c', false))).toEqual([]);
  });

  it('Shift-click ticks everything between the anchor and the row, either way', () => {
    const start = new Set(['b']);
    expect(sorted(applyClick(start, order, 'b', 'e', true))).toEqual(['b', 'c', 'd', 'e']);
    expect(sorted(applyClick(new Set(['e']), order, 'e', 'b', true))).toEqual(['b', 'c', 'd', 'e']);
  });

  it('a range takes the anchor\'s state: from an unticked anchor it clears', () => {
    const all = new Set(order);
    const cleared = applyClick(all, order, 'b', 'd', true, () => true);
    // 'b' is ticked in `all`, so the range ticks — nothing changes …
    expect(sorted(cleared)).toEqual(order);
    // … but after unticking 'b', the same Shift-click clears b–d.
    const noB = applyClick(all, order, 'b', 'b', false);
    expect(sorted(applyClick(noB, order, 'b', 'd', true))).toEqual(['a', 'e', 'f']);
  });

  it('keeps what was already ticked outside the range (Ctrl/⌘ picks add up)', () => {
    let s = applyClick(new Set<string>(), order, null, 'a', false);
    s = applyClick(s, order, 'a', 'f', false); // Ctrl/⌘-click: just f
    expect(sorted(s)).toEqual(['a', 'f']);
    s = applyClick(s, order, 'f', 'd', true); // Shift from f back to d
    expect(sorted(s)).toEqual(['a', 'd', 'e', 'f']);
  });

  it('never ticks a row that cannot be selected', () => {
    const notC = (k: string) => k !== 'c';
    expect(sorted(applyClick(new Set(['a']), order, 'a', 'e', true, notC))).toEqual(['a', 'b', 'd', 'e']);
    expect(sorted(applyClick(new Set<string>(), order, null, 'c', false, notC))).toEqual([]);
  });

  it('with no anchor, a Shift-click is an ordinary click', () => {
    expect(sorted(applyClick(new Set<string>(), order, null, 'd', true))).toEqual(['d']);
  });
});
