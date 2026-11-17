import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { groupPendingQuestions, parseQuestionsFile, pendingQuestions, readQuestions } from './questions';
import { capturedDir, questionItem, syntheticDir } from './testHelpers';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function okQuestions(dir: string) {
  const read = readQuestions(dir);
  if (read.kind !== 'ok') throw new Error(`questions.json did not read: ${read.kind}`);
  return read.questions;
}

describe('readQuestions', () => {
  it('reads pending records with a null answer (captured question-pending)', () => {
    const questions = okQuestions(capturedDir('question-pending'));
    expect(questions.map((question) => [question.item.id, question.status, question.answer])).toEqual([
      ['1', 'pending', null],
      ['2', 'pending', null],
      ['3', 'pending', null],
    ]);
    expect(questions[0]?.item.recommended).toEqual(['A']);
  });

  it('reads selected answers, free text and answered_at (captured question-answered)', () => {
    const questions = okQuestions(capturedDir('question-answered'));
    expect(questions.map((question) => question.status)).toEqual(['answered', 'answered', 'answered']);
    expect(questions[0]?.answer).toEqual({ selected: ['B'], text: null });
    expect(questions[1]?.answer).toEqual({ selected: ['A', 'C'], text: null });
    expect(questions[2]?.answer).toEqual({ selected: [], text: expect.stringContaining('Either is fine') });
    expect(questions[0]?.answeredAt).toBe('2026-11-01T11:17:09.273+00:00');
  });

  // The fixture is intentionally non-conforming: item 1 carries a string `answer`, so it is skipped and reported.
  it('skips the synthetic superseded fixture item whose answer is a string and keeps the pending one', () => {
    const read = readQuestions(syntheticDir('questions-superseded'));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions.map((question) => [question.item.id, question.status])).toEqual([['2', 'pending']]);
    // Item 2 stays listed but is also reported, because the fixture omits `context`.
    expect(read.malformed.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it('lists a conforming superseded record with a null answer as superseded', () => {
    const read = parseQuestionsFile(
      JSON.stringify({ schema_version: 1, questions: [questionItem('1', { status: 'superseded', answer: null })] }),
    );
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions[0]).toMatchObject({ item: { id: '1' }, status: 'superseded', answer: null });
    expect(read.malformed).toEqual([]);
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

const record = (id: string, stageId: string, executionId: string) =>
  questionItem(id, { question: 'Q?', options: [], recommended: [], execution_id: executionId, stage_id: stageId });

describe('groupPendingQuestions', () => {
  it('groups by stage and execution in first-seen order', () => {
    const groups = groupPendingQuestions([
      record('1', 'review', '0002-review--attempt-01'),
      record('2', 'plan', '0001-plan--attempt-01'),
      record('3', 'review', '0002-review--attempt-01'),
    ]);
    expect(groups.map((group) => [group.stageId, group.executionId, group.questions.length])).toEqual([
      ['review', '0002-review--attempt-01', 2],
      ['plan', '0001-plan--attempt-01', 1],
    ]);
  });
});

// B6: status.json carries no pending questions in contracts 0.8.0, so the status source is empty.
describe('pendingQuestions', () => {
  it('has no source and lists nothing', () => {
    expect(pendingQuestions()).toEqual([]);
  });
});

// RC1: every required field of a session question, missing or wrong-typed, skips that item without throwing.
describe('parseQuestionsFile required fields', () => {
  const valid = (id: string) => ({ ...questionItem(id) });
  const parseWith = (item: Record<string, unknown>) =>
    parseQuestionsFile(JSON.stringify({ schema_version: 1, questions: [valid('1'), item, valid('3')] }));
  const REQUIRED = ['id', 'execution_id', 'stage_id', 'recipient', 'status', 'answer'] as const;

  it.each(REQUIRED)('skips and reports an item whose %s is missing', (field) => {
    const read = parseWith(omitKey(valid('2') as Record<string, unknown>, field));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions.map((entry) => entry.item.id)).toEqual(['1', '3']);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0]?.index).toBe(1);
  });

  it.each(['id', 'execution_id', 'stage_id', 'recipient', 'status', 'answer'] as const)(
    'skips and reports an item whose %s has the wrong type',
    (field) => {
      const read = parseWith({ ...valid('2'), [field]: 42 });
      if (read.kind !== 'ok') throw new Error('expected ok');
      expect(read.questions.map((entry) => entry.item.id)).toEqual(['1', '3']);
      expect(read.malformed).toHaveLength(1);
    },
  );

  it.each([['a string', 'free text'], ['a boolean', true], ['an array', [{ selected: ['A'] }]]])(
    'skips and reports an item whose answer is %s',
    (_name, answer) => {
      const read = parseWith({ ...valid('2'), answer });
      if (read.kind !== 'ok') throw new Error('expected ok');
      expect(read.questions.map((entry) => entry.item.id)).toEqual(['1', '3']);
      expect(read.malformed.map((entry) => entry.index)).toEqual([1]);
    },
  );

  it('accepts a null answer and an object answer', () => {
    const read = parseWith({ ...valid('2'), status: 'answered', answer: { selected: ['A'], text: null } });
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions.map((entry) => entry.item.id)).toEqual(['1', '2', '3']);
    expect(read.malformed).toEqual([]);
  });

  it('skips items that are not objects', () => {
    const read = parseQuestionsFile(JSON.stringify({ schema_version: 1, questions: [valid('1'), 7, null, 'x'] }));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions).toHaveLength(1);
    expect(read.malformed).toHaveLength(3);
  });

  it('drops a wrong-typed optional field and keeps the item', () => {
    const read = parseWith({ ...valid('2'), recommended: 'A', answered_at: 5 });
    if (read.kind !== 'ok') throw new Error('expected ok');
    const entry = read.questions.find((question) => question.item.id === '2');
    expect(entry?.item.answered_at).toBeUndefined();
    expect(entry?.item.recommended).toBeUndefined();
  });
});

