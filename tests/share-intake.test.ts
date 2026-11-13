import { describe, expect, it } from 'vitest';
import { readShare, shareMenus } from '@/lib/share-intake';
import { ME } from '@/lib/splits';

const config = {
  family: {
    members: [{ id: 'me', name: 'Me', me: true, from: '2000-01-01' }, { id: 'b1', name: 'Ikka', from: '2000-01-01' }],
    groups: [{ id: 'car', name: 'Car', kind: 'pledge', match: ['car contribution'], monthly: 5000, from: '2025-09-01', inTotal: true }],
    payments: [],
  },
  splits: [
    { id: 'old', name: 'Banglore', day: '2026-01-01', people: [{ id: 'a', name: 'Ashiq' }], match: [], expenses: [], settlements: [] },
    { id: 'new', name: 'Wayanad trip', day: '2026-05-30', people: [{ id: 'f', name: 'Faisal' }], match: [], expenses: [], settlements: [] },
  ],
};
const TODAY = '2026-11-13';

describe('payments from a Shortcut', () => {
  it('lists the names a Shortcut menu offers', () => {
    expect(shareMenus(config)).toEqual({
      family: { groups: ['Car'], people: ['Me', 'Ikka'] },
      splits: [{ name: 'Wayanad trip', people: ['Me', 'Faisal'] }, { name: 'Banglore', people: ['Me', 'Ashiq'] }],
    });
  });

  it('a brother’s family payment, names matched without case', () => {
    expect(readShare(config, { to: 'family', group: 'car', by: 'IKKA', amount: '5,000' }, TODAY))
      .toMatchObject({ to: 'family', group: 'car', member: 'b1', mine: false, amount: 5000, day: TODAY });
  });

  it('a split with no name goes to the newest; "Me" needs what you paid with', () => {
    expect(readShare(config, { to: 'split', by: 'Faisal', amount: '600', note: 'Room' }, TODAY))
      .toMatchObject({ to: 'split', split: 'new', payer: 'f', mine: false, note: 'Room' });
    expect(readShare(config, { to: 'split', by: 'Me', amount: '900' }, TODAY)).toMatchObject({ error: expect.stringMatching(/method/) });
    expect(readShare(config, { to: 'split', by: 'me', amount: '900', method: 'Fi' }, TODAY)).toMatchObject({ payer: ME, mine: true, method: 'Fi' });
  });

  it('says what it expected when a name or amount is wrong', () => {
    expect(readShare(config, { to: 'family', group: 'Boat', by: 'Ikka', amount: '1' }, TODAY)).toEqual({ error: 'group: one of Car.' });
    expect(readShare(config, { to: 'split', split: 'Wayanad trip', by: 'Ashiq', amount: '1' }, TODAY)).toEqual({ error: 'by: Me or one of Faisal.' });
    expect(readShare(config, { to: 'split', by: 'Faisal', amount: '0' }, TODAY)).toMatchObject({ error: expect.stringMatching(/amount/) });
    expect(readShare(config, { to: 'party', amount: '5' }, TODAY)).toMatchObject({ error: expect.stringMatching(/family/) });
  });
});
