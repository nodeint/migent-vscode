import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseStatus, readStatus } from './statusReader';

const okJson = JSON.stringify({
  session_id: 's1',
  status: 'completed',
  latest_execution_status: 'completed',
  blocked_by_execution_ids: ['0001-plan--attempt-01'],
  running_stages: [
    { execution_id: '0002-impl--attempt-01', stage_id: 'impl', provider: 'claude', event: 'provider.turn_started', summary: 's', updated_at: 't' },
    'garbage-row',
  ],
});

describe('parseStatus', () => {
  it('maps envelope fields to snake_case source keys', () => {
    const parsed = parseStatus(okJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe('completed');
    expect(parsed?.latestExecutionStatus).toBe('completed');
    expect(parsed?.blockedByExecutionIds).toEqual(['0001-plan--attempt-01']);
    expect(parsed?.runningStages).toEqual([
      {
        executionId: '0002-impl--attempt-01',
        stageId: 'impl',
        provider: 'claude',
        event: 'provider.turn_started',
        summary: 's',
        updatedAt: 't',
      },
    ]);
  });

  it('returns null for non-JSON, non-objects and arrays', () => {
    expect(parseStatus('{oops')).toBeNull();
    expect(parseStatus('null')).toBeNull();
    expect(parseStatus('[1]')).toBeNull();
  });
});

describe('readStatus', () => {
  it('missing: no file', () => {
    expect(readStatus(path.join(path.sep, 'no', 'such', 'status.json'))).toEqual({ kind: 'missing' });
  });

  it('error: file exists but does not parse', () => {
    const file = path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', 'corrupt-status', 'status.json');
    expect(readStatus(file).kind).toBe('error');
  });

  it('ok: parses the fixture status', () => {
    const file = path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', 'completed', 'status.json');
    const read = readStatus(file);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') {
      expect(read.status.status).toBe('completed');
      expect(read.status.latestDecision).toBe('approved');
    }
  });
});
