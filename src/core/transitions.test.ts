import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import type { SessionSnapshot } from './model';
import { parseStatus } from './statusReader';
import {
  FAILURE_REPORT_BUTTON,
  failureButtons,
  type FailureDetails,
  failureDetails,
  TransitionTracker,
} from './transitions';

function snapshot(raw: Record<string, unknown>, id = 's1'): SessionSnapshot {
  const status = parseStatus(JSON.stringify(raw));
  return {
    sessionId: id,
    manifest: null,
    status,
    statusError: false,
    lock: { kind: 'none' },
    displayState: deriveDisplayState({ status, statusError: null, manifest: 'ok' }, { kind: 'none' }),
    titleOverride: null,
    replyTargets: [],
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

  it('announces a failed execution that hit client quota as an ordinary failure', () => {
    const exhausted = {
      status: 'active',
      latest_execution_id: '0002-plan--attempt-02',
      latest_execution_status: 'failed',
      latest_provider_event: { event: 'provider.quota', execution_id: '0002-plan--attempt-02' },
    };
    expect(new TransitionTracker().observe('p', snapshot(exhausted), false)?.kind).toBe('failed');
  });

  it('reports a completion, but not a pending-question session or a stopped session with a quota event', () => {
    const tracker = new TransitionTracker();
    const stoppedQuota = {
      status: 'active',
      latest_provider_event: { event: 'provider.quota', execution_id: '0001-plan--attempt-01' },
    };
    expect(tracker.observe('p', snapshot(stoppedQuota), false)).toBeNull();
    expect(tracker.observe('p', snapshot(completed), false)?.kind).toBe('completed');
    expect(tracker.observe('p', snapshot({ status: 'question' }), false)).toBeNull();
  });
});

describe('failureButtons', () => {
  const details = (overrides: Partial<FailureDetails> = {}): FailureDetails => ({
    cause: null,
    file: null,
    failureReport: null,
    stageId: null,
    attempt: null,
    ...overrides,
  });

  it('offers the failure report only when the execution wrote one', () => {
    expect(failureButtons(details({ failureReport: '/f/failure.md', file: { kind: 'verify', absolutePath: '/f/v' } })))
      .toEqual(['Continue', FAILURE_REPORT_BUTTON, 'Open verify', 'View log']);
    expect(failureButtons(details({ file: { kind: 'response', absolutePath: '/f/r' } })))
      .toEqual(['Continue', 'Open response', 'View log']);
    expect(failureButtons(undefined)).toEqual(['Continue', 'View log']);
  });

  it('labels the handoff file button', () => {
    expect(failureButtons(details({ file: { kind: 'handoff', absolutePath: '/f/h' } })))
      .toEqual(['Continue', 'Open handoff', 'View log']);
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

  it('points at handoff.json for an invalid handoff file, and falls back to the response when it is absent', () => {
    const present = execution(
      { failure_reason: 'handoff_file_invalid', error: 'schema_version is required' },
      { 'response.md': 'x', 'handoff.json': '{}' },
    );
    const details = failureDetails(present.dir, present.id);
    expect(details.cause).toBe('handoff file invalid: schema_version is required');
    expect(details.file).toEqual({
      kind: 'handoff',
      absolutePath: path.join(present.dir, 'executions', present.id, 'handoff.json'),
    });
    const absent = execution({ failure_reason: 'handoff_file_invalid' }, { 'response.md': 'x' });
    expect(failureDetails(absent.dir, absent.id).file?.kind).toBe('response');
  });

  it('prefers handoff.json over verify output when response.md is absent', () => {
    const { dir, id } = execution(
      { failure_reason: 'handoff_file_invalid' },
      { 'handoff.json': '{}', [path.join('turns', 'turn-01', 'verify.md')]: 'v' },
    );
    expect(failureDetails(dir, id).file?.kind).toBe('handoff');
  });

  it('keeps pointing at response.md for other reasons even when handoff.json exists', () => {
    const { dir, id } = execution({ failure_reason: 'provider_failed' }, { 'response.md': 'x', 'handoff.json': '{}' });
    expect(failureDetails(dir, id).file?.kind).toBe('response');
  });

  it.each(['stage_output_missing', 'response_contract_invalid'])('words the cause of %s', (reason) => {
    const { dir, id } = execution({ failure_reason: reason, error: 'detail' }, { 'response.md': 'x' });
    expect(failureDetails(dir, id).cause).toBe(`${reason.replaceAll('_', ' ')}: detail`);
  });

  it('offers the failure report only when the execution wrote one', () => {
    const withReport = execution({ failure_reason: 'provider_failed' }, { 'failure.md': '# Failure' });
    expect(failureDetails(withReport.dir, withReport.id).failureReport).toBe(
      path.join(withReport.dir, 'executions', withReport.id, 'failure.md'),
    );
    const withoutReport = execution({ failure_reason: 'provider_failed' }, {});
    expect(failureDetails(withoutReport.dir, withoutReport.id).failureReport).toBeNull();
  });

  it('reports no cause or file rather than guessing', () => {
    expect(failureDetails(os.tmpdir(), null)).toEqual({
      cause: null,
      file: null,
      failureReport: null,
      stageId: null,
      attempt: null,
    });
    const { dir, id } = execution({}, {});
    expect(failureDetails(dir, id)).toMatchObject({ cause: null, file: null, failureReport: null });
  });
});
