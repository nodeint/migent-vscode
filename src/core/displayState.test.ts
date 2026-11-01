import { describe, expect, it } from 'vitest';

import { deriveDisplayState, DISPLAY_STATE_ICONS, type DisplayStatusInput } from './displayState';
import type { DisplayStateName, LockProbe, SessionStatus } from './model';

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    status: 'active',
    workflowId: 'plan',
    title: null,
    createdAt: null,
    updatedAt: null,
    latestExecutionId: '0001-plan--attempt-01',
    latestExecutionStatus: 'completed',
    latestStageId: 'plan',
    latestDecision: null,
    blockedByExecutionIds: [],
    runningStages: [],
    raw: {},
    ...overrides,
  };
}

function input(overrides: Partial<DisplayStatusInput> = {}): DisplayStatusInput {
  return { status: status(), statusError: null, manifest: 'ok', ...overrides };
}

const localLock = (over: Partial<Extract<LockProbe, { kind: 'alive' }>> = {}): LockProbe => ({
  kind: 'alive',
  pid: 1,
  host: 'this-host',
  heartbeatAt: '2026-10-26T12:00:00.000Z',
  foreignHost: false,
  ...over,
});

const foreignLock = localLock({ host: 'other-host', foreignHost: true });

function state(inputOverrides: Partial<DisplayStatusInput>, lock: LockProbe): string {
  return deriveDisplayState(input(inputOverrides), lock).state;
}

describe('deriveDisplayState', () => {
  it('Prepared: status = prepared', () => {
    expect(state({ status: status({ status: 'prepared' }) }, { kind: 'none' })).toBe('prepared');
    // Even with a lock file present, a prepared session reads as prepared.
    expect(state({ status: status({ status: 'prepared' }) }, foreignLock)).toBe('prepared');
  });

  it('Running: lock is alive', () => {
    expect(state({}, localLock())).toBe('running');
    // A lock from another host cannot be pid-checked and still shows Running.
    expect(state({}, foreignLock)).toBe('running');
  });

  it('Blocked: status = blocked', () => {
    expect(state({ status: status({ status: 'blocked' }) }, { kind: 'none' })).toBe('blocked');
    expect(state({ status: status({ status: 'blocked' }) }, { kind: 'stale', reason: 'heartbeat' })).toBe('blocked');
  });

  it('Failed: active, no lock, latest_execution_status = failed', () => {
    expect(
      state({ status: status({ latestExecutionStatus: 'failed' }) }, { kind: 'none' }),
    ).toBe('failed');
    expect(state({ status: status({ latestExecutionStatus: 'failed' }) }, { kind: 'stale', reason: 'dead-pid' })).toBe('failed');
  });

  it('Stopped: active, no lock, last execution not failed', () => {
    expect(state({}, { kind: 'none' })).toBe('stopped');
    expect(state({ status: status({ latestExecutionStatus: null }) }, { kind: 'none' })).toBe('stopped');
    expect(state({}, { kind: 'stale', reason: 'unparsable' })).toBe('stopped');
  });

  it('Cancelled: status = cancelled', () => {
    expect(state({ status: status({ status: 'cancelled' }) }, { kind: 'none' })).toBe('cancelled');
  });

  it('Completed: status = completed', () => {
    expect(state({ status: status({ status: 'completed' }) }, { kind: 'none' })).toBe('completed');
  });

  it('Question: status = question, no live lock', () => {
    const asked = status({ status: 'question' });
    expect(state({ status: asked }, { kind: 'none' })).toBe('question');
    expect(state({ status: asked }, { kind: 'stale', reason: 'heartbeat' })).toBe('question');
    // A live lock still shows Running; Prepared and Blocked outrank Question's position.
    expect(state({ status: asked }, localLock())).toBe('running');
  });

  it('Unknown carries a reason for each cause, manifest problems first', () => {
    const reason = (over: Partial<DisplayStatusInput>): string | undefined =>
      deriveDisplayState(input(over), { kind: 'none' }).unknownReason;
    expect(reason({ status: null, statusError: 'unreadable' })).toBe('unreadable-status');
    expect(reason({ status: null, statusError: 'invalid' })).toBe('invalid-status');
    expect(reason({ status: null })).toBe('missing-status');
    expect(reason({ manifest: 'unsupported' })).toBe('unsupported-schema');
    expect(reason({ manifest: 'invalid' })).toBe('invalid-manifest');
    expect(reason({ manifest: 'unsupported', status: null, statusError: 'invalid' })).toBe('unsupported-schema');
    expect(reason({ status: status({ status: 'mysterious' }) })).toBe('unrecognized-status');
    expect(state({ status: null, statusError: 'invalid' }, { kind: 'none' })).toBe('unknown');
  });

  it('known states carry no unknownReason', () => {
    expect(deriveDisplayState(input(), { kind: 'none' }).unknownReason).toBeUndefined();
  });

  it('maps each state to its codicon', () => {
    const cases: [DisplayStateName, string][] = [
      ['prepared', 'circle-outline'],
      ['running', 'sync~spin'],
      ['blocked', 'warning'],
      ['question', 'comment-discussion'],
      ['failed', 'error'],
      ['stopped', 'debug-pause'],
      ['cancelled', 'circle-slash'],
      ['completed', 'pass'],
      ['unknown', 'question'],
    ];
    for (const [name, icon] of cases) {
      expect(DISPLAY_STATE_ICONS[name]).toBe(icon);
    }
  });

  it('writable is false only for a live foreign-host lock', () => {
    expect(deriveDisplayState(input(), localLock()).writable).toBe(true);
    expect(deriveDisplayState(input(), foreignLock).writable).toBe(false);
    expect(deriveDisplayState(input(), { kind: 'none' }).writable).toBe(true);
  });
});
