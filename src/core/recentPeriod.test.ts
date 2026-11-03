import { describe, expect, it } from 'vitest';

import { recentPeriod } from './recentPeriod';

function snapshot(createdAt: string | null, statusDate: string | null = null): Parameters<typeof recentPeriod>[0] {
  return {
    manifest: createdAt === null ? null : { createdAt },
    status: statusDate === null ? null : { createdAt: statusDate },
  };
}

describe('recentPeriod', () => {
  it('groups by local calendar days at each boundary', () => {
    const now = new Date(2026, 10, 3, 12).getTime();
    const date = (days: number): string => new Date(2026, 10, 3 - days, 0).toISOString();
    expect(recentPeriod(snapshot(date(0)), now)).toBe('today');
    expect(recentPeriod(snapshot(date(1)), now)).toBe('yesterday');
    expect(recentPeriod(snapshot(date(7)), now)).toBe('week');
    expect(recentPeriod(snapshot(date(8)), now)).toBe('month');
    expect(recentPeriod(snapshot(date(30)), now)).toBe('month');
    expect(recentPeriod(snapshot(date(31)), now)).toBe('older');
  });

  it('uses the status fallback and retains sessions with invalid or missing dates', () => {
    const now = new Date(2026, 10, 3, 12).getTime();
    expect(recentPeriod(snapshot(null, new Date(now).toISOString()), now)).toBe('today');
    expect(recentPeriod(snapshot('invalid'), now)).toBe('unknown');
    expect(recentPeriod(snapshot(null), now)).toBe('unknown');
  });
});
