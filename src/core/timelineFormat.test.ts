import { describe, expect, it } from 'vitest';

import type { TailEvent } from './eventTail';
import { formatTimeline, formatTimelineLine } from './timelineFormat';

const utc = { isUtc: true };

function event(overrides: Partial<TailEvent>): TailEvent {
  return {
    seq: null,
    v: 2,
    event: 'note',
    timestamp: '',
    executionId: null,
    stageId: null,
    summary: null,
    data: {},
    raw: {},
    rawLine: null,
    ...overrides,
  };
}

describe('formatTimelineLine', () => {
  it('formats stage, attempt, event and summary', () => {
    const line = formatTimelineLine(
      event({
        event: 'execution.started',
        timestamp: '2026-10-26T10:15:30.000+00:00',
        executionId: '0001-plan--attempt-01',
        stageId: 'plan',
        summary: 'codex/gpt-5',
      }),
      utc,
    );
    expect(line).toBe('10:15:30 plan#1 started · codex/gpt-5');
  });

  it('keeps non-execution event names and omits an absent subject and summary', () => {
    const line = formatTimelineLine(event({ event: 'session.created', timestamp: '2026-10-26T09:10:00.000+00:00' }), utc);
    expect(line).toBe('09:10:00 session.created');
  });

  it('falls back to the stage id and a placeholder for a missing or invalid timestamp', () => {
    expect(formatTimelineLine(event({ stageId: 'plan' }), utc)).toBe('--:--:-- plan note');
    expect(formatTimelineLine(event({ timestamp: 'garbage' }), utc)).toBe('--:--:-- note');
  });

  it('passes malformed and unknown-version lines through marked unrecognized', () => {
    expect(formatTimelineLine(event({ event: null, raw: null, rawLine: 'not json at all' }), utc)).toBe(
      '--:--:-- [unrecognized] not json at all',
    );
    const future = '{"v":99,"event":"session.created"}';
    expect(formatTimelineLine(event({ v: 99, rawLine: future }), utc)).toBe(`--:--:-- [unrecognized] ${future}`);
  });
});

describe('formatTimeline', () => {
  it('adds a marker line first when older events were dropped', () => {
    const events = [event({ timestamp: '2026-10-26T09:10:00Z' })];
    expect(formatTimeline(events, 0, utc)).toEqual(['09:10:00 note']);
    expect(formatTimeline(events, 12, utc)).toEqual(['… 12 earlier events not shown', '09:10:00 note']);
  });
});
