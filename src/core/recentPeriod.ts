import type { TextId } from '../text';

export const RECENT_PERIODS = ['today', 'yesterday', 'week', 'month', 'older', 'unknown'] as const;
export type RecentPeriod = (typeof RECENT_PERIODS)[number];

/** The catalog id of each period's heading; the wording lives in `src/text/`. */
export const RECENT_PERIOD_TEXT = {
  today: 'views.periodToday',
  yesterday: 'views.periodYesterday',
  week: 'views.periodWeek',
  month: 'views.periodMonth',
  older: 'views.periodOlder',
  unknown: 'views.periodUnknown',
} as const satisfies Record<RecentPeriod, TextId>;

/** Use the same creation date and fallback as the session store's ordering. */
export function recentPeriod(
  snapshot: { manifest: { createdAt: string | null } | null; status: { createdAt: string | null } | null },
  now: number,
): RecentPeriod {
  const value = snapshot.manifest?.createdAt ?? snapshot.status?.createdAt;
  const date = value === undefined || value === null ? NaN : Date.parse(value);
  if (!Number.isFinite(date)) return 'unknown';
  const current = new Date(now);
  const midnight = (days: number): number =>
    new Date(current.getFullYear(), current.getMonth(), current.getDate() - days).getTime();
  const weekDays = 7;
  const monthDays = 30;
  if (date >= midnight(0)) return 'today';
  if (date >= midnight(1)) return 'yesterday';
  if (date >= midnight(weekDays)) return 'week';
  if (date >= midnight(monthDays)) return 'month';
  return 'older';
}
