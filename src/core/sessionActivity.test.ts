import { describe, expect, it } from 'vitest';

import type { TailEvent } from './eventTail';
import { buildActivity, OVERVIEW_ACTIVITY_LIMIT } from './sessionActivity';

function event(overrides: Partial<TailEvent> = {}): TailEvent {
  return {
    seq: null,
    v: 2,
    event: 'execution.started',
    timestamp: '2026-10-26T09:10:00.000+00:00',
    executionId: null,
    stageId: null,
    summary: null,
    data: {},
    raw: null,
    rawLine: null,
    ...overrides,
  };
}

function linesOf(activity: ReturnType<typeof buildActivity>): string[] {
  if (!activity.visible) throw new Error('expected visible activity');
  return activity.lines;
}

describe('buildActivity', () => {
  it('keeps the newest five events, oldest first', () => {
    const events = [1, 2, 3, 4, 5, 6, 7].map((seq) =>
      event({ seq, summary: `summary-${seq}` }));

    const lines = linesOf(buildActivity(events));

    expect(OVERVIEW_ACTIVITY_LIMIT).toBe(5);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('summary-3');
    expect(lines[4]).toContain('summary-7');
  });

  it('formats an event as a timeline line', () => {
    const lines = linesOf(buildActivity([
      event({
        executionId: '0001-plan--attempt-01',
        stageId: 'plan',
        summary: 'claude/sonnet',
      }),
    ]));

    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} plan#1 started · claude\/sonnet$/);
  });

  it('marks an unparsed line as unrecognized', () => {
    const lines = linesOf(buildActivity([event({ rawLine: 'not json at all', raw: null })]));
    expect(lines[0]).toBe('--:--:-- [unrecognized] not json at all');
  });

  it('returns an empty visible model when there are no events', () => {
    expect(buildActivity([])).toEqual({ visible: true, lines: [] });
  });
});
