import { describe, expect, it } from 'vitest';

import { groupPendingQuestions, parseQuestionsFile, readQuestions } from './questions';
import { readStatus } from './statusReader';
import { capturedDir, syntheticDir } from './testHelpers';

function okQuestions(dir: string) {
  const read = readQuestions(dir);
  if (read.kind !== 'ok') throw new Error(`questions.json did not read: ${read.kind}`);
  return read.questions;
}

describe('readQuestions', () => {
  it('reads pending records with a null answer (captured question-pending)', () => {
    const questions = okQuestions(capturedDir('question-pending'));
    expect(questions.map((question) => [question.id, question.status, question.answer])).toEqual([
      ['1', 'pending', null],
      ['2', 'pending', null],
      ['3', 'pending', null],
    ]);
    expect(questions[0]?.recommended).toEqual(['A']);
  });

  it('reads selected answers, free text and answered_at (captured question-answered)', () => {
    const questions = okQuestions(capturedDir('question-answered'));
    expect(questions.map((question) => question.status)).toEqual(['answered', 'answered', 'answered']);
    expect(questions[0]?.answer).toEqual({ selected: ['B'], text: null });
    expect(questions[1]?.answer).toEqual({ selected: ['A', 'C'], text: null });
    expect(questions[2]?.answer).toEqual({ selected: [], text: expect.stringContaining('Either is fine') });
    expect(questions[0]?.answeredAt).toBe('2026-11-01T11:17:09.273+00:00');
  });

  it('lists a synthetic superseded record and omits an answer outside the observed shapes', () => {
    const questions = okQuestions(syntheticDir('questions-superseded'));
    expect(questions[0]).toMatchObject({ id: '1', status: 'superseded', answer: null });
    expect(questions[1]).toMatchObject({ id: '2', status: 'pending' });
  });

  it('reports missing, invalid and unsupported files distinctly', () => {
    expect(readQuestions(capturedDir('handoff-source'))).toEqual({ kind: 'missing' });
    expect(parseQuestionsFile('{oops').kind).toBe('invalid');
    expect(parseQuestionsFile('[]').kind).toBe('invalid');
    expect(parseQuestionsFile('{"schema_version":1,"questions":3}').kind).toBe('invalid');
    expect(parseQuestionsFile('{"schema_version":2,"questions":[]}')).toEqual({
      kind: 'unsupported',
      schemaVersion: 2,
    });
    expect(parseQuestionsFile('{"questions":[]}')).toEqual({ kind: 'unsupported', schemaVersion: null });
  });
});

describe('groupPendingQuestions', () => {
  it('groups by stage and execution in first-seen order', () => {
    const read = readStatus(`${syntheticDir('blocked-questions')}/status.json`);
    if (read.kind !== 'ok') throw new Error('status did not read');
    const groups = groupPendingQuestions(read.status.questions);
    expect(groups.map((group) => [group.stageId, group.executionId, group.questions.length])).toEqual([
      ['review', '0002-review--attempt-01', 1],
      ['plan', '0001-plan--attempt-01', 1],
    ]);
  });

});
