import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { answerArgs } from './controlArgs';
import type { PendingQuestion } from './model';
import {
  ambiguousTextQuestions,
  answeredCount,
  type BatchDraft,
  batchFingerprint,
  checkBatch,
  reconcileSubmission,
  replyFileText,
  serializeAnswers,
  validateBatch,
  verifyBatch,
} from './questionAnswers';
import { parseQuestionsFile, readQuestions } from './questions';
import { readStatus } from './statusReader';
import { capturedDir } from './testHelpers';

function question(id: string, selection: string, overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id,
    question: `Question ${id}?`,
    context: 'ctx',
    selection,
    options: [
      { id: 'A', label: 'One', description: null },
      { id: 'B', label: 'Two', description: null },
      { id: 'C', label: 'Three', description: null },
    ],
    recommended: ['A'],
    executionId: 'e1',
    stageId: 'plan',
    recipient: 'human',
    file: null,
    ...overrides,
  };
}

const single = question('1', 'single');
const multiple = question('2', 'multiple');
const batch = [single, multiple, question('3', 'single')];

describe('serializeAnswers', () => {
  it('selects nothing by default, even with a recommendation', () => {
    expect(answeredCount(validateBatch(batch, {}))).toBe(0);
    expect(serializeAnswers(batch, {})).toBeNull();
  });

  it('emits the documented map: id, option-ordered array, verbatim multiline text', () => {
    const text = 'Keep "files",\nand 1,2 — ca sĩ\n';
    const draft: BatchDraft = {
      '1': { mode: 'choice', selected: ['B'], text: '' },
      '2': { mode: 'choice', selected: ['C', 'A'], text: 'ignored' },
      '3': { mode: 'text', selected: ['A'], text },
    };
    const reply = serializeAnswers(batch, draft);
    expect(reply).toEqual({ '1': 'B', '2': ['A', 'C'], '3': text });
    expect(JSON.parse(replyFileText(reply ?? {}))).toEqual(reply);
  });

  it('Other replaces multiple-choice selections and keeps the inactive values', () => {
    const draft: BatchDraft = { '2': { mode: 'text', selected: ['A', 'B'], text: 'mine' } };
    expect(serializeAnswers([multiple], draft)).toEqual({ '2': 'mine' });
    expect(draft['2']?.selected).toEqual(['A', 'B']);
  });

  it('rejects whitespace-only text, unknown, duplicate and surplus options', () => {
    const issue = (target: PendingQuestion, value: BatchDraft[string]) =>
      validateBatch([target], { [target.id]: value })[0]?.issue;
    expect(issue(single, { mode: 'text', selected: [], text: '  \n' })).toBe('empty-text');
    expect(issue(single, { mode: 'choice', selected: ['Z'], text: '' })).toBe('unknown-option');
    expect(issue(single, { mode: 'choice', selected: ['A', 'B'], text: '' })).toBe('too-many');
    expect(issue(multiple, { mode: 'choice', selected: ['A', 'A'], text: '' })).toBe('duplicate-option');
  });
});

describe('ambiguousTextQuestions', () => {
  it('flags free text equal to an option id without changing it', () => {
    const draft: BatchDraft = {
      '1': { mode: 'text', selected: [], text: ' A ' },
      '3': { mode: 'text', selected: [], text: 'AA' },
    };
    expect(ambiguousTextQuestions(batch, draft)).toEqual(['1']);
  });
});

describe('checkBatch and fingerprint', () => {
  it('accepts a valid batch and rejects mixed, unsupported and out-of-range ones', () => {
    expect(checkBatch(batch)).toBeNull();
    expect(checkBatch([])).toEqual({ kind: 'empty' });
    expect(checkBatch([...batch, question('4', 'single', { stageId: 'other' })])?.kind).toBe('mixed-batch');
    expect(checkBatch([question('1', 'text')])).toEqual({ kind: 'unsupported-mode', questionId: '1' });
    expect(checkBatch([question('1', 'single', { options: [] })])?.kind).toBe('bad-options');
    expect(checkBatch([single, question('1', 'single')])?.kind).toBe('duplicate-id');
    const options = Array.from({ length: 27 }, (_, index) => ({ id: `O${index}`, label: 'x', description: null }));
    expect(checkBatch([question('1', 'single', { options: options.slice(0, 26) })])).toBeNull();
    expect(checkBatch([question('1', 'single', { options })])?.kind).toBe('bad-options');
  });

  it('changes when text or recommendation change, not for the same content', () => {
    const base = batchFingerprint(batch);
    expect(batchFingerprint([...batch])).toBe(base);
    expect(batchFingerprint([question('1', 'single', { question: 'changed' }), ...batch.slice(1)])).not.toBe(base);
    expect(batchFingerprint([question('1', 'single', { recommended: ['B'] }), ...batch.slice(1)])).not.toBe(base);
  });
});

