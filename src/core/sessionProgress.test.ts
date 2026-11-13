import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listExecutions } from './executions';
import type { MetricsExecution, MetricsUsage } from './metrics';
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
    effort: null,
    turnKind: null,
    outcomeStatus: null,
    error: null,
    hasFailureReport: false,
    kind: null,
    createdAt: null,
    completedAt: null,
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
      expect(stagesOf(progress)).toMatchObject([
        { id: 'plan', state, attempts: 1, decision: null, history: [{ attempt: 1, state, decision: null }], isCurrent: false },
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

    expect(stagesOf(progress)).toMatchObject([
      { id: 'plan', state: 'running', attempts: 1, decision: null, history: [{ order: 1, attempt: 1, state: 'running', decision: null, completedAt: null }], completedAt: null, isCurrent: true },
      { id: 'review', state: 'not-run', attempts: null, decision: null, history: [], completedAt: null, isCurrent: false },
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

    expect(stagesOf(progress)).toMatchObject([
      { id: 'plan', state: 'completed', attempts: 1, decision: 'approved', history: [{ order: 1, attempt: 1, state: 'completed', decision: 'approved', completedAt: null }], completedAt: null, isCurrent: false },
    ]);
  });

  it('lists every non-skipped attempt of a stage, oldest first, with its decision and time', () => {
    const first = { ...execution('0001-plan--attempt-01', 'plan', 1, 'completed', 'revise'), completedAt: '2026-11-01T10:00:00.000Z' };
    const second = { ...execution('0002-plan--attempt-02', 'plan', 2, 'completed', 'approved'), completedAt: '2026-11-01T11:00:00.000Z' };
    const progress = buildProgress({
      executions: [second, first, execution('0003-plan--attempt-03', 'plan', 3, 'skipped')],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });

    expect(stagesOf(progress)[0]).toMatchObject({
      attempts: 2,
      decision: 'approved',
      completedAt: '2026-11-01T11:00:00.000Z',
      history: [
        { attempt: 1, state: 'completed', decision: 'revise', completedAt: '2026-11-01T10:00:00.000Z' },
        { attempt: 2, state: 'completed', decision: 'approved', completedAt: '2026-11-01T11:00:00.000Z' },
      ],
    });
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
      { id: 'build', state: 'not-run', attempts: null, decision: null, history: [], completedAt: null, isCurrent: false },
      { id: 'verify', state: 'not-run', attempts: null, decision: null, history: [], completedAt: null, isCurrent: false },
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

describe('attempt facts', () => {
  const usage = (inputTokens: number | null, outputTokens: number | null) => ({
    inputTokens, outputTokens, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null,
  });
  const measured = (id: string, extra: Partial<MetricsExecution>): MetricsExecution => ({
    id,
    order: Number(id.slice(0, 4)),
    stageId: 'plan',
    attempt: 1,
    role: null,
    client: null,
    model: null,
    status: 'completed',
    decision: null,
    createdAt: null,
    completedAt: null,
    wallSeconds: null,
    verifySeconds: null,
    turns: null,
    usage: usage(null, null),
    usageMissing: usage(null, null),
    verify: null,
    skipReason: null,
    resumesExecutionId: null,
    routedFrom: null,
    ...extra,
  });

  it('carries model, effort, blocker and start time from the execution, and no figures without metrics.json', () => {
    const plain = execution('0001-plan--attempt-01', 'plan', 1, 'blocked');
    const progress = buildProgress({
      executions: [{ ...plain, model: 'claude-sonnet-5-5', effort: 'medium', blocker: 'needs a token', error: 'verify failed: red', createdAt: '2026-11-01T10:00:00Z' }],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });
    expect(stagesOf(progress)[0]?.history[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      blocker: 'needs a token',
      error: 'verify failed: red',
      createdAt: '2026-11-01T10:00:00Z',
      wallSeconds: null,
      usage: null,
      resumes: null,
      reason: null,
      asked: false,
    });
  });

  const usageOf = (extra: Partial<MetricsUsage>): MetricsUsage => ({ ...usage(null, null), ...extra });

  it('takes duration and each usage field from metrics, uncombined, and names the resumed attempt', () => {
    const executions = [
      execution('0001-plan--attempt-01', 'plan', 1, 'completed'),
      execution('0002-plan--attempt-02', 'plan', 2, 'completed'),
    ];
    const metrics = [
      measured('0001-plan--attempt-01', {
        wallSeconds: 62,
        usage: usageOf({
          inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cacheReadTokens: 7, cacheWriteTokens: 0, costUsd: 0.5,
        }),
      }),
      measured('0002-plan--attempt-02', { wallSeconds: 220, usage: usage(null, 7), resumesExecutionId: '0001-plan--attempt-01' }),
    ];
    const rows = stagesOf(buildProgress({ executions, plan: plan(['plan', 'review']), runningStageIds: [], latestExecutionId: null, metrics }));
    const [first, second] = rows[0]?.history ?? [];
    expect(first).toMatchObject({
      wallSeconds: 62,
      usage: {
        inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cacheReadTokens: 7, cacheWriteTokens: 0, costUsd: 0.5,
      },
      resumes: null,
    });
    expect(second).toMatchObject({ wallSeconds: 220, usage: usage(null, 7), resumes: { stage: 'plan', attempt: 1 } });
    // A stage that never ran has no attempts.
    expect(rows[1]?.history).toEqual([]);
    expect(first).not.toHaveProperty('tokens');
  });

  it('gives an execution that metrics.json does not list no duration and no usage', () => {
    const progress = buildProgress({
      executions: [execution('0001-plan--attempt-01', 'plan', 1, 'completed')],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
      metrics: [],
    });
    expect(stagesOf(progress)[0]?.history[0]).toMatchObject({ wallSeconds: null, usage: null });
  });

  it('does not name an attempt that is not in the session', () => {
    const progress = buildProgress({
      executions: [{ ...execution('0001-plan--attempt-01', 'plan', 1, 'completed'), turnKind: 'continue' }],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
      metrics: [measured('0001-plan--attempt-01', { resumesExecutionId: '0009-gone--attempt-01', routedFrom: '0008-gone--attempt-01' })],
    });
    expect(stagesOf(progress)[0]?.history[0]).toMatchObject({ resumes: null, reason: null });
  });

  describe('why an attempt ran', () => {
    const reasonOfSecond = (
      turnKind: string | null,
      routed: boolean,
      sourceDecision: string | null = 'revise',
    ) => {
      const executions = [
        execution('0001-review--attempt-01', 'review', 1, 'completed', sourceDecision),
        { ...execution('0002-plan--attempt-02', 'plan', 2, 'completed'), turnKind },
      ];
      const metrics = [measured('0002-plan--attempt-02', routed ? { routedFrom: '0001-review--attempt-01' } : {})];
      const progress = buildProgress({ executions, plan: plan(['plan', 'review']), runningStageIds: [], latestExecutionId: null, metrics });
      return stagesOf(progress)[0]?.history[0]?.reason;
    };
    const fromReview = { stage: 'review', attempt: 1 };

    it('says nothing for a start, and nothing for a continue without a source', () => {
      expect(reasonOfSecond('start', false)).toBeNull();
      expect(reasonOfSecond('start', true)).toBeNull();
      expect(reasonOfSecond('continue', false)).toBeNull();
    });

    it('says the human answered for answers, whatever else is recorded', () => {
      expect(reasonOfSecond('answers', false)).toEqual({ kind: 'answer' });
      expect(reasonOfSecond('answers', true)).toEqual({ kind: 'answer' });
    });

    it('says revise only for a continue whose source decided revise, else routed', () => {
      expect(reasonOfSecond('continue', true)).toEqual({ kind: 'revise', from: fromReview });
      expect(reasonOfSecond('continue', true, 'rejected')).toEqual({ kind: 'routed', from: fromReview });
      expect(reasonOfSecond('continue', true, null)).toEqual({ kind: 'routed', from: fromReview });
    });

    it('keeps only the routed source when turn_kind is missing or unrecognized', () => {
      expect(reasonOfSecond(null, true)).toEqual({ kind: 'routed', from: fromReview });
      expect(reasonOfSecond('later', true)).toEqual({ kind: 'routed', from: fromReview });
      expect(reasonOfSecond(null, false)).toBeNull();
    });
  });

  it('marks an attempt that ended by asking a question, and no other', () => {
    const progress = buildProgress({
      executions: [
        { ...execution('0001-plan--attempt-01', 'plan', 1, 'completed'), outcomeStatus: 'question' },
        { ...execution('0002-plan--attempt-02', 'plan', 2, 'completed'), outcomeStatus: 'complete' },
      ],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
    });
    expect(stagesOf(progress)[0]?.history.map((attempt) => attempt.asked)).toEqual([true, false]);
  });

  describe('totals', () => {
    const run = (metrics?: MetricsExecution[], wallSeconds?: number | null) => buildProgress({
      executions: [
        execution('0001-plan--attempt-01', 'plan', 1, 'completed'),
        execution('0002-plan--attempt-02', 'plan', 2, 'completed'),
      ],
      plan: plan(['plan']),
      runningStageIds: [],
      latestExecutionId: null,
      metrics,
      wallSeconds,
    });
    const totalsOf = (progress: SessionProgress) => (progress.kind === 'empty' ? null : progress.totals);

    it('adds up each field over the attempts, active time from the attempts and wall time from metrics totals', () => {
      const progress = run([
        measured('0001-plan--attempt-01', { wallSeconds: 60, usage: usageOf({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 10, costUsd: 0.25 }) }),
        measured('0002-plan--attempt-02', { wallSeconds: 40, usage: usageOf({ inputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0, costUsd: 0.5 }) }),
      ], 500);
      expect(totalsOf(progress)).toEqual({
        activeSeconds: 100,
        wallSeconds: 500,
        usage: usageOf({ inputTokens: 4, outputTokens: 2, cacheReadTokens: 15, cacheWriteTokens: 0, costUsd: 0.75 }),
        costMissing: 0,
      });
    });

    it('counts the attempts without a cost, and leaves a field no attempt reports null', () => {
      const progress = run([
        measured('0001-plan--attempt-01', { usage: usageOf({ costUsd: 1 }) }),
        measured('0002-plan--attempt-02', { usage: usageOf({ inputTokens: 3 }) }),
      ]);
      expect(totalsOf(progress)).toEqual({
        activeSeconds: null,
        wallSeconds: null,
        usage: usageOf({ inputTokens: 3, costUsd: 1 }),
        costMissing: 1,
      });
    });

    it('counts an attempt that has no metrics entry as missing its cost', () => {
      const progress = run([measured('0001-plan--attempt-01', { usage: usageOf({ costUsd: 1 }) })]);
      expect(totalsOf(progress)).toMatchObject({ usage: usageOf({ costUsd: 1 }), costMissing: 1 });
    });

    it('has no usage without metrics, and the same totals for role-session rows', () => {
      expect(totalsOf(run())).toEqual({ activeSeconds: null, wallSeconds: null, usage: null, costMissing: 2 });
      const roles = buildProgress({
        executions: [execution('0001-developer--attempt-01', 'developer', 1, 'completed')],
        plan: { kind: 'missing' },
        runningStageIds: [],
        latestExecutionId: null,
        metrics: [measured('0001-developer--attempt-01', { wallSeconds: 5, usage: usageOf({ costUsd: 2 }) })],
        wallSeconds: 9,
      });
      expect(totalsOf(roles)).toEqual({
        activeSeconds: 5, wallSeconds: 9, usage: usageOf({ costUsd: 2 }), costMissing: 0,
      });
    });
  });

  it('gives the same facts to execution rows of a role session', () => {
    const progress = buildProgress({
      executions: [{ ...execution('0001-developer--attempt-01', 'developer', 1, 'completed'), model: 'm', effort: 'high' }],
      plan: { kind: 'missing' },
      runningStageIds: [],
      latestExecutionId: null,
      metrics: [measured('0001-developer--attempt-01', { wallSeconds: 5, usage: usage(1, 2) })],
    });
    expect(progress.kind === 'executions' ? progress.rows[0] : null).toMatchObject({ model: 'm', effort: 'high', wallSeconds: 5, usage: usage(1, 2) });
  });
});
});
