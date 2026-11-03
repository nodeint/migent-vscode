import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { aggregateSessionsState, isCounted, isRetentionExempt, summarize } from './attention';
import { deriveDisplayState } from './displayState';
import type { LockProbe, ScanOutcome, SessionSnapshot } from './model';
import { readStatus } from './statusReader';
import { capturedDir, syntheticDir } from './testHelpers';

const alive: LockProbe = { kind: 'alive', pid: 1, host: 'h', heartbeatAt: 't', foreignHost: false };

/** Build a snapshot from a status.json in a fixture directory, with the given lock. */
function fromFixture(dir: string, lock: LockProbe = { kind: 'none' }): SessionSnapshot {
  const read = readStatus(path.join(dir, 'status.json'));
  if (read.kind !== 'ok') throw new Error('status did not read');
  return {
    sessionId: path.basename(dir),
    manifest: null,
    status: read.status,
    statusError: false,
    lock,
    displayState: deriveDisplayState({ status: read.status, statusError: null, manifest: 'ok' }, lock),
  };
}

function bare(state: 'unknown' | 'stopped' | 'failed' | 'completed'): SessionSnapshot {
  const statusByState = { unknown: 'weird', stopped: 'active', failed: 'active', completed: 'completed' } as const;
  const base = fromFixture(capturedDir('question-answered'));
  const status = { ...base.status!, status: statusByState[state], latestExecutionStatus: state === 'failed' ? 'failed' : 'completed' };
  return {
    ...base,
    status,
    displayState: deriveDisplayState({ status, statusError: null, manifest: 'ok' }, { kind: 'none' }),
  };
}

describe('isCounted and summarize', () => {
  it('counts Blocked, Failed, Question and pending questions; never Unknown; Stopped only through questions', () => {
    expect(isCounted(fromFixture(capturedDir('question-pending')))).toBe(true);
    expect(isCounted(fromFixture(syntheticDir('blocked-questions')))).toBe(true);
    expect(isCounted(bare('failed'))).toBe(true);
    expect(isCounted(bare('stopped'))).toBe(false);
    expect(isCounted(bare('unknown'))).toBe(false);
    expect(isCounted(bare('completed'))).toBe(false);
    // A stopped session that still lists pending questions is counted through them.
    const stoppedAsking = fromFixture(syntheticDir('running-questions'));
    expect(stoppedAsking.displayState.state).toBe('stopped');
    expect(isCounted(stoppedAsking)).toBe(true);
  });

  it('counts a session once even with a blocker and questions, and totals pending questions', () => {
    const blocked = fromFixture(syntheticDir('blocked-questions'));
    expect(blocked.status?.blockedByExecutionIds).toHaveLength(1);
    const summary = summarize([
      blocked,
      fromFixture(capturedDir('question-pending')),
      fromFixture(syntheticDir('running-questions'), alive),
      bare('failed'),
      bare('stopped'),
      bare('unknown'),
      bare('completed'),
    ]);
    expect(summary).toEqual({
      running: 1,
      // blocked + question + running-with-questions + failed
      needsAttention: 4,
      blocked: 1,
      failed: 1,
      asking: 1,
      // 2 (blocked) + 3 (question) + 1 (running)
      pendingQuestions: 6,
    });
  });
});

describe('isRetentionExempt', () => {
  it('exempts running, question, blocked and pending-question sessions only', () => {
    expect(isRetentionExempt(fromFixture(syntheticDir('running-questions'), alive))).toBe(true);
    expect(isRetentionExempt(fromFixture(capturedDir('question-pending')))).toBe(true);
    expect(isRetentionExempt(fromFixture(syntheticDir('blocked-questions')))).toBe(true);
    expect(isRetentionExempt(fromFixture(syntheticDir('running-questions')))).toBe(true);
    expect(isRetentionExempt(bare('failed'))).toBe(false);
    expect(isRetentionExempt(bare('stopped'))).toBe(false);
    expect(isRetentionExempt(bare('completed'))).toBe(false);
  });
});

describe('aggregateSessionsState', () => {
  const scan = (overrides: Partial<ScanOutcome>): ScanOutcome => ({
    state: 'ok',
    error: null,
    discovered: [],
    eligible: [],
    pending: [],
    ...overrides,
  });

  it('is loading until the first load finished, regardless of scans', () => {
    expect(aggregateSessionsState([scan({ eligible: ['a'] })], false)).toBe('loading');
  });

  it('reports error over ready, ready over empty, and empty for no sessions or no projects', () => {
    expect(aggregateSessionsState([scan({ state: 'unreadable', error: 'EACCES' }), scan({ eligible: ['a'] })], true)).toBe(
      'error',
    );
    expect(aggregateSessionsState([scan({ state: 'empty' }), scan({ eligible: ['a'], discovered: ['a'] })], true)).toBe(
      'ready',
    );
    expect(aggregateSessionsState([scan({ state: 'missing' }), scan({ discovered: ['p'], pending: ['p'] })], true)).toBe(
      'empty',
    );
    expect(aggregateSessionsState([], true)).toBe('empty');
  });
});
