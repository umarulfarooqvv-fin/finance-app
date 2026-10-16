import { describe, expect, it } from 'vitest';
import { spanFor } from '@/lib/day-spend';

// 16 Oct 2026 is a Friday.
const TODAY = '2026-10-16';

describe('Today’s spans', () => {
  it('today and yesterday compare with the day before', () => {
    expect(spanFor(undefined, TODAY)).toMatchObject({ from: TODAY, to: TODAY, prev: { from: '2026-10-15' } });
    expect(spanFor('yesterday', TODAY)).toMatchObject({ from: '2026-10-15', to: '2026-10-15', prev: { from: '2026-10-14' } });
  });

  it('weeks run Monday to Sunday', () => {
    expect(spanFor('this-week', TODAY)).toMatchObject({ from: '2026-10-12', to: TODAY, prev: { from: '2026-10-05', to: '2026-10-09' } });
    expect(spanFor('last-week', TODAY)).toMatchObject({ from: '2026-10-05', to: '2026-10-11', prev: { from: '2026-09-28', to: '2026-10-04' } });
  });

  it('months: this one so far against the same days of the last', () => {
    expect(spanFor('this-month', TODAY)).toMatchObject({ from: '2026-10-01', to: TODAY, prev: { from: '2026-09-01', to: '2026-09-16' } });
    expect(spanFor('last-month', TODAY)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026', prev: { from: '2026-08-01', to: '2026-08-31' } });
    // 31 March against February: clamped to February's last day.
    expect(spanFor('this-month', '2026-03-31').prev).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('a picked day, never one in the future or malformed', () => {
    expect(spanFor('day', TODAY, '2026-10-02')).toMatchObject({ key: 'day', from: '2026-10-02', to: '2026-10-02' });
    expect(spanFor('day', TODAY, '2026-12-01').key).toBe('today');
    expect(spanFor('day', TODAY, 'nope').key).toBe('today');
  });
});
