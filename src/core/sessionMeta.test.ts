import { describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import { buildSessionMeta, NO_SESSION_META } from './sessionMeta';

function snapshot(state: 'running' | 'completed', status: Record<string, unknown>): SessionSnapshot {
  return {
    sessionId: 's',
    displayState: { state },
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
    });
  });

  it('prefers the running stage and marks a running session', () => {
    const meta = buildSessionMeta(snapshot('running', { runningStages: [{ stageId: 'implement' }] }));
    expect(meta).toMatchObject({ stageId: 'implement', isRunning: true });
  });

  it('falls back to the manifest for the creation time', () => {
    expect(buildSessionMeta(snapshot('completed', { createdAt: null })).createdAt).toBe('manifest-created');
  });
});
