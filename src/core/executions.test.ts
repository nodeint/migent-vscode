import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  executionBlocker,
  executionCause,
  executionDecision,
  executionEffort,
  executionOutcomeStatus,
  listExecutions,
  parseExecution,
  parseExecutionId,
  readExecution,
  readExecutionSummary,
} from './executions';

const fixtureRoot = path.join(process.cwd(), 'src', 'core', 'fixtures');
const fixture = (name: string): string => path.join(fixtureRoot, 'sessions', name);

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A record with every required contract field; tests override or remove single fields. */
function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function record(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = parseExecutionId(id);
  return {
    session_id: 's',
    execution_id: id,
    execution_order: parsed?.order ?? 1,
    stage_id: parsed?.stageId ?? 'plan',
    stage_attempt: parsed?.attempt ?? 1,
    status: 'completed',
    created_at: '2026-11-01T10:00:00Z',
    ...overrides,
  };
}

/** A session directory holding one `execution.json` per `[id, body]` pair. */
function sessionWith(entries: readonly (readonly [string, unknown])[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-execs-'));
  temps.push(dir);
  for (const [id, body] of entries) {
    const executionDir = path.join(dir, 'executions', id);
    mkdirSync(executionDir, { recursive: true });
    writeFileSync(path.join(executionDir, 'execution.json'), JSON.stringify(body));
  }
  return dir;
}

describe('parseExecutionId', () => {
  it('parses order, stage and attempt', () => {
    expect(parseExecutionId('0002-review-plan--attempt-03')).toEqual({
      order: 2,
      stageId: 'review-plan',
      attempt: 3,
    });
  });

  it('null for a non-execution directory name', () => {
    expect(parseExecutionId('outputs')).toBeNull();
    expect(parseExecutionId('random-dir')).toBeNull();
  });
});

describe('parseExecution', () => {
  const valid = record('0001-plan--attempt-01');

  it('accepts a record with every required field and keeps them', () => {
    expect(parseExecution(valid)).toEqual(valid);
  });

  const required: readonly [string, unknown][] = [
    ['session_id', 7.5],
    ['execution_id', 3],
    ['execution_order', '1'],
    ['stage_id', 3],
    ['stage_attempt', '1'],
    ['status', 3],
    ['created_at', 3],
  ];

  it.each(required)('rejects a record without %s', (field) => {
    const rest = omit(valid, field);
    expect(parseExecution(rest)).toBeNull();
  });

  it.each(required)('rejects a record whose %s has the wrong type', (field, wrong) => {
    expect(parseExecution({ ...valid, [field]: wrong })).toBeNull();
  });

  it.each(['session_id', 'execution_id', 'stage_id', 'status', 'created_at'])(
    'treats an empty %s as absent',
    (field) => {
      expect(parseExecution({ ...valid, [field]: '' })).toBeNull();
    },
  );

  it('rejects a value that is not an object', () => {
    for (const value of [null, 'text', 3, [], undefined]) expect(parseExecution(value)).toBeNull();
  });

  it('reads an unquoted numeric session_id as its decimal string', () => {
    expect(parseExecution({ ...valid, session_id: 3 })?.session_id).toBe('3');
  });

  it('drops an optional field of the wrong type and keeps the record', () => {
    const parsed = parseExecution({
      ...valid,
      client: 4,
      model: ['m'],
      options: 'high',
      outcome: 'done',
      completed_at: 9,
      kind: 1,
      turn_kind: {},
      error: 5,
      final_turn: 'x',
      provider_pid: 'p',
    });
    expect(parsed).toEqual(valid);
  });

  it('keeps null for the nullable optional fields', () => {
    const parsed = parseExecution({ ...valid, completed_at: null, client: null, model: null, failure_reason: null });
    expect(parsed).toMatchObject({ completed_at: null, client: null, model: null, failure_reason: null });
  });
});

describe('listExecutions', () => {
  it('reads executions oldest first, including decisions', () => {
    const rows = listExecutions(fixture('completed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: '0001-plan--attempt-01', order: 1, attempt: 1 });
    expect(rows[0]?.execution).toMatchObject({
      stage_id: 'plan',
      status: 'completed',
      client: 'claude',
      model: 'sonnet',
    });
    expect(executionDecision(rows[0]!.execution)).toBeNull();
  });

  it('returns [] when there is no executions directory', () => {
    expect(listExecutions(fixture('prepared'))).toEqual([]);
  });

  it('takes order and attempt from the directory name', () => {
    const dir = sessionWith([['0004-plan--attempt-03', record('0004-plan--attempt-03', { execution_order: 9 })]]);
    expect(listExecutions(dir)[0]).toMatchObject({ order: 4, attempt: 3 });
  });

  it('sorts by order, then id', () => {
    const dir = sessionWith([
      ['0002-b--attempt-01', record('0002-b--attempt-01')],
      ['0001-a--attempt-01', record('0001-a--attempt-01')],
    ]);
    expect(listExecutions(dir).map((row) => row.id)).toEqual(['0001-a--attempt-01', '0002-b--attempt-01']);
  });

  it('omits an execution without execution.json or with unparsable content, and keeps the others (B4)', () => {
    const dir = sessionWith([['0001-a--attempt-01', record('0001-a--attempt-01')]]);
    mkdirSync(path.join(dir, 'executions', '0002-b--attempt-01'), { recursive: true });
    mkdirSync(path.join(dir, 'executions', '0003-c--attempt-01'), { recursive: true });
    writeFileSync(path.join(dir, 'executions', '0003-c--attempt-01', 'execution.json'), '{ not json');
    expect(listExecutions(dir).map((row) => row.id)).toEqual(['0001-a--attempt-01']);
  });

  const required = [
    'session_id',
    'execution_id',
    'execution_order',
    'stage_id',
    'stage_attempt',
    'status',
    'created_at',
  ];

  it.each(required)('omits an execution without %s and keeps the other executions (B4)', (field) => {
    const incomplete = omit(record('0001-a--attempt-01'), field);
    const dir = sessionWith([
      ['0001-a--attempt-01', incomplete],
      ['0002-b--attempt-01', record('0002-b--attempt-01')],
    ]);
    expect(listExecutions(dir).map((row) => row.id)).toEqual(['0002-b--attempt-01']);
    expect(readExecutionSummary(path.join(dir, 'executions', '0001-a--attempt-01'))).toBeNull();
  });

  it.each([
    ['session_id', 1.5],
    ['execution_id', false],
    ['execution_order', 'one'],
    ['stage_id', 4],
    ['stage_attempt', null],
    ['status', {}],
    ['created_at', []],
  ] as const)('omits an execution whose %s has the wrong type and keeps the other executions (B4)', (field, wrong) => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { [field]: wrong })],
      ['0002-b--attempt-01', record('0002-b--attempt-01')],
    ]);
    expect(listExecutions(dir).map((row) => row.id)).toEqual(['0002-b--attempt-01']);
  });

  it('reads the recorded blocker text, and null when the outcome has none', () => {
    const blocked = listExecutions(fixture('blocked'))[0]!.execution;
    expect(executionBlocker(blocked)).toBe('needs a decision');
    expect(executionBlocker(listExecutions(fixture('completed'))[0]!.execution)).toBeNull();
  });

  it('reads a protocol 3 execution.json like a protocol 2 one', () => {
    const id = '0001-plan--attempt-01';
    const dir = sessionWith([
      [
        id,
        record(id, {
          status: 'blocked',
          response_protocol: 3,
          corrections: { handoff_file_invalid: 2 },
          outcome: { status: 'blocked', blocker: 'needs a decision', decision: null },
        }),
      ],
    ]);
    const { execution } = listExecutions(dir)[0]!;
    expect(execution.status).toBe('blocked');
    expect(executionBlocker(execution)).toBe('needs a decision');
    expect(executionDecision(execution)).toBeNull();
  });

  it('reads created_at and completed_at, and leaves completed_at absent when not recorded', () => {
    const dir = sessionWith([
      [
        '0001-a--attempt-01',
        record('0001-a--attempt-01', { created_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-01T10:05:00Z' }),
      ],
      ['0002-b--attempt-01', record('0002-b--attempt-01')],
    ]);
    expect(listExecutions(dir).map((row) => [row.execution.created_at, row.execution.completed_at ?? null])).toEqual([
      ['2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z'],
      ['2026-11-01T10:00:00Z', null],
    ]);
  });

  it('reads options.effort, and null when absent or not a string', () => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { options: { effort: 'high' } })],
      ['0002-b--attempt-01', record('0002-b--attempt-01', { options: {} })],
      ['0003-c--attempt-01', record('0003-c--attempt-01', { options: { effort: 3 } })],
      ['0004-d--attempt-01', record('0004-d--attempt-01', { options: 'high' })],
      ['0005-e--attempt-01', record('0005-e--attempt-01')],
    ]);
    expect(listExecutions(dir).map((row) => executionEffort(row.execution))).toEqual([
      'high',
      null,
      null,
      null,
      null,
    ]);
  });

  it('reads codex model_reasoning_effort when options.effort is absent, and prefers options.effort', () => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { options: { model_reasoning_effort: 'medium' } })],
      [
        '0002-b--attempt-01',
        record('0002-b--attempt-01', { options: { effort: 'high', model_reasoning_effort: 'low' } }),
      ],
      ['0003-c--attempt-01', record('0003-c--attempt-01', { options: { model_reasoning_effort: 7 } })],
    ]);
    expect(listExecutions(dir).map((row) => executionEffort(row.execution))).toEqual(['medium', 'high', null]);
  });

  it('reads turn_kind and outcome.status, and null when absent or not a string', () => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { turn_kind: 'answers', outcome: { status: 'question' } })],
      ['0002-b--attempt-01', record('0002-b--attempt-01', { turn_kind: 'continue', outcome: { status: 'complete' } })],
      ['0003-c--attempt-01', record('0003-c--attempt-01', { turn_kind: 4, outcome: { status: false } })],
      ['0004-d--attempt-01', record('0004-d--attempt-01')],
    ]);
    expect(
      listExecutions(dir).map((row) => [row.execution.turn_kind ?? null, executionOutcomeStatus(row.execution)]),
    ).toEqual([
      ['answers', 'question'],
      ['continue', 'complete'],
      [null, null],
      [null, null],
    ]);
  });

  it('reads the recorded failure reason and error as one cause, and null when none is recorded', () => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { failure_reason: 'verify_failed', error: 'tests  red' })],
      ['0002-b--attempt-01', record('0002-b--attempt-01', { outcome: { message: 'bad handoff' } })],
      ['0003-c--attempt-01', record('0003-c--attempt-01', { outcome: { status: 'error' } })],
    ]);
    expect(listExecutions(dir).map((row) => executionCause(row.execution))).toEqual([
      'verify failed: tests red',
      'bad handoff',
      null,
    ]);
    expect(executionCause(null)).toBeNull();
  });

  it('flags an execution that wrote failure.md, and only that one', () => {
    const dir = sessionWith([
      ['0001-a--attempt-01', record('0001-a--attempt-01', { status: 'failed', kind: 'verify' })],
      ['0002-b--attempt-01', record('0002-b--attempt-01', { status: 'failed' })],
    ]);
    writeFileSync(path.join(dir, 'executions', '0001-a--attempt-01', 'failure.md'), '# Failure');
    expect(listExecutions(dir).map((row) => [row.id, row.hasFailureReport])).toEqual([
      ['0001-a--attempt-01', true],
      ['0002-b--attempt-01', false],
    ]);
    expect(readExecutionSummary(path.join(dir, 'executions', '0001-a--attempt-01'))?.hasFailureReport).toBe(true);
    expect(listExecutions(dir).map((row) => row.execution.kind ?? null)).toEqual(['verify', null]);
    expect(readExecutionSummary(path.join(dir, 'executions', 'gone'))).toBeNull();
  });
});

