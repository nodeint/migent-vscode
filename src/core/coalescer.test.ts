import { describe, expect, it } from 'vitest';

import { Coalescer, type CoalescerTimers } from './coalescer';

/** Manual clock: timers fire only when `advance` moves time past them. */
function fakeTimers(): CoalescerTimers & { advance: (ms: number) => void; active: () => number } {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    active: () => timers.size,
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const [due] = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due === undefined) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
  };
}

function setup(delayMs = 150, maxWaitMs = 1000) {
  const timers = fakeTimers();
  const flushed: [string, string[]][] = [];
  const coalescer = new Coalescer<string>({
    delayMs,
    maxWaitMs,
    timers,
    flush: (key, items) => flushed.push([key, items]),
  });
  return { timers, flushed, coalescer };
}

describe('Coalescer', () => {
  it('flushes once after the quiet delay, with every item collected', () => {
    const { timers, flushed, coalescer } = setup();
    coalescer.add('s1', 'a');
    timers.advance(100);
    coalescer.add('s1', 'b');
    timers.advance(149);
    expect(flushed).toEqual([]);
    timers.advance(1);
    expect(flushed).toEqual([['s1', ['a', 'b']]]);
    expect(coalescer.pendingKeys).toEqual([]);
  });

  it('flushes at the max wait while events keep arriving', () => {
    const { timers, flushed, coalescer } = setup(150, 1000);
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      coalescer.add('s1', `e${elapsed}`);
      timers.advance(100);
    }
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.[1]).toHaveLength(10);
    // The flush happened at 1000 ms after the first item, not later.
    expect(timers.now()).toBe(1000);
  });

  it('keeps keys independent', () => {
    const { timers, flushed, coalescer } = setup();
    coalescer.add('s1', 'a');
    timers.advance(100);
    coalescer.add('s2', 'b');
    timers.advance(50);
    expect(flushed).toEqual([['s1', ['a']]]);
    timers.advance(100);
    expect(flushed).toEqual([['s1', ['a']], ['s2', ['b']]]);
  });

  it('starts a fresh window after a flush', () => {
    const { timers, flushed, coalescer } = setup();
    coalescer.add('s1', 'a');
    timers.advance(150);
    coalescer.add('s1', 'b');
    timers.advance(150);
    expect(flushed).toEqual([['s1', ['a']], ['s1', ['b']]]);
  });

  it('flushAll delivers immediately and leaves no timer', () => {
    const { timers, flushed, coalescer } = setup();
    coalescer.add('s1', 'a');
    coalescer.add('s2', 'b');
    coalescer.flushAll();
    expect(flushed.map(([key]) => key).sort()).toEqual(['s1', 's2']);
    expect(timers.active()).toBe(0);
  });

  it('dispose drops pending items without flushing and clears timers', () => {
    const { timers, flushed, coalescer } = setup();
    coalescer.add('s1', 'a');
    coalescer.dispose();
    timers.advance(5000);
    expect(flushed).toEqual([]);
    expect(timers.active()).toBe(0);
  });
});
