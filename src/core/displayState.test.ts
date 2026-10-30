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
  return { status: status(), statusError: false, schemaSupported: true, ...overrides };
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

  it('Unknown: corrupt status.json', () => {
    expect(state({ status: null, statusError: true }, { kind: 'none' })).toBe('unknown');
    expect(state({ status: null, statusError: false }, { kind: 'none' })).toBe('unknown');
  });

  it('Unknown: unsupported schema_version', () => {
    expect(state({ schemaSupported: false }, { kind: 'none' })).toBe('unknown');
  });

  it('Unknown: unrecognized raw status value', () => {
    expect(state({ status: status({ status: 'mysterious' }) }, { kind: 'none' })).toBe('unknown');
  });

  it('maps each state to its codicon', () => {
    const cases: [DisplayStateName, string][] = [
      ['prepared', 'circle-outline'],
      ['running', 'sync~spin'],
      ['blocked', 'warning'],
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
