import { describe, expect, it } from 'vitest';

import { type BatchStateInput, refreshBatchState } from './answerState';
import type { PendingQuestion } from './model';
import { batchFingerprint } from './questionAnswers';
import type { QuestionRecord } from './questions';

const pending: PendingQuestion = {
  id: '1',
  question: 'Q?',
  context: null,
  selection: 'single',
  options: [
    { id: 'A', label: 'a', description: null },
    { id: 'B', label: 'b', description: null },
  ],
  recommended: [],
  executionId: '0001-plan--attempt-01',
  stageId: 'plan',
  recipient: 'human',
  file: null,
};

function input(overrides: Partial<BatchStateInput> = {}): BatchStateInput {
  return {
    state: 'editing',
    fingerprint: batchFingerprint([pending]),
    current: [pending],
    history: null,
    target: { executionId: '0001-plan--attempt-01', stageId: 'plan' },
    executions: [{ id: '0001-plan--attempt-01', stage: 'plan' }],
    ...overrides,
  };
}

const answered: QuestionRecord = { ...pending, status: 'answered', answer: { selected: ['A'], text: null }, answeredAt: null };

describe('refreshBatchState', () => {
  it('leaves an unchanged batch alone', () => {
    expect(refreshBatchState(input())).toBeNull();
  });

  it('marks a changed batch stale and recovers when it returns to the same content', () => {
    const changed = { ...pending, question: 'Different?' };
    expect(refreshBatchState(input({ current: [changed] }))?.state).toBe('stale');
    expect(refreshBatchState(input({ state: 'stale' }))?.state).toBe('editing');
  });

  it('returns an unavailable panel to editing once its batch is present again', () => {
    expect(refreshBatchState(input({ state: 'unavailable' }))?.state).toBe('editing');
  });

  it('treats a vanished batch as answered elsewhere only with an answered record', () => {
    expect(refreshBatchState(input({ current: [], history: [answered] }))?.state).toBe('answered-elsewhere');
    expect(refreshBatchState(input({ current: [], history: [{ ...answered, status: 'superseded' }] }))?.state).toBe('unavailable');
    expect(refreshBatchState(input({ current: [], history: [{ ...answered, executionId: 'e2' }] }))?.state).toBe('unavailable');
  });

  it('separates recorded answers from a continuation of this stage', () => {
    const base = { state: 'recorded' as const };
    expect(refreshBatchState(input(base))?.state).toBe('recorded-waiting');
    const later = [{ id: '0001-plan--attempt-01', stage: 'plan' }, { id: '0002-plan--attempt-02', stage: 'plan' }];
    expect(refreshBatchState(input({ ...base, executions: later }))?.state).toBe('continuing');
    expect(refreshBatchState(input({ state: 'recorded-waiting', executions: later }))?.state).toBe('continuing');
  });

  it('ignores another branch executing while this stage did not continue', () => {
    const other = [{ id: '0001-plan--attempt-01', stage: 'plan' }, { id: '0002-test--attempt-01', stage: 'test' }];
    expect(refreshBatchState(input({ state: 'recorded', executions: other }))?.state).toBe('recorded-waiting');
  });

  it('does not move a submission in flight or uncertain', () => {
    expect(refreshBatchState(input({ state: 'sending', current: [] }))).toBeNull();
    expect(refreshBatchState(input({ state: 'unconfirmed', current: [] }))).toBeNull();
  });
});
