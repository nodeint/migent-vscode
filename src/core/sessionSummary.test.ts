import { describe, expect, it } from 'vitest';

import type { ExecutionEntry } from './executions';
import type { DisplayStateName, SessionSnapshot, UnknownReason } from './model';
import { buildSummary } from './sessionSummary';
import { executionEntry, type ExecutionFixture } from './testHelpers';

function execution(
  id: string,
  stage: string,
  overrides: Partial<ExecutionFixture> = {},
): ExecutionEntry {
  return executionEntry({ id, stage, status: 'completed', ...overrides });
}

interface SnapshotInput {
  state?: DisplayStateName;
  unknownReason?: UnknownReason;
  status?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  replyTargets?: SessionSnapshot['replyTargets'];
}

function snapshot(input: SnapshotInput = {}): SessionSnapshot {
  return {
    sessionId: 's',
    displayState: {
      state: input.state ?? 'completed',
      icon: 'x',
      writable: true,
      ...(input.unknownReason === undefined ? {} : { unknownReason: input.unknownReason }),
    },
    replyTargets: input.replyTargets ?? [],
    manifest: { ...input.manifest },
    status: { ...input.status },
  } as unknown as SessionSnapshot;
}

describe('buildSummary', () => {
  // B6: `running_stages` is not read, so the running stage is the latest stage.
  it('describes a running stage and its provider summary', () => {
    const summary = buildSummary(
      snapshot({
        state: 'running',
        status: {
          latest_stage_id: 'implement',
          latest_provider_event: { stage_id: 'plan', summary: 'writing tests' },
        },
      }),
      [],
    );

    expect(summary).toMatchObject({
      state: 'running',
      unknownReason: null,
      runningStage: 'implement',
      runningSummary: 'writing tests',
      isRunning: true,
    });
  });

  it('falls back to the latest provider event, then the latest stage', () => {
    const fromEvent = buildSummary(
      snapshot({
        state: 'running',
        status: {
          latest_provider_event: { stage_id: 'review' },
        },
      }),
      [],
    );
    expect(fromEvent).toMatchObject({ runningStage: 'review', runningSummary: null });

    const fromStage = buildSummary(
      snapshot({ state: 'running', status: { latest_stage_id: 'plan' } }),
      [],
    );
    expect(fromStage).toMatchObject({ runningStage: 'plan', runningSummary: null });
  });

  it('hides the running facts outside Running', () => {
    const summary = buildSummary(
      snapshot({
        state: 'completed',
        status: {
          latest_stage_id: 'plan',
          latest_provider_event: { stage_id: 'plan', summary: 'completed' },
        },
      }),
      [],
    );

    expect(summary).toMatchObject({ runningStage: null, runningSummary: null, isRunning: false });
  });

  it('lists the latest blocked execution with its recorded blocker', () => {
    const summary = buildSummary(
      snapshot({
        state: 'blocked',
        status: { latest_execution_id: '0001-plan--attempt-01' },
      }),
      [
        execution('0001-plan--attempt-01', 'plan', { status: 'blocked', blocker: 'needs a decision' }),
        execution('0002-review--attempt-02', 'review', { status: 'blocked', attempt: 2, blocker: 'other' }),
      ],
    );

    expect(summary.blocked).toEqual([
      { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, blocker: 'needs a decision' },
    ]);
  });

  it('keeps the blocked execution but no blocker when none was recorded', () => {
    const summary = buildSummary(
      snapshot({ state: 'blocked', status: { latest_execution_id: '0001-plan--attempt-01' } }),
      [execution('0001-plan--attempt-01', 'plan', { status: 'blocked', blocker: '  ' })],
    );

    expect(summary.blocked).toEqual([
      { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, blocker: null },
    ]);
  });

  it('lists nothing outside Blocked', () => {
    const summary = buildSummary(
      snapshot({ state: 'failed', status: { latest_execution_id: '0001-plan--attempt-01' } }),
      [execution('0001-plan--attempt-01', 'plan', { blocker: 'x' })],
    );

    expect(summary.blocked).toEqual([]);
  });

  it('reports a quota reset only for a quota failure of the latest execution', () => {
    const retryAt = '2026-11-03T07:05:00.000Z';
    const summary = buildSummary(
      snapshot({
        state: 'failed',
        status: {
          latest_execution_id: '0001-plan--attempt-01',
          latest_provider_event: {
            event: 'provider.quota',
            execution_id: '0001-plan--attempt-01',
            details: { retry_at: retryAt },
          },
        },
      }),
      [execution('0001-plan--attempt-01', 'plan', { status: 'failed' })],
    );

    expect(summary.quotaResetAt).toBe(Date.parse(retryAt));
  });

  it('leaves the quota reset null when the failure was not a quota or belongs to an older execution', () => {
    const notQuota = buildSummary(
      snapshot({ state: 'failed', status: { latest_provider_event: { event: 'provider.error' } } }),
      [],
    );
    const older = buildSummary(
      snapshot({
        state: 'failed',
        status: {
          latest_execution_id: '0002-plan--attempt-02',
          latest_provider_event: {
            event: 'provider.quota',
            execution_id: '0001-plan--attempt-01',
            details: { retry_at: '2026-11-03T07:05:00.000Z' },
          },
        },
      }),
      [],
    );

    expect(notQuota.quotaResetAt).toBeNull();
    expect(older.quotaResetAt).toBeNull();
  });

  it('prefers the execution the status names, else the highest-order summary', () => {
    const named = buildSummary(
      snapshot({ status: { latest_execution_id: '0001-plan--attempt-01' } }),
      [
        execution('0001-plan--attempt-01', 'plan'),
        execution('0002-review--attempt-02', 'review', { attempt: 2 }),
      ],
    );
    expect(named.latestExecution?.id).toBe('0001-plan--attempt-01');

    const fallback = buildSummary(snapshot(), [
      execution('0002-review--attempt-02', 'review', { attempt: 2 }),
      execution('0001-plan--attempt-01', 'plan'),
    ]);
    expect(fallback.latestExecution?.id).toBe('0002-review--attempt-02');
    expect(buildSummary(snapshot(), []).latestExecution).toBeNull();
  });

  // B6: `questions` is not read from status.json, so the pending question count is 0.
  it('carries the Unknown reason and no pending questions', () => {
    const summary = buildSummary(
      snapshot({
        state: 'unknown',
        unknownReason: 'missing-status',
        status: { questions: [{}, {}] },
      }),
      [],
    );

    expect(summary).toMatchObject({
      state: 'unknown',
      unknownReason: 'missing-status',
      pendingQuestions: 0,
    });
  });
});
