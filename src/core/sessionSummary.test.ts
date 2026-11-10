import { describe, expect, it } from 'vitest';

import type {
  DisplayStateName,
  ExecutionSnapshot,
  SessionSnapshot,
  UnknownReason,
} from './model';
import { buildSummary } from './sessionSummary';

function execution(
  id: string,
  stage: string,
  overrides: Partial<ExecutionSnapshot> = {},
): ExecutionSnapshot {
  return {
    id,
    order: Number(id.slice(0, 4)),
    stage,
    attempt: 1,
    status: 'completed',
    decision: null,
    blocker: null,
    client: null,
    model: null,
    hasFailureReport: false,
    kind: null,
    ...overrides,
  };
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
    manifest: { role: null, ...input.manifest },
    status: {
      latestStageId: null,
      latestExecutionId: null,
      runningStages: [],
      questions: [],
      blockedByExecutionIds: [],
      latestProviderEvent: null,
      ...input.status,
    },
  } as unknown as SessionSnapshot;
}

describe('buildSummary', () => {
  it('describes a running stage and its provider summary', () => {
    const summary = buildSummary(
      snapshot({
        state: 'running',
        status: {
          latestStageId: 'plan',
          runningStages: [{ stageId: 'implement' }],
          latestProviderEvent: { stageId: 'plan', summary: 'writing tests' },
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
          latestStageId: 'plan',
          latestProviderEvent: { stageId: 'review', summary: null },
        },
      }),
      [],
    );
    expect(fromEvent).toMatchObject({ runningStage: 'review', runningSummary: null });

    const fromStage = buildSummary(
      snapshot({ state: 'running', status: { latestStageId: 'plan' } }),
      [],
    );
    expect(fromStage).toMatchObject({ runningStage: 'plan', runningSummary: null });
  });

  it('hides the running facts outside Running', () => {
    const summary = buildSummary(
      snapshot({
        state: 'completed',
        status: {
          latestStageId: 'plan',
          latestProviderEvent: { stageId: 'plan', summary: 'completed' },
        },
      }),
      [],
    );

    expect(summary).toMatchObject({ runningStage: null, runningSummary: null, isRunning: false });
  });

  it('joins each blocked execution id with its recorded blocker, skipping unparsable ids', () => {
    const summary = buildSummary(
      snapshot({
        state: 'blocked',
        status: {
          blockedByExecutionIds: [
            '0001-plan--attempt-01',
            '0002-review--attempt-02',
            'not-an-execution',
          ],
        },
      }),
      [
        execution('0001-plan--attempt-01', 'plan', { status: 'blocked', blocker: 'needs a decision' }),
        execution('0002-review--attempt-02', 'review', { status: 'blocked', attempt: 2 }),
      ],
    );

    expect(summary.blocked).toEqual([
      { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, blocker: 'needs a decision' },
      { executionId: '0002-review--attempt-02', stageId: 'review', attempt: 2, blocker: null },
    ]);
  });

  it('reports a quota reset only for a quota failure of the latest execution', () => {
    const retryAt = '2026-11-03T07:05:00.000Z';
    const summary = buildSummary(
      snapshot({
        state: 'failed',
        status: {
          latestExecutionId: '0001-plan--attempt-01',
          latestProviderEvent: {
            event: 'provider.quota',
            executionId: '0001-plan--attempt-01',
            retryAt,
          },
        },
      }),
      [execution('0001-plan--attempt-01', 'plan', { status: 'failed' })],
    );

    expect(summary.quotaResetAt).toBe(Date.parse(retryAt));
  });

  it('leaves the quota reset null when the failure was not a quota or belongs to an older execution', () => {
    const notQuota = buildSummary(
      snapshot({ state: 'failed', status: { latestProviderEvent: { event: 'provider.error' } } }),
      [],
    );
    const older = buildSummary(
      snapshot({
        state: 'failed',
        status: {
          latestExecutionId: '0002-plan--attempt-02',
          latestProviderEvent: {
            event: 'provider.quota',
            executionId: '0001-plan--attempt-01',
            retryAt: '2026-11-03T07:05:00.000Z',
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
      snapshot({ status: { latestExecutionId: '0001-plan--attempt-01' } }),
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

  it('carries the Unknown reason and the pending question count', () => {
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
      pendingQuestions: 2,
    });
  });
});
