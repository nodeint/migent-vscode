import { describe, expect, it } from 'vitest';

import { attemptRecords, defaultAttempt, questionAttempts } from './questionHistory';
import type { QuestionEntry, QuestionItem } from './questions';
import { questionEntry, questionItem } from './testHelpers';

function base(id: string, executionId: string, stageId = 'plan'): QuestionItem {
  return questionItem(id, { question: `Question ${id}`, options: [], recommended: [], execution_id: executionId, stage_id: stageId });
}

function record(id: string, executionId: string): QuestionEntry {
  return questionEntry(base(id, executionId), { status: 'superseded' });
}

function pending(id: string, executionId: string, stageId = 'plan'): QuestionItem {
  return base(id, executionId, stageId);
}

const answered = (id: string, executionId: string): QuestionEntry =>
  questionEntry(base(id, executionId), { status: 'answered', answer: { selected: ['A'], text: null } });

describe('questionAttempts', () => {
  it('groups the history by attempt in execution order, with the attempt number and question count', () => {
    const attempts = questionAttempts(
      [
        answered('1', '0003-plan--attempt-02'),
        answered('1', '0001-plan--attempt-01'),
        answered('2', '0001-plan--attempt-01'),
      ],
      [],
    );
    expect(attempts).toEqual([
      { stageId: 'plan', executionId: '0001-plan--attempt-01', attempt: 1, count: 2, status: 'answered' },
      { stageId: 'plan', executionId: '0003-plan--attempt-02', attempt: 2, count: 1, status: 'answered' },
    ]);
  });

  it('marks an attempt pending only while status.json lists it, and superseded when it was never answered', () => {
    const attempts = questionAttempts(
      [record('1', '0001-plan--attempt-01'), record('1', '0002-plan--attempt-02')],
      [pending('1', '0002-plan--attempt-02')],
    );
    expect(attempts.map((attempt) => [attempt.executionId, attempt.status])).toEqual([
      ['0001-plan--attempt-01', 'superseded'],
      ['0002-plan--attempt-02', 'pending'],
    ]);
  });

  it('marks an attempt pending when its own question records wait for an answer', () => {
    const waiting = questionEntry(base('1', '0002-plan--attempt-02'), { status: 'pending' });
    const attempts = questionAttempts([record('1', '0001-plan--attempt-01'), waiting], []);
    expect(attempts.map((attempt) => [attempt.executionId, attempt.status])).toEqual([
      ['0001-plan--attempt-01', 'superseded'],
      ['0002-plan--attempt-02', 'pending'],
    ]);
  });

  it('shows an attempt with a persisted answer as answered even while status.json still lists it', () => {
    const attempts = questionAttempts([answered('1', '0001-plan--attempt-01')], [pending('1', '0001-plan--attempt-01')]);
    expect(attempts.map((attempt) => attempt.status)).toEqual(['answered']);
  });

  it('adds a pending batch that questions.json does not hold yet', () => {
    const attempts = questionAttempts([], [pending('1', '0004-review--attempt-01', 'review')]);
    expect(attempts).toEqual([
      { stageId: 'review', executionId: '0004-review--attempt-01', attempt: 1, count: 1, status: 'pending' },
    ]);
  });

  it('keeps an execution id of another shape after the parsed ones, with no attempt number', () => {
    const attempts = questionAttempts([answered('1', 'role-run'), answered('1', '0002-plan--attempt-01')], []);
    expect(attempts.map((attempt) => [attempt.executionId, attempt.attempt])).toEqual([
      ['0002-plan--attempt-01', 1],
      ['role-run', null],
    ]);
  });
});

describe('defaultAttempt', () => {
  it('prefers the latest attempt still waiting, else the latest one', () => {
    const attempts = questionAttempts(
      [answered('1', '0003-plan--attempt-03')],
      [pending('1', '0001-plan--attempt-01'), pending('1', '0002-plan--attempt-02')],
    );
    expect(defaultAttempt(attempts)?.executionId).toBe('0002-plan--attempt-02');
    expect(defaultAttempt(questionAttempts([answered('1', '0001-plan--attempt-01'), answered('1', '0005-plan--attempt-02')], []))?.executionId).toBe(
      '0005-plan--attempt-02',
    );
    expect(defaultAttempt([])).toBeUndefined();
  });
});

describe('attemptRecords', () => {
  it('returns the records of one attempt in stored order', () => {
    const records = [answered('2', 'e1'), answered('1', 'e2'), answered('1', 'e1')];
    expect(attemptRecords(records, { stageId: 'plan', executionId: 'e1' }).map(({ item }) => item.id)).toEqual(['2', '1']);
  });
});
