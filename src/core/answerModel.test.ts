import { describe, expect, it } from 'vitest';

import { type AnswerModelInput, buildAnswerModel, describeDraft, parseAnswerMessage } from './answerModel';
import type { PendingQuestion } from './model';

const question = (id: string, selection: string): PendingQuestion => ({
  id,
  question: `Q${id}?`,
  context: null,
  selection,
  options: [
    { id: 'A', label: 'a', description: null },
    { id: 'B', label: 'b', description: null },
  ],
  recommended: ['A'],
  executionId: 'e1',
  stageId: 'plan',
  recipient: 'human',
  file: null,
});

function input(overrides: Partial<AnswerModelInput> = {}): AnswerModelInput {
  return {
    revision: 1,
    generation: 0,
    archive: null,
    fingerprint: 'f',
    title: 't',
    crumb: 'c',
    state: 'editing',
    message: null,
    questions: [question('1', 'single'), question('2', 'multiple')],
    draft: {},
    blockReason: null,
    records: null,
    ...overrides,
  };
}

describe('buildAnswerModel', () => {
  it('starts with nothing answered or submittable, even with a recommendation', () => {
    const model = buildAnswerModel(input());
    expect(model.answered).toBe(0);
    expect(model.canSubmit).toBe(false);
    expect(model.questions[0]?.recommended).toEqual(['A']);
  });

  it('allows Send only for a complete batch, and not while the target is blocked', () => {
    const draft = {
      '1': { mode: 'choice' as const, selected: ['B'], text: '' },
      '2': { mode: 'text' as const, selected: [], text: 'mine' },
    };
    expect(buildAnswerModel(input({ draft })).canSubmit).toBe(true);
    const blocked = buildAnswerModel(input({ draft, blockReason: 'The session is running.' }));
    expect(blocked.canSubmit).toBe(false);
    expect(blocked.editable).toBe(true);
  });

  it('is read-only once stale, and unsupported questions are not exposed as a form', () => {
    expect(buildAnswerModel(input({ state: 'stale' })).editable).toBe(false);
    expect(buildAnswerModel(input({ questions: [question('1', 'text')] })).questions).toEqual([]);
  });
});

describe('describeDraft', () => {
  it('describes only the active mode', () => {
    const q = question('1', 'single');
    expect(describeDraft(q, { mode: 'choice', selected: ['B'], text: 'ignored' })).toBe('B. b');
    expect(describeDraft(q, { mode: 'text', selected: ['B'], text: 'mine' })).toBe('mine');
    expect(describeDraft(q, undefined)).toBe('');
  });
});

describe('parseAnswerMessage', () => {
  const draft = { mode: 'text', selected: [], text: 'x' };

  it('accepts well-formed edits and intents', () => {
    expect(parseAnswerMessage({ type: 'edit', generation: 2, fingerprint: 'f', questionId: '1', draft })).toEqual({
      type: 'edit',
      generation: 2,
      fingerprint: 'f',
      questionId: '1',
      draft,
    });
    expect(parseAnswerMessage({ type: 'submit', revision: 2, fingerprint: 'f' })).toMatchObject({ type: 'submit' });
    expect(parseAnswerMessage({ type: 'later' })).toEqual({ type: 'later' });
  });

  it('drops forged shapes: unknown types, bad modes, non-string options, paths and argv', () => {
    const base = { generation: 1, fingerprint: 'f', questionId: '1' };
    expect(parseAnswerMessage({ type: 'run', argv: ['x'] })).toBeNull();
    expect(parseAnswerMessage({ type: 'edit', ...base, draft: { ...draft, mode: 'other' } })).toBeNull();
    expect(parseAnswerMessage({ type: 'edit', ...base, draft: { ...draft, selected: [1] } })).toBeNull();
    expect(parseAnswerMessage({ type: 'edit', ...base, draft: { ...draft, text: 'x'.repeat(100_001) } })).toBeNull();
    expect(parseAnswerMessage({ type: 'submit', fingerprint: 'f' })).toBeNull();
    expect(parseAnswerMessage({ type: 'edit', fingerprint: 'f', questionId: '1', draft })).toBeNull();
    expect(parseAnswerMessage(null)).toBeNull();
  });
});
