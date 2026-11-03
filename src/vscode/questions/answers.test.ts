import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OperationGate } from '../../core/operationGate';
import { sessionDir } from '../../core/paths';
import { readQuestions } from '../../core/questions';
import { capturedDir } from '../../core/testHelpers';
import { type AnswerRequest, AnswerSubmitter } from '../answers';
import type { ControlService } from '../control';
import type { ProjectContext } from '../projects';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeControl(): ControlService {
  const gate = new OperationGate();
  return {
    gate,
    sessionKey: (project: string, sessionId: string) => ({ kind: 'session', project, sessionId }),
  } as unknown as ControlService;
}

function writeRecord(dir: string, batchKey: string, sessionId: string, extra: object = {}): void {
  const name = createHash('sha256').update(batchKey).digest('hex').slice(0, 32);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `uncertain-${name}.json`),
    JSON.stringify({ project: 'proj', sessionId, batchKey, reply: { 1: 'B', 2: ['A', 'C'] }, replyFile: path.join(dir, 'r.json'), ...extra }),
  );
}

describe('AnswerSubmitter.restore', () => {
  it('re-takes the gate of every unresolved submission at startup, before any panel opens', () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'migent-answers-')), 'answers');
    dirs.push(path.dirname(dir));
    writeRecord(dir, 'proj#s1#plan#e1', 's1');
    writeRecord(dir, 'proj#s1#test#e2', 's1');
    const control = fakeControl();
    const submitter = new AnswerSubmitter(control, dir);
    // Ordinary controls (Continue, another stage's panel) find the session busy.
    expect(control.gate.current('proj', 's1')?.phase).toBe('Sending reply');
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).toBeNull();
    // Other sessions are unaffected, and the restored submission is available to its panel.
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's2'))).not.toBeNull();
    expect(submitter.pending('proj#s1#plan#e1')).toEqual({ 1: 'B', 2: ['A', 'C'] });
    expect(submitter.pending('proj#s1#other#e9')).toBeNull();
  });

  it('holds nothing when storage is empty or missing, and ignores damaged records', () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'migent-answers-')), 'answers');
    dirs.push(path.dirname(dir));
    const control = fakeControl();
    new AnswerSubmitter(control, dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'uncertain-bad.json'), '{ nope');
    new AnswerSubmitter(control, dir);
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).not.toBeNull();
  });
});

describe('AnswerSubmitter.restore with unfinished writes', () => {
  it('ignores and removes temporary records and orphan reply files, keeping committed ones', () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'migent-answers-')), 'answers');
    dirs.push(path.dirname(dir));
    mkdirSync(dir, { recursive: true });
    const record = JSON.stringify({ project: 'proj', sessionId: 's1', batchKey: 'k', reply: { 1: 'A' }, replyFile: 'r' });
    writeFileSync(path.join(dir, 'uncertain-abc.json.1234.tmp'), record);
    writeFileSync(path.join(dir, 'reply-orphan.json'), '{}');
    const control = fakeControl();
    const submitter = new AnswerSubmitter(control, dir);
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).not.toBeNull();
    expect(submitter.pending('k')).toBeNull();
    expect(existsSync(path.join(dir, 'uncertain-abc.json.1234.tmp'))).toBe(false);
    expect(existsSync(path.join(dir, 'reply-orphan.json'))).toBe(false);
  });
});

/** A pending batch from the captured fixture, in a temporary project, with a record for it. */
interface Fixture {
  submitter: AnswerSubmitter;
  request: AnswerRequest;
  dir: string;
  control: ControlService;
}

function pendingFixture(extra: object): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migent-answers-'));
  dirs.push(root);
  const session = sessionDir(root, 's1');
  mkdirSync(session, { recursive: true });
  copyFileSync(path.join(capturedDir('question-pending'), 'questions.json'), path.join(session, 'questions.json'));
  const read = readQuestions(session);
  const first = read.kind === 'ok' ? read.questions[0] : undefined;
  const target = { executionId: first?.executionId ?? '', stageId: first?.stageId ?? null };
  const dir = path.join(root, 'answers');
  const batchKey = 'proj#s1#batch';
  writeRecord(dir, batchKey, 's1', extra);
  const control = fakeControl();
  const context = { key: 'proj', root, store: { refreshSession: () => undefined } } as unknown as ProjectContext;
  const request = { context, sessionId: 's1', target, reply: { 1: 'B' }, cliStage: null, fingerprint: 'f', batchKey };
  return { submitter: new AnswerSubmitter(control, dir), request, dir, control };
}

describe('AnswerSubmitter.recheck', () => {
  it('does not release a submission whose CLI is still running', async () => {
    const { submitter, request, dir, control } = pendingFixture({ pid: process.pid });
    await expect(submitter.recheck(request)).resolves.toEqual({
      reconciliation: { kind: 'unconfirmed' },
      cleanupError: null,
    });
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).toBeNull();
    expect(submitter.pending(request.batchKey)).not.toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  it('treats pending as a rejection once the CLI is gone, and releases the session', async () => {
    const { submitter, request, control } = pendingFixture({});
    const result = await submitter.recheck(request);
    expect(result.reconciliation.kind).toBe('pending');
    expect(result.cleanupError).toBeNull();
    expect(submitter.pending(request.batchKey)).toBeNull();
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).not.toBeNull();
  });

  it('reports a cleanup failure without hiding the outcome or keeping the session held', async () => {
    const { submitter, request, dir, control } = pendingFixture({});
    const file = readdirSync(dir).find((name) => name.startsWith('uncertain-')) ?? '';
    rmSync(path.join(dir, file));
    mkdirSync(path.join(dir, file));
    const result = await submitter.recheck(request);
    expect(result.reconciliation.kind).toBe('pending');
    expect(result.cleanupError).not.toBeNull();
    expect(control.gate.tryAcquire(control.sessionKey('proj', 's1'))).not.toBeNull();
  });
});
