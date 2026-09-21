import { describe, expect, it } from 'vitest';
import { recovery, STALE_DAYS } from '@/lib/recovery';
import { makeSnapshot, tx } from './helpers';

const TODAY = '2026-09-21';

const lend = (person: string, amount: number, day: string) =>
  tx({ method: 'Fi', category: 'Credit Given', remarks: person, amount, ts: `${day}T10:00:00` });

const back = (person: string, amount: number, day: string) =>
  tx({ method: 'Fi', category: 'Credit Return', remarks: person, amount, ts: `${day}T10:00:00` });

describe('recovery', () => {
  it('reports what is outstanding per person', () => {
    const r = recovery(makeSnapshot({ transactions: [lend('Ashiq', 1000, '2026-09-01')] }), TODAY);
    expect(r.outstanding).toBe(1000);
    expect(r.people[0]).toMatchObject({ outstanding: 1000, repaid: 0, flag: 'nothing-back' });
  });

  it('leaves out anyone who has settled up', () => {
    const r = recovery(
      makeSnapshot({
        transactions: [lend('Ashiq', 1000, '2026-09-01'), back('Ashiq', 1000, '2026-09-05')],
      }),
      TODAY,
    );
    expect(r.people).toHaveLength(0);
    expect(r.outstanding).toBe(0);
  });

  /* Neither ordering works alone. Size first buries the forgotten ones;
     silence first surfaced a 19-rupee balance above a six-figure one on real
     data, because nothing about 742 days says whether the sum is worth a
     phone call. */
  it('puts the stale ones first, and the largest of those at the top', () => {
    const r = recovery(
      makeSnapshot({
        // Distinct FIRST words: the ledger groups people by first word, so
        // two fixtures starting "Big" would merge into one person.
        transactions: [
          lend('Anwar', 50000, '2026-09-15'),
          lend('Basheer', 19, '2024-09-10'),
          lend('Faisal', 40000, '2026-02-10'),
          // Something recorded recently keeps Anwar out of the stale group.
          back('Anwar', 100, '2026-09-19'),
        ],
      }),
      TODAY,
    );
    expect(r.people.map((p) => p.person)).toEqual([
      'Faisal',   // stale, and the largest of the stale
      'Basheer',  // stale, but trivial
      'Anwar',    // still being repaid, so not chased
    ]);
  });

  it('calls a balance stalled once it has gone quiet', () => {
    const quiet = recovery(
      makeSnapshot({
        transactions: [lend('Rahees', 1000, '2026-03-01'), back('Rahees', 100, '2026-03-05')],
      }),
      TODAY,
    );
    expect(quiet.people[0]!.flag).toBe('stalled');
    expect(quiet.people[0]!.quietFor).toBeGreaterThanOrEqual(STALE_DAYS);
    expect(quiet.stale).toBe(900);
    expect(quiet.staleCount).toBe(1);
  });

  it('calls it moving while repayments are still arriving', () => {
    const r = recovery(
      makeSnapshot({
        transactions: [lend('Fayiz', 1000, '2026-09-01'), back('Fayiz', 100, '2026-09-20')],
      }),
      TODAY,
    );
    expect(r.people[0]!.flag).toBe('moving');
    expect(r.stale).toBe(0);
  });

  it('separates never-repaid from merely stalled', () => {
    const r = recovery(
      makeSnapshot({
        transactions: [lend('Never', 1000, '2026-02-01'), lend('Partly', 1000, '2026-02-01'), back('Partly', 400, '2026-02-10')],
      }),
      TODAY,
    );
    const never = r.people.find((p) => p.person.toLowerCase().includes('never'))!;
    const partly = r.people.find((p) => p.person.toLowerCase().includes('partly'))!;
    expect(never.flag).toBe('nothing-back');
    expect(partly.flag).toBe('stalled');
    expect(partly.recovered).toBeCloseTo(0.4);
  });

  it('measures the age of the oldest lending still unrepaid', () => {
    const r = recovery(
      makeSnapshot({ transactions: [lend('Irshad', 200, '2026-06-23')] }),
      TODAY,
    );
    expect(r.people[0]!.oldestAge).toBe(90);
  });

  /* Money that arrived looking like a repayment but names nobody known
     settles nothing — and is why a balance can read unpaid years after the
     cash came back. Reported rather than dropped. */
  it('surfaces repayments that matched nobody', () => {
    const r = recovery(
      makeSnapshot({
        transactions: [lend('Ashiq', 1000, '2026-09-01'), back('Someone unknown', 500, '2026-09-10')],
      }),
      TODAY,
    );
    expect(r.unattached.count).toBeGreaterThan(0);
    expect(r.unattached.amount).toBeGreaterThan(0);
  });

  it('copes with a ledger that has nothing in it', () => {
    const r = recovery(makeSnapshot({}), TODAY);
    expect(r).toMatchObject({ outstanding: 0, stale: 0, staleCount: 0 });
    expect(r.people).toEqual([]);
  });
});