describe('reconcileSubmission (captured fixtures)', () => {
  const read = (name: string) => {
    const result = readQuestions(capturedDir(name));
    if (result.kind !== 'ok') throw new Error(name);
    return result.questions;
  };
  const answered = read('question-answered');
  const target = { executionId: answered[0]?.executionId ?? '', stageId: answered[0]?.stageId ?? '' };
  const freeText = answered[2]?.answer?.text ?? '';

  it('recognizes recorded answers by normalized selected/text', () => {
    expect(reconcileSubmission(answered, target, { '1': 'B', '2': ['C', 'A'], '3': freeText })).toEqual({
      kind: 'recorded',
    });
  });

  it('reports different stored answers as answered elsewhere, and pending as pending', () => {
    expect(reconcileSubmission(answered, target, { '1': 'A', '2': ['A', 'C'], '3': freeText })).toEqual({
      kind: 'answered-elsewhere',
    });
    const pending = read('question-pending');
    const pendingTarget = { executionId: pending[0]?.executionId ?? '', stageId: pending[0]?.stageId ?? '' };
    expect(reconcileSubmission(pending, pendingTarget, { '1': 'A', '2': ['A'], '3': 'x' })).toEqual({
      kind: 'pending',
    });
  });

  it('is unconfirmed for another execution, so a later round never matches', () => {
    expect(reconcileSubmission(answered, { ...target, executionId: 'other' }, { '1': 'B' })).toEqual({
      kind: 'unconfirmed',
    });
  });
});

describe('answerArgs', () => {
  it('builds the continue command with a stage and omits it for a standalone role', () => {
    expect(answerArgs({ sessionId: 's', stageId: 'plan', replyFile: 'C:\\x y\\a.json' })).toEqual([
      'session', 'continue', 's', '--stage', 'plan', '--reply-file', 'C:\\x y\\a.json',
    ]);
    expect(answerArgs({ sessionId: 's', stageId: null, replyFile: 'r' })).toEqual([
      'session', 'continue', 's', '--reply-file', 'r',
    ]);
  });
});

describe('verifyBatch (captured question-pending)', () => {
  const dir = capturedDir('question-pending');
  const history = readQuestions(dir);
  const status = readStatus(path.join(dir, 'status.json'));
  const summary = status.kind === 'ok' ? status.status.questions : [];
  const target = { executionId: summary[0]?.executionId ?? '', stageId: summary[0]?.stageId ?? null };
  const fingerprint = batchFingerprint(summary);

  it('accepts the authoritative pending batch the user saw', () => {
    expect(verifyBatch({ summary, history, target, fingerprint }).kind).toBe('ok');
  });

  it('blocks a missing, unsupported or malformed question file', () => {
    for (const kind of ['missing', 'invalid', 'unreadable'] as const) {
      const bad = kind === 'unreadable' ? { kind, error: 'EACCES' } : kind === 'invalid' ? { kind, error: 'x' } : { kind };
      expect(verifyBatch({ summary, history: bad, target, fingerprint }).kind).toBe('unsupported');
    }
    expect(verifyBatch({ summary, history: { kind: 'unsupported', schemaVersion: 2 }, target, fingerprint }).kind).toBe(
      'unsupported',
    );
  });

  it('blocks a non-human recipient, disagreeing membership and a changed batch', () => {
    if (history.kind !== 'ok') throw new Error('fixture');
    const other = history.questions.map((record) => ({ ...record, recipient: 'agent' }));
    expect(verifyBatch({ summary, history: { kind: 'ok', questions: other, malformed: [] }, target, fingerprint }).kind).toBe('unsupported');
    expect(verifyBatch({ summary: summary.slice(1), history, target, fingerprint }).kind).toBe('unsupported');
    expect(verifyBatch({ summary, history, target, fingerprint: 'other' }).kind).toBe('changed');
    expect(verifyBatch({ summary, history, target: { ...target, executionId: 'x' }, fingerprint }).kind).toBe('changed');
  });
});

describe('verifyBatch rejects malformed records instead of validating remnants', () => {
  const dir = capturedDir('question-pending');
  const status = readStatus(path.join(dir, 'status.json'));
  const summary = status.kind === 'ok' ? status.status.questions : [];
  const target = { executionId: summary[0]?.executionId ?? '', stageId: summary[0]?.stageId ?? null };
  const fingerprint = batchFingerprint(summary);
  const raw = JSON.parse(readFileSync(path.join(dir, 'questions.json'), 'utf8')) as {
    schema_version: number;
    questions: Record<string, unknown>[];
  };
  const verifyWith = (questions: unknown[]) =>
    verifyBatch({
      summary,
      history: parseQuestionsFile(JSON.stringify({ ...raw, questions })),
      target,
      fingerprint,
    });

  it('accepts the unmodified file', () => {
    expect(verifyWith(raw.questions).kind).toBe('ok');
  });

  it('blocks a malformed second question, an option without a label and a missing context', () => {
    const [first, second, ...rest] = raw.questions;
    expect(verifyWith([first, 'garbage', ...rest]).kind).toBe('unsupported');
    const noLabel = { ...second, options: [{ id: 'A' }, ...(second?.options as unknown[]).slice(1)] };
    expect(verifyWith([first, noLabel, ...rest]).kind).toBe('unsupported');
    expect(verifyWith([first, { ...second, context: null }, ...rest]).kind).toBe('unsupported');
  });
});
