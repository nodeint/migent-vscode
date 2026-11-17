import { describe, expect, it } from 'vitest';

import {
  answerEntry,
  makeSession,
  pendingRow,
  putEvents,
  putExecution,
  putInput,
  putJson,
  putQuestions,
} from './humanInputTestSupport';
import { batchFingerprint, reconcileSubmission, verifyBatch } from './questionAnswers';
import { questionAttempts } from './questionHistory';
import { parseQuestionsFile, type QuestionEntry, type QuestionItem, readQuestions } from './questions';

const PLAN_1 = '0001-plan--attempt-01';
const PLAN_2 = '0002-plan--attempt-02';
const TEST_3 = '0003-test--attempt-01';

/** The batch a user saw. `status.json` no longer lists pending questions (B6), so a test builds it from the rows. */
function summaryOf(rows: readonly Record<string, unknown>[]): QuestionItem[] {
  const read = parseQuestionsFile(
    JSON.stringify({ schema_version: 1, questions: rows.map((row) => ({ ...row, status: 'pending', answer: null })) }),
  );
  return read.kind === 'ok' ? read.questions.map((entry) => entry.item) : [];
}

function records(dir: string): QuestionEntry[] {
  const read = readQuestions(dir);
  if (read.kind !== 'ok') throw new Error(`history did not read: ${read.kind}`);
  return read.questions;
}

const statusesOf = (list: readonly QuestionEntry[]) =>
  list.map((entry) => [entry.item.execution_id, entry.item.id, entry.status]);

describe('readQuestions over Migent 0.8.0 files', () => {
  it('is missing without any question file', () => {
    expect(readQuestions(makeSession())).toEqual({ kind: 'missing' });
  });

  // B6: no batch is listed pending any more, so an execution file without an answer reads as superseded.
  it('lists an unanswered batch from the execution file, with the header fields', () => {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    const list = records(dir);
    expect(statusesOf(list)).toEqual([[PLAN_1, '1', 'superseded'], [PLAN_1, '2', 'superseded']]);
    expect(list[0]).toMatchObject({ item: { stage_id: 'plan', recipient: 'human' }, answer: null });
  });

  it('lists the batch of an execution that ended by asking as pending until a later attempt of its stage exists', () => {
    const dir = makeSession();
    putExecution(dir, PLAN_1, { outcomeStatus: 'question' });
    putQuestions(dir, PLAN_1);
    expect(statusesOf(records(dir))).toEqual([[PLAN_1, '1', 'pending'], [PLAN_1, '2', 'pending']]);
    putExecution(dir, PLAN_2);
    expect(statusesOf(records(dir))).toEqual([[PLAN_1, '1', 'superseded'], [PLAN_1, '2', 'superseded']]);
  });

  it('shows the answer from input.json', () => {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    putInput(dir, PLAN_2, {
      respondsTo: PLAN_1,
      recordedAt: '2026-11-01T11:00:01.000Z',
      answers: [answerEntry('1', ['A']), answerEntry('2', [], 'free')],
    });
    const list = records(dir);
    expect(statusesOf(list)).toEqual([[PLAN_1, '1', 'answered'], [PLAN_1, '2', 'answered']]);
    expect(list[0]).toMatchObject({ answer: { selected: ['A'], text: null }, answeredAt: '2026-11-01T11:00:01.000Z' });
    expect(list[1]?.answer).toEqual({ selected: [], text: 'free' });
  });

  it('shows an answer that only the event recorded', () => {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    putEvents(dir, [
      { executionId: PLAN_1, stageId: 'plan', timestamp: 't1', data: { answers: [answerEntry('1', ['B']), answerEntry('2', ['A'])] } },
    ]);
    const list = records(dir);
    expect(list.map((item) => [item.status, item.answer?.selected])).toEqual([['answered', ['B']], ['answered', ['A']]]);
  });

  it('marks every batch superseded when no answer exists', () => {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    putQuestions(dir, PLAN_2);
    const list = records(dir);
    expect(statusesOf(list)).toEqual([
      [PLAN_1, '1', 'superseded'],
      [PLAN_1, '2', 'superseded'],
      [PLAN_2, '1', 'superseded'],
      [PLAN_2, '2', 'superseded'],
    ]);
  });

  it('reports a malformed execution file as that execution only, and still reads the others', () => {
    const dir = makeSession();
    putJson(dir, `executions/${PLAN_1}/questions.json`, '{ nope');
    putQuestions(dir, PLAN_2);
    const read = readQuestions(dir);
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.malformed.map((item) => [item.executionId, item.stageId])).toEqual([[PLAN_1, 'plan']]);
    expect(read.questions.map((entry) => entry.item.execution_id)).toEqual([PLAN_2, PLAN_2]);
  });

  it('orders attempts across stages and answers every attempt of the session', () => {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    putQuestions(dir, TEST_3);
    putInput(dir, PLAN_2, { respondsTo: PLAN_1, answers: [answerEntry('1', ['A']), answerEntry('2', ['A'])] });
    const pending = summaryOf([pendingRow(TEST_3, 'test', '1')]);
    const attempts = questionAttempts(records(dir), pending);
    expect(attempts.map((item) => [item.executionId, item.status, item.count])).toEqual([
      [PLAN_1, 'answered', 2],
      [TEST_3, 'pending', 2],
    ]);
  });
});

