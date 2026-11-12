import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listExecutions, parseExecutionId, readExecution, readExecutionSummary } from './executions';

const fixture = (name: string): string =>
  path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', name);

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

describe('listExecutions', () => {
  it('reads summaries oldest first, including decisions', () => {
    const rows = listExecutions(fixture('completed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '0001-plan--attempt-01',
      order: 1,
      stage: 'plan',
      attempt: 1,
      status: 'completed',
      decision: null,
      client: 'claude',
      model: 'sonnet',
    });
  });

  it('returns [] when there is no executions directory', () => {
    expect(listExecutions(fixture('prepared'))).toEqual([]);
  });

  it('falls back to the directory name when execution.json is missing', () => {
    const rows = listExecutions(fixture('blocked'));
    expect(rows[0]?.id).toBe('0001-plan--attempt-01');
    expect(rows[0]?.stage).toBe('plan');
  });

  it('reads the recorded blocker text, and null when the outcome has none', () => {
    expect(listExecutions(fixture('blocked'))[0]?.blocker).toBe('needs a decision');
    expect(listExecutions(fixture('completed'))[0]?.blocker).toBeNull();
  });

  it('reads a protocol 3 execution.json like a protocol 2 one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-execs-'));
    temps.push(dir);
    const executionDir = path.join(dir, 'executions', '0001-plan--attempt-01');
    mkdirSync(executionDir, { recursive: true });
    writeFileSync(
      path.join(executionDir, 'execution.json'),
      JSON.stringify({
        status: 'blocked',
        response_protocol: 3,
        corrections: [{ kind: 'handoff_file_invalid', turn: 2 }],
        outcome: { status: 'blocked', blocker: 'needs a decision', decision: null },
      }),
    );
    expect(listExecutions(dir)[0]).toMatchObject({ status: 'blocked', blocker: 'needs a decision', decision: null });
  });

  it('reads created_at and completed_at, and null when absent', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-execs-'));
    temps.push(dir);
    for (const [id, record] of [
      ['0001-a--attempt-01', { created_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-01T10:05:00Z' }],
      ['0002-b--attempt-01', {}],
    ] as const) {
      const executionDir = path.join(dir, 'executions', id);
      mkdirSync(executionDir, { recursive: true });
      writeFileSync(path.join(executionDir, 'execution.json'), JSON.stringify(record));
    }
    expect(listExecutions(dir).map((execution) => [execution.createdAt, execution.completedAt])).toEqual([
      ['2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z'],
      [null, null],
    ]);
  });

  it('flags an execution that wrote failure.md, and only that one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-execs-'));
    temps.push(dir);
    for (const [id, failure] of [['0001-a--attempt-01', true], ['0002-b--attempt-01', false]] as const) {
      const executionDir = path.join(dir, 'executions', id);
      mkdirSync(executionDir, { recursive: true });
      writeFileSync(path.join(executionDir, 'execution.json'), JSON.stringify({ status: 'failed', ...(failure ? { kind: 'verify' } : {}) }));
      if (failure) writeFileSync(path.join(executionDir, 'failure.md'), '# Failure');
    }
    expect(listExecutions(dir).map((execution) => [execution.id, execution.hasFailureReport])).toEqual([
      ['0001-a--attempt-01', true],
      ['0002-b--attempt-01', false],
    ]);
    expect(readExecutionSummary(path.join(dir, 'executions', '0001-a--attempt-01'))?.hasFailureReport).toBe(true);
    expect(listExecutions(dir).map((execution) => execution.kind)).toEqual(['verify', null]);
    expect(readExecutionSummary(path.join(dir, 'executions', 'gone'))).toBeNull();
  });
});

describe('readExecution', () => {
  it('returns the full record for an existing execution', () => {
    const record = readExecution(path.join(fixture('completed'), 'executions', '0001-plan--attempt-01'));
    expect(record?.['client']).toBe('claude');
    expect(record?.['hostname']).toBe('REDACTED_HOST');
  });

  it('null for a missing execution directory', () => {
    expect(readExecution(path.join(fixture('completed'), 'executions', 'nope'))).toBeNull();
  });
});
