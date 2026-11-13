import { describe, expect, it } from 'vitest';

import type { DisplayStateName, ExecutionSnapshot, SessionSnapshot } from './model';
import { overviewActions } from './overviewActions';

interface SnapshotInput {
  state: DisplayStateName;
  canReply?: boolean;
  role?: string;
  writable?: boolean;
}

function snapshot(input: SnapshotInput): SessionSnapshot {
  return {
    sessionId: 's',
    displayState: { state: input.state, icon: 'x', writable: input.writable ?? true },
    replyTargets: input.canReply === true
      ? [{
          executionId: '0001-plan--attempt-01',
          stageId: input.role === undefined ? 'plan' : null,
          attempt: 1,
          kind: input.role === undefined ? 'blocker' : 'roleTurn',
        }]
      : [],
    manifest: { role: input.role ?? null },
    status: {
      latestStageId: null,
      runningStages: [],
      questions: [],
      blockedByExecutionIds: [],
      latestProviderEvent: null,
    },
  } as unknown as SessionSnapshot;
}

function execution(hasFailureReport: boolean): ExecutionSnapshot {
  return {
    id: '0001-plan--attempt-01',
    order: 1,
    stage: 'plan',
    attempt: 1,
    status: 'failed',
    decision: null,
    blocker: null,
    client: null,
    model: null,
    effort: null,
    error: null,
    hasFailureReport,
    kind: null,
    createdAt: null,
    completedAt: null,
  };
}

describe('overviewActions', () => {
  it('Question offers Answer questions as the only action', () => {
    expect(overviewActions(snapshot({ state: 'question' }), null)).toEqual({
      primary: 'answerQuestions',
      secondary: [],
    });
  });

  it('Blocked offers Reply when one can be sent, with View log beside it', () => {
    expect(overviewActions(snapshot({ state: 'blocked', canReply: true }), null)).toEqual({
      primary: 'reply',
      secondary: ['showLog'],
    });
    expect(overviewActions(snapshot({ state: 'blocked' }), null)).toEqual({
      primary: null,
      secondary: ['showLog'],
    });
  });

  it('Running offers View log as primary and Stop as the danger secondary', () => {
    expect(overviewActions(snapshot({ state: 'running' }), null)).toEqual({
      primary: 'showLog',
      secondary: ['stop'],
    });
  });

  it('Failed offers Continue, adds Open failure only with a report, and keeps View log', () => {
    expect(overviewActions(snapshot({ state: 'failed' }), execution(true))).toEqual({
      primary: 'continue',
      secondary: ['openFailure', 'showLog'],
    });
    expect(overviewActions(snapshot({ state: 'failed' }), execution(false))).toEqual({
      primary: 'continue',
      secondary: ['showLog'],
    });
    expect(overviewActions(snapshot({ state: 'failed' }), null)).toEqual({
      primary: 'continue',
      secondary: ['showLog'],
    });
  });

  it('Stopped offers Continue with Reply, Complete and View log as applicable', () => {
    expect(overviewActions(snapshot({ state: 'stopped', canReply: true }), null)).toEqual({
      primary: 'continue',
      secondary: ['reply', 'completeSession', 'showLog'],
    });
    expect(overviewActions(snapshot({ state: 'stopped' }), null)).toEqual({
      primary: 'continue',
      secondary: ['completeSession', 'showLog'],
    });
  });

  it('Cancelled offers Continue with the same secondary actions', () => {
    expect(overviewActions(snapshot({ state: 'cancelled', canReply: true }), null)).toEqual({
      primary: 'continue',
      secondary: ['reply', 'completeSession', 'showLog'],
    });
    expect(overviewActions(snapshot({ state: 'cancelled' }), null)).toEqual({
      primary: 'continue',
      secondary: ['completeSession', 'showLog'],
    });
  });

  it('Prepared offers Start with Open task', () => {
    expect(overviewActions(snapshot({ state: 'prepared' }), null)).toEqual({
      primary: 'start',
      secondary: ['openTask'],
    });
  });

  it('Completed offers no primary, and Reply only for a completed role session', () => {
    expect(overviewActions(snapshot({ state: 'completed', canReply: true, role: 'reviewer' }), null)).toEqual({
      primary: null,
      secondary: ['reply'],
    });
    expect(overviewActions(snapshot({ state: 'completed' }), null)).toEqual({
      primary: null,
      secondary: [],
    });
  });

  it('Unknown offers no action', () => {
    expect(overviewActions(snapshot({ state: 'unknown' }), null)).toEqual({
      primary: null,
      secondary: [],
    });
  });

  it('keeps the table for a foreign lock: the commands, not this rule, block the write', () => {
    expect(overviewActions(snapshot({ state: 'blocked', canReply: true, writable: false }), null)).toEqual({
      primary: 'reply',
      secondary: ['showLog'],
    });
  });
});
