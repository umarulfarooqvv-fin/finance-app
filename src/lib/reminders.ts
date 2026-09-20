/* ===========================================================================
   Reminder settings, shared by every way a reminder is delivered.

   One place decides how far ahead to warn, so the calendar feed and the push
   sender cannot drift into telling the same person two different things about
   the same bill.
   =========================================================================== */

export type ReminderSettings = {
  /** Days before a due date to warn. 0 means "on the day". */
  leadDays: number[];
  /** Whether the daily job sends push at all. The calendar is separate. */
  pushEnabled: boolean;
  /**
   * Whether a reminder names the figure.
   *
   * OFF BY DEFAULT, and the reason is the whole privacy mode this app already
   * has: every money figure on screen can be blurred because a phone gets
   * looked at over a shoulder. A notification and a calendar alert appear on
   * the LOCK SCREEN, where nothing can be blurred and no PIN has been entered
   * — so "Coral bill due in 3 days" is readable by anyone who glances at the
   * table, and "Coral bill — ₹2,312.16" tells them how much you owe.
   *
   * It is a setting rather than a rule because the figure is genuinely useful
   * and it is the owner's risk to take.
   */
  showAmounts: boolean;
};

/* Three days and the day itself: long enough to move money, close enough to
   act on. Two alerts, not five — a reminder that arrives every day for a week
   is one a person stops reading before the week is out. */
export const DEFAULT_REMINDERS: ReminderSettings = {
  leadDays: [3, 0],
  pushEnabled: true,
  showAmounts: false,
};

/** Settings as configured, with anything missing or corrupt falling back. */
export function remindersFrom(config: Record<string, unknown>): ReminderSettings {
  const raw = config['reminders'] as Partial<ReminderSettings> | undefined;
  const leads = Array.isArray(raw?.leadDays)
    ? raw.leadDays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 365)
    : null;
  return {
    leadDays: leads && leads.length > 0 ? [...new Set(leads)].sort((a, b) => b - a) : DEFAULT_REMINDERS.leadDays,
    pushEnabled: typeof raw?.pushEnabled === 'boolean' ? raw.pushEnabled : DEFAULT_REMINDERS.pushEnabled,
    showAmounts: typeof raw?.showAmounts === 'boolean' ? raw.showAmounts : DEFAULT_REMINDERS.showAmounts,
  };
}
