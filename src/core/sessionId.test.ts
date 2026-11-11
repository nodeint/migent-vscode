import { describe, expect, it } from 'vitest';

import { compareSessionIds } from './sessionId';

describe('compareSessionIds', () => {
  it('orders all-digit ids by number', () => {
    expect(compareSessionIds('9', '10')).toBeLessThan(0);
    expect(compareSessionIds('10', '9')).toBeGreaterThan(0);
    expect(compareSessionIds('2', '2')).toBe(0);
  });

  it('puts numeric ids before legacy ids and compares legacy ids as strings', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    expect(compareSessionIds('99', uuid)).toBeLessThan(0);
    expect(compareSessionIds(uuid, '99')).toBeGreaterThan(0);
    expect(compareSessionIds('session_a', 'session_b')).toBeLessThan(0);
    expect(compareSessionIds(uuid, uuid)).toBe(0);
  });

  it('is deterministic for padded and huge numbers', () => {
    expect(compareSessionIds('007', '7')).not.toBe(0);
    expect(compareSessionIds('99999999999999999999', '100000000000000000000')).toBeLessThan(0);
  });
});
