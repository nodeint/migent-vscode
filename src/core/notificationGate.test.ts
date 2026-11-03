import { describe, expect, it } from 'vitest';

import { NotificationGate } from './notificationGate';

describe('NotificationGate', () => {
  it('shows one notification per session and keeps only the latest queued one', () => {
    const gate = new NotificationGate<string>();
    expect(gate.request('a', 'blocked')).toBe(true);
    expect(gate.request('a', 'failed')).toBe(false);
    expect(gate.request('a', 'completed')).toBe(false);
    expect(gate.release('a')).toBe('completed');
    expect(gate.request('a', 'again')).toBe(true);
    expect(gate.release('a')).toBeUndefined();
  });

  it('does not let one session affect another', () => {
    const gate = new NotificationGate<string>();
    expect(gate.request('a', 'x')).toBe(true);
    expect(gate.request('b', 'y')).toBe(true);
    expect(gate.request('b', 'z')).toBe(false);
    expect(gate.release('a')).toBeUndefined();
    expect(gate.release('b')).toBe('z');
  });
});
