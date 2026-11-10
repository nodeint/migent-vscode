import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listExecutions } from './executions';
import type { ExecutionSnapshot } from './model';
import { buildProgress, type SessionProgress, type StageProgressRow } from './sessionProgress';
import type { SessionStagePlan } from './workflowStages';

const fixture = (name: string): string =>
  path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', name);

function plan(stages: string[]): SessionStagePlan {
  return { kind: 'ok', stages };
}

function execution(
  id: string,
  stage: string,
  attempt: number,
  status: string | null,
  decision: string | null = null,
): ExecutionSnapshot {
  return {
    id,
    order: Number(id.slice(0, 4)),
    stage,
    attempt,
    status,
    decision,
    blocker: null,
    client: null,
    model: null,
    hasFailureReport: false,
    kind: null,
  };
}

function stagesOf(progress: SessionProgress): StageProgressRow[] {
  if (progress.kind !== 'stages') throw new Error(`expected stages, got ${progress.kind}`);
  return progress.rows;
}

describe('buildProgress', () => {
  it('maps the completed, failed, blocked and cancelled fixture executions to stage states', () => {
    const expected = {
      completed: 'completed',
      failed: 'failed',
      blocked: 'blocked',
      cancelled: 'cancelled',
    };
    for (const [name, state] of Object.entries(expected)) {
      const progress = buildProgress({
        executions: listExecutions(fixture(name)),
        plan: plan(['plan']),
        runningStageIds: [],
        latestExecutionId: null,
      });
      expect(stagesOf(progress)).toEqual([
        { id: 'plan', state, attempts: 1, decision: null, isCurrent: false },
      ]);
    }
  });

  it('lists future stages as not-run and marks the latest running execution current', () => {
    const progress = buildProgress({
      executions: listExecutions(fixture('running')),
      plan: plan(['plan', 'review']),
      runningStageIds: [],
      latestExecutionId: '0001-plan--attempt-01',
    });

    expect(stagesOf(progress)).toEqual([
      { id: 'plan', state: 'running', attempts: 1, decision: null, isCurrent: true },
      { id: 'review', state: 'not-run', attempts: null, decision: null, isCurrent: false },
    ]);
  });

  it('marks a stage current from runningStageIds even before it has an execution', () => {
    const progress = buildProgress({
      executions: [],
      plan: plan(['plan', 'review']),
      runningStageIds: ['review'],
      latestExecutionId: null,
    });

    expect(stagesOf(progress).map((row) => [row.id, row.isCurrent])).toEqual([
      ['plan', false],
      ['review', true],
    ]);
  });

  it('uses the latest non-skipped execution for state, attempt and decision', () => {
    const progress = buildProgress({
      executions: [
        execution('0001-plan--attempt-01', 'plan', 1, 'completed', 'approved'),
        execution('0002-plan--attempt-02', 'plan', 2, 'skipped'),
      ],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress)).toEqual([
      { id: 'plan', state: 'completed', attempts: 1, decision: 'approved', isCurrent: false },
    ]);
  });

  it('shows a stage with only skipped executions as skipped', () => {
    const progress = buildProgress({
      executions: [execution('0001-plan--attempt-03', 'plan', 3, 'skipped')],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress)[0]).toMatchObject({ state: 'skipped', attempts: 3 });
  });

  it('lists every prepared stage as not-run', () => {
    const progress = buildProgress({
      executions: [],
      plan: plan(['build', 'verify']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress)).toEqual([
      { id: 'build', state: 'not-run', attempts: null, decision: null, isCurrent: false },
      { id: 'verify', state: 'not-run', attempts: null, decision: null, isCurrent: false },
    ]);
  });

  it('appends stage ids that have executions but are no longer declared, once, in execution order', () => {
    const progress = buildProgress({
      executions: [
        execution('0001-plan--attempt-01', 'plan', 1, 'completed'),
        execution('0002-legacy--attempt-01', 'legacy', 1, 'completed'),
        execution('0003-legacy--attempt-02', 'legacy', 2, 'failed'),
      ],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress).map((row) => [row.id, row.state])).toEqual([
      ['plan', 'completed'],
      ['legacy', 'failed'],
    ]);
  });

  it('falls back to one row per execution when the plan is missing, invalid, empty or unreadable', () => {
    const executions = [
      execution('0001-developer--attempt-01', 'developer', 1, 'completed', 'done'),
      execution('0002-developer--attempt-02', 'developer', 2, 'skipped'),
      execution('0003-developer--attempt-03', 'developer', 3, 'running'),
    ];
    const plans: SessionStagePlan[] = [
      { kind: 'missing' },
      { kind: 'invalid', error: 'boom' },
      { kind: 'unreadable', error: 'denied' },
      { kind: 'ok', stages: [] },
    ];

    for (const fallback of plans) {
      const progress = buildProgress({
        executions,
        plan: fallback,
        runningStageIds: [],
        latestExecutionId: '0003-developer--attempt-03',
      });
      expect(progress.kind).toBe('executions');
      if (progress.kind !== 'executions') return;
      expect(progress.rows.map((row) => [row.executionId, row.state, row.isCurrent])).toEqual([
        ['0001-developer--attempt-01', 'completed', false],
        ['0002-developer--attempt-02', 'skipped', false],
        ['0003-developer--attempt-03', 'running', true],
      ]);
    }
  });

  it('keeps an unrecognized status visible as unknown', () => {
    const progress = buildProgress({
      executions: [execution('0001-plan--attempt-01', 'plan', 1, null)],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress)[0]?.state).toBe('unknown');
  });
});
