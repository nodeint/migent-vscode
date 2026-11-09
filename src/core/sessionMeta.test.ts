import { describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import { buildSessionMeta, NO_SESSION_META } from './sessionMeta';

function snapshot(state: 'running' | 'completed', status: Record<string, unknown>): SessionSnapshot {
  return {
    sessionId: 's',
    displayState: { state },
    replyTargets: [],
    manifest: { createdAt: 'manifest-created' },
    status: {
      createdAt: '2026-11-01T10:00:00.000+00:00',
      updatedAt: '2026-11-01T10:09:48.000+00:00',
      latestStageId: 'plan',
      runningStages: [],
      questions: [],
      ...status,
    },
  } as unknown as SessionSnapshot;
}

describe('buildSessionMeta', () => {
  it('is empty for a session that is not loaded', () => {
    expect(buildSessionMeta(undefined)).toEqual(NO_SESSION_META);
  });

  it('reads the timestamps, the latest stage and the pending question count', () => {
    const meta = buildSessionMeta(snapshot('completed', { questions: [{}, {}] }));
    expect(meta).toEqual({
      stageId: 'plan',
      createdAt: '2026-11-01T10:00:00.000+00:00',
      updatedAt: '2026-11-01T10:09:48.000+00:00',
      isRunning: false,
      pendingQuestions: 2,
      canComplete: false,
      canReply: false,
    });
  });

  it('allows Complete only for a stopped workflow session, never a running, completed or role session', () => {
    const stopped = (extra: Record<string, unknown> = {}): SessionSnapshot => {
      const base = snapshot('completed', {});
      return { ...base, displayState: { state: 'stopped' }, ...extra } as unknown as SessionSnapshot;
    };
    expect(buildSessionMeta(stopped()).canComplete).toBe(true);
    expect(buildSessionMeta(stopped({ manifest: { createdAt: 'x', role: 'planner' } })).canComplete).toBe(false);
    expect(buildSessionMeta(snapshot('running', {})).canComplete).toBe(false);
    expect(buildSessionMeta(snapshot('completed', {})).canComplete).toBe(false);
  });

  it('offers Reply exactly when the store attached reply targets', () => {
    const target = { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, kind: 'blocker' };
    const withTarget = { ...snapshot('completed', {}), replyTargets: [target] } as unknown as SessionSnapshot;
    expect(buildSessionMeta(withTarget).canReply).toBe(true);
    expect(buildSessionMeta(snapshot('completed', {})).canReply).toBe(false);
  });

  it('prefers the running stage and marks a running session', () => {
    const meta = buildSessionMeta(snapshot('running', { runningStages: [{ stageId: 'implement' }] }));
    expect(meta).toMatchObject({ stageId: 'implement', isRunning: true });
  });

  it('falls back to the manifest for the creation time', () => {
    expect(buildSessionMeta(snapshot('completed', { createdAt: null })).createdAt).toBe('manifest-created');
  });
});
