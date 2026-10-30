import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listExecutions, parseExecutionId, readExecution } from './executions';

const fixture = (name: string): string =>
  path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', name);

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
      provider: 'claude',
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
});

describe('readExecution', () => {
  it('returns the full record for an existing execution', () => {
    const record = readExecution(path.join(fixture('completed'), 'executions', '0001-plan--attempt-01'));
    expect(record?.['provider']).toBe('claude');
    expect(record?.['hostname']).toBe('REDACTED_HOST');
  });

  it('null for a missing execution directory', () => {
    expect(readExecution(path.join(fixture('completed'), 'executions', 'nope'))).toBeNull();
  });
});