describe('readQuestions over a session that continued after an upgrade (0.7 then 0.8)', () => {
  function upgradedSession(): string {
    const dir = makeSession();
    const legacy = (executionId: string, stage: string, status: string, answer: unknown) => ({
      ...pendingRow(executionId, stage, '1'),
      file: undefined,
      status,
      answer,
    });
    putJson(dir, 'questions.json', {
      schema_version: 1,
      questions: [
        { ...legacy(PLAN_1, 'plan', 'answered', { selected: ['A'] }), answered_at: '2026-10-01T00:00:00.000Z' },
        legacy(TEST_3, 'test', 'pending', null),
      ],
    });
    return dir;
  }

  it('keeps legacy records and adds a per-execution batch the legacy file does not list', () => {
    const dir = upgradedSession();
    putQuestions(dir, '0004-plan--attempt-03', { ids: ['9'] });
    const list = records(dir);
    expect(statusesOf(list)).toEqual([
      [PLAN_1, '1', 'answered'],
      [TEST_3, '1', 'pending'],
      // B6: a per-execution batch is no longer listed pending by status.json.
      ['0004-plan--attempt-03', '9', 'superseded'],
    ]);
    expect(list[0]?.answeredAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores a malformed per-execution duplicate of a batch the legacy file defines', () => {
    const dir = upgradedSession();
    putJson(dir, `executions/${TEST_3}/questions.json`, '{ nope');
    const summary = summaryOf([pendingRow(TEST_3, 'test', '1')]);
    const history = readQuestions(dir);
    expect(history.kind === 'ok' && history.malformed).toEqual([]);
    const target = { executionId: TEST_3, stageId: 'test' };
    expect(verifyBatch({ summary, history, target, fingerprint: batchFingerprint(summary) }).kind).toBe('ok');
  });

  it('reads a 0.7 batch answered on 0.8 as answered, with the legacy definition and fingerprint', () => {
    const dir = upgradedSession();
    putInput(dir, '0004-test--attempt-02', { respondsTo: TEST_3, answers: [answerEntry('1', ['B'])] });
    const summaryRows = [pendingRow(TEST_3, 'test', '1')];
    const list = records(dir);
    const batch = list.find((entry) => entry.item.execution_id === TEST_3);
    expect(batch).toMatchObject({ status: 'answered', answer: { selected: ['B'], text: null } });
    // The legacy definition still fingerprints like the status row that the user answered from.
    const seen = batchFingerprint(summaryOf(summaryRows));
    expect(batchFingerprint(batch === undefined ? [] : [batch.item])).toBe(seen);
    expect(
      reconcileSubmission(list, { executionId: TEST_3, stageId: 'test' }, { '1': 'B' }),
    ).toEqual({ kind: 'recorded' });
  });
});

describe('verifyBatch and reconcileSubmission over per-execution records', () => {
  const target = { executionId: PLAN_1, stageId: 'plan' };

  function pendingSession() {
    const dir = makeSession();
    putQuestions(dir, PLAN_1);
    const rows = [pendingRow(PLAN_1, 'plan', '1'), pendingRow(PLAN_1, 'plan', '2')];
    return { dir, rows, summary: summaryOf(rows) };
  }

  // B6: without a pending source the history never marks a per-execution batch pending, so it is no longer waiting.
  it('does not accept a 0.8.0 batch the history no longer lists as pending', () => {
    const { dir, rows, summary } = pendingSession();
    const history = readQuestions(dir);
    expect(verifyBatch({ summary, history, target, fingerprint: batchFingerprint(summary) }).kind).toBe('changed');
    expect(rows).toHaveLength(2);
  });

  it('refuses to send a batch that already has a persisted answer behind a stale status row', () => {
    const { dir, summary } = pendingSession();
    putEvents(dir, [
      { executionId: PLAN_1, stageId: 'plan', timestamp: 't', data: { answers: [answerEntry('1', ['A']), answerEntry('2', ['A'])] } },
    ]);
    const history = readQuestions(dir);
    expect(verifyBatch({ summary, history, target, fingerprint: batchFingerprint(summary) })).toMatchObject({
      kind: 'changed',
    });
  });

  it('refuses a batch whose execution file is malformed', () => {
    const { dir, summary } = pendingSession();
    putJson(dir, `executions/${PLAN_1}/questions.json`, { schema_version: 1, questions: [{ id: '1' }] });
    const history = readQuestions(dir);
    expect(verifyBatch({ summary, history, target, fingerprint: batchFingerprint(summary) }).kind).toBe('unsupported');
  });

  it('is unconfirmed before the answer and recorded from the event alone after a dispatch failure', () => {
    const { dir } = pendingSession();
    const reply = { '1': 'A', '2': 'B' };
    const before = readQuestions(dir);
    if (before.kind !== 'ok') throw new Error(before.kind);
    // B6: the unanswered batch reads as superseded, so before the answer the submission is unconfirmed.
    expect(reconcileSubmission(before.questions, target, reply)).toEqual({ kind: 'unconfirmed' });
    putEvents(dir, [
      { executionId: PLAN_1, stageId: 'plan', timestamp: 't', data: { answers: [answerEntry('1', ['A']), answerEntry('2', ['B'])] } },
    ]);
    const after = readQuestions(dir);
    if (after.kind !== 'ok') throw new Error(after.kind);
    expect(reconcileSubmission(after.questions, target, reply)).toEqual({ kind: 'recorded' });
    expect(reconcileSubmission(after.questions, target, { '1': 'B', '2': 'B' })).toEqual({ kind: 'answered-elsewhere' });
  });

  it('is unconfirmed when the batch is neither answered nor listed any more', () => {
    const { dir } = pendingSession();
    const history = readQuestions(dir);
    if (history.kind !== 'ok') throw new Error(history.kind);
    expect(reconcileSubmission(history.questions, target, { '1': 'A', '2': 'A' })).toEqual({ kind: 'unconfirmed' });
  });

  it('puts the execution into the batch even when the execution was created after the input', () => {
    const { dir } = pendingSession();
    putExecution(dir, PLAN_1, { outcomeStatus: 'question' });
    expect(readQuestions(dir).kind).toBe('ok');
  });
});