describe('execution question files required fields', () => {
  const dirWith = (body: unknown) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-questions-'));
    temps.push(dir);
    const executionDir = path.join(dir, 'executions', '0001-plan--attempt-01');
    mkdirSync(executionDir, { recursive: true });
    writeFileSync(path.join(executionDir, 'questions.json'), JSON.stringify(body));
    return dir;
  };
  const header = { schema_version: 1, stage_id: 'plan', execution_id: '0001-plan--attempt-01', recipient: 'human' };
  const item = (id: unknown) => ({ id, question: 'Q?', context: 'c', selection: 'single', options: [] });

  it.each(['stage_id', 'execution_id', 'recipient'])('reports the whole file when the header %s is missing or wrong', (field) => {
    for (const body of [omitKey(header, field), { ...header, [field]: 3 }]) {
      const read = readQuestions(dirWith({ ...body, questions: [item('1')] }));
      expect(read.kind === 'ok' ? read.questions : []).toEqual([]);
      expect(read.kind === 'ok' ? read.malformed.length : 1).toBeGreaterThan(0);
    }
  });

  it('skips an item without an id and keeps its neighbours', () => {
    const read = readQuestions(dirWith({ ...header, questions: [item('1'), item(undefined), item(4)] }));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.questions.map((entry) => entry.item.id)).toEqual(['1']);
    expect(read.malformed.length).toBeGreaterThan(0);
  });
});

function omitKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

// RC2: every conforming fixture's questions.json is accepted. synthetic/questions-superseded is excluded: it is on the
// plan's intentional non-conformance list (a free-form answer), and its own test covers it.
describe('conforming fixtures', () => {
  const root = path.join(process.cwd(), 'src', 'core', 'fixtures');
  const files = ['sessions', 'captured', 'synthetic'].flatMap((group) =>
    readdirSync(path.join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'questions-superseded')
      .map((entry) => path.join(root, group, entry.name)),
  );

  it.each(files)('reads %s without malformed records', (dir) => {
    const read = readQuestions(dir);
    if (read.kind === 'ok') expect(read.malformed).toEqual([]);
    else expect(['missing']).toContain(read.kind);
  });
});
