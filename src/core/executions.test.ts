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

  it('flags an execution that wrote failure.md, and only that one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-execs-'));
    temps.push(dir);
    for (const [id, failure] of [['0001-a--attempt-01', true], ['0002-b--attempt-01', false]] as const) {
      const executionDir = path.join(dir, 'executions', id);
      mkdirSync(executionDir, { recursive: true });
      writeFileSync(path.join(executionDir, 'execution.json'), JSON.stringify({ status: 'failed' }));
      if (failure) writeFileSync(path.join(executionDir, 'failure.md'), '# Failure');
    }
    expect(listExecutions(dir).map((execution) => [execution.id, execution.hasFailureReport])).toEqual([
      ['0001-a--attempt-01', true],
      ['0002-b--attempt-01', false],
    ]);
    expect(readExecutionSummary(path.join(dir, 'executions', '0001-a--attempt-01'))?.hasFailureReport).toBe(true);
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
