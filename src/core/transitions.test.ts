import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import type { SessionSnapshot } from './model';
import { parseStatus } from './statusReader';
import { failureDetails, TransitionTracker } from './transitions';

function snapshot(raw: Record<string, unknown>, id = 's1'): SessionSnapshot {
  const status = parseStatus(JSON.stringify(raw));
  return {
    sessionId: id,
    manifest: null,
    status,
    statusError: false,
    lock: { kind: 'none' },
    displayState: deriveDisplayState({ status, statusError: null, manifest: 'ok' }, { kind: 'none' }),
  };
}

const failed = (execution: string) => ({
  status: 'active',
  latest_execution_id: execution,
  latest_execution_status: 'failed',
});
const blocked = {
  status: 'blocked',
  latest_execution_id: '0001-plan--attempt-01',
  blocked_by_execution_ids: ['0001-plan--attempt-01'],
};
const completed = { status: 'completed', latest_execution_id: '0003-x--attempt-01' };

describe('TransitionTracker', () => {
  it('stays silent for what exists when it starts, then notifies each new condition once', () => {
    const tracker = new TransitionTracker();
    expect(tracker.observe('p', snapshot(blocked), true)).toBeNull();
    expect(tracker.observe('p', snapshot(blocked), false)).toBeNull();
    const fresh = tracker.observe('p', snapshot(failed('0002-plan--attempt-02')), false);
    expect(fresh).toMatchObject({ kind: 'failed', executionId: '0002-plan--attempt-02' });
    expect(tracker.observe('p', snapshot(failed('0002-plan--attempt-02')), false)).toBeNull();
    expect(tracker.observe('p', snapshot(failed('0003-plan--attempt-03')), false)?.kind).toBe('failed');
  });

  it('keeps sessions and projects apart', () => {
    const tracker = new TransitionTracker();
    expect(tracker.observe('p', snapshot(blocked, 'a'), false)?.sessionId).toBe('a');
    expect(tracker.observe('p', snapshot(blocked, 'b'), false)?.sessionId).toBe('b');
    expect(tracker.observe('q', snapshot(blocked, 'a'), false)?.project).toBe('q');
  });

  it('announces a failed execution that is a quota wait as a quota wait', () => {
    const exhausted = {
      status: 'active',
      latest_execution_id: '0002-plan--attempt-02',
      latest_execution_status: 'failed',
      latest_provider_event: { event: 'provider.quota', execution_id: '0002-plan--attempt-02' },
    };
    expect(new TransitionTracker().observe('p', snapshot(exhausted), false)?.kind).toBe('quota');
  });

  it('reports a quota wait and a completion, but not a pending-question session', () => {
    const tracker = new TransitionTracker();
    const quota = {
      status: 'active',
      latest_provider_event: { event: 'provider.quota', execution_id: '0001-plan--attempt-01' },
    };
    expect(tracker.observe('p', snapshot(quota), false)?.kind).toBe('quota');
    expect(tracker.observe('p', snapshot(completed), false)?.kind).toBe('completed');
    expect(tracker.observe('p', snapshot({ status: 'question' }), false)).toBeNull();
  });
});

describe('failureDetails', () => {
  function execution(record: Record<string, unknown>, files: Record<string, string>): { dir: string; id: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-fail-'));
    const id = '0002-plan--attempt-02';
    const root = path.join(dir, 'executions', id);
    mkdirSync(path.join(root, 'turns', 'turn-01'), { recursive: true });
    writeFileSync(path.join(root, 'execution.json'), JSON.stringify({ stage_id: 'plan', stage_attempt: 2, ...record }));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
    return { dir, id };
  }

  it('names the cause, stage, attempt and the exact response file', () => {
    const { dir, id } = execution({ failure_reason: 'provider_failed', error: 'exited\nwith code 1' }, { 'response.md': 'x' });
    const details = failureDetails(dir, id);
    expect(details).toMatchObject({ cause: 'provider failed: exited with code 1', stageId: 'plan', attempt: 2 });
    expect(details.file).toEqual({ kind: 'response', absolutePath: path.join(dir, 'executions', id, 'response.md') });
  });

  it('points at the verify file when the failure is a verify failure', () => {
    const { dir, id } = execution(
      { failure_reason: 'verify_failed' },
      { 'response.md': 'x', [path.join('turns', 'turn-01', 'verify.md')]: 'v' },
    );
    expect(failureDetails(dir, id).file?.kind).toBe('verify');
  });

  it('reports no cause or file rather than guessing', () => {
    expect(failureDetails(os.tmpdir(), null)).toEqual({ cause: null, file: null, stageId: null, attempt: null });
    const { dir, id } = execution({}, {});
    expect(failureDetails(dir, id)).toMatchObject({ cause: null, file: null });
  });
});
