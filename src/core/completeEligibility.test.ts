import { describe, expect, it } from 'vitest';

import { isCompletable } from './completeEligibility';
import type { DisplayStateName, SessionSnapshot } from './model';
import { capturedDir, snapshotFromDir, syntheticDir } from './testHelpers';

function withState(snapshot: SessionSnapshot, state: DisplayStateName): SessionSnapshot {
  return { ...snapshot, displayState: { ...snapshot.displayState, state } };
}

describe('isCompletable', () => {
  const workflow = snapshotFromDir(capturedDir('handoff-source'));

  it('accepts a stopped workflow session in each state the CLI completes', () => {
    for (const state of ['stopped', 'failed', 'blocked', 'question', 'cancelled'] as const) {
      expect(isCompletable(withState(workflow, state)), state).toBe(true);
    }
  });

  it('rejects running, prepared, completed and unknown sessions', () => {
    for (const state of ['running', 'prepared', 'completed', 'unknown'] as const) {
      expect(isCompletable(withState(workflow, state)), state).toBe(false);
    }
  });

  it('rejects a role session, which the CLI refuses', () => {
    const role = snapshotFromDir(capturedDir('question-answered'));
    expect(role.manifest?.role).toBe('planner');
    expect(isCompletable(withState(role, 'stopped'))).toBe(false);
  });

  it('treats a session without a manifest as a workflow session', () => {
    expect(isCompletable(withState({ ...snapshotFromDir(syntheticDir('running-questions')), manifest: null }, 'stopped'))).toBe(true);
  });
});
