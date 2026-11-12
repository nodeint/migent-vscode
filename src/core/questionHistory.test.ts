import { describe, expect, it } from 'vitest';

import type { PendingQuestion } from './model';
import { attemptRecords, defaultAttempt, questionAttempts } from './questionHistory';
import type { QuestionRecord } from './questions';

function base(id: string, executionId: string | null, stageId: string | null = 'plan') {
  return {
    id,
    question: `Question ${id}`,
    context: null,
    selection: 'single',
    options: [],
    recommended: [],
    executionId,
    stageId,
    recipient: null,
  };
}

function record(id: string, executionId: string | null, overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return { ...base(id, executionId), status: 'pending', answer: null, answeredAt: null, ...overrides };
}

function pending(id: string, executionId: string | null, stageId: string | null = 'plan'): PendingQuestion {
  return { ...base(id, executionId, stageId), file: null };
}

const answered = (id: string, executionId: string): QuestionRecord =>
  record(id, executionId, { status: 'answered', answer: { selected: ['A'], text: null } });

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

  it('adds a pending batch that questions.json does not hold yet, and skips questions with no execution', () => {
    const attempts = questionAttempts([record('9', null)], [pending('1', '0004-review--attempt-01', 'review'), pending('2', null)]);
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
    expect(attemptRecords(records, { stageId: 'plan', executionId: 'e1' }).map((item) => item.id)).toEqual(['2', '1']);
  });
});