describe('conforming fixtures (RC2)', () => {
  const sets = ['sessions', 'captured', 'synthetic'] as const;
  const files = sets.flatMap((set) =>
    readdirSync(path.join(fixtureRoot, set), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((session) => {
        const executions = path.join(fixtureRoot, set, session.name, 'executions');
        try {
          return readdirSync(executions, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(executions, entry.name));
        } catch {
          return [];
        }
      }),
  );

  it('finds execution fixtures to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((dir) => [path.relative(fixtureRoot, dir), dir] as const))(
    'accepts %s with its recorded values',
    (_name, dir) => {
      const raw = JSON.parse(readFileSync(path.join(dir, 'execution.json'), 'utf8')) as Record<string, unknown>;
      const parsed = readExecution(dir);
      expect(parsed).not.toBeNull();
      expect(parsed).toMatchObject({
        execution_id: raw.execution_id,
        execution_order: raw.execution_order,
        stage_id: raw.stage_id,
        stage_attempt: raw.stage_attempt,
        status: raw.status,
        created_at: raw.created_at,
      });
      expect(readExecutionSummary(dir)?.id).toBe(raw.execution_id);
    },
  );
});

describe('readExecution', () => {
  it('returns the contract record for an existing execution', () => {
    const parsed = readExecution(path.join(fixture('completed'), 'executions', '0001-plan--attempt-01'));
    expect(parsed?.client).toBe('claude');
    expect(parsed?.hostname).toBe('REDACTED_HOST');
  });

  it('null for a missing execution directory', () => {
    expect(readExecution(path.join(fixture('completed'), 'executions', 'nope'))).toBeNull();
  });

  it('null for a record that lacks a required field', () => {
    const dir = sessionWith([['0001-a--attempt-01', { status: 'completed' }]]);
    expect(readExecution(path.join(dir, 'executions', '0001-a--attempt-01'))).toBeNull();
  });
});
