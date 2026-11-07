import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseMetrics, readMetrics } from './metrics';
import { METRICS_FILENAME } from './paths';

const FIXTURE = path.join(__dirname, 'fixtures', 'sessions', 'completed');
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempSession(content?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-metrics-'));
  temps.push(dir);
  if (content !== undefined) writeFileSync(path.join(dir, METRICS_FILENAME), content);
  return dir;
}

const usage = {
  input_tokens: 1,
  output_tokens: 2,
  reasoning_tokens: null,
  cache_read_tokens: 3,
  cache_write_tokens: 4,
  cost_usd: null,
};

function execution(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    execution_id: '0001-plan--attempt-01',
    execution_order: 1,
    stage_id: 'plan',
    stage_attempt: 1,
    role: null,
    client: null,
    model: null,
    status: 'completed',
    usage,
    usage_missing: usage,
    verify: null,
    skip: null,
    ...extra,
  };
}

const file = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  totals: { usage, usage_missing: usage },
  stages: { plan: { executions: 1 } },
  executions: [execution()],
  ...extra,
});

describe('readMetrics', () => {
  it('reads the fixture metrics.json', () => {
    const read = readMetrics(FIXTURE);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.metrics.totals).toMatchObject({ executions: 2, wallSeconds: 1200, costPartial: true, revisions: 1 });
    expect(read.metrics.totals.usage.costUsd).toBe(0.5);
    expect(read.metrics.totals.usageMissing.costUsd).toBe(1);
    expect(read.metrics.stages.map((stage) => stage.id)).toEqual(['plan', 'review_plan']);
    expect(read.metrics.executions.map((item) => [item.order, item.stageId, item.client])).toEqual([
      [1, 'plan', 'claude'],
      [2, 'review_plan', 'codex'],
    ]);
  });

  it('keeps documented nulls instead of substituting 0', () => {
    const read = readMetrics(FIXTURE);
    if (read.kind !== 'ok') throw new Error('expected ok');
    const [first, second] = read.metrics.executions;
    expect(first?.usage.reasoningTokens).toBeNull();
    expect(second?.usage.costUsd).toBeNull();
    expect(second?.usageMissing.costUsd).toBe(1);
    expect(first?.verify).toBeNull();
    expect(first?.skipReason).toBeNull();
    expect(first?.resumesExecutionId).toBeNull();
  });

  it('never returns argv, agent id, CLI version, git fields or machine paths', () => {
    const read = readMetrics(FIXTURE);
    if (read.kind !== 'ok') throw new Error('expected ok');
    const json = JSON.stringify(read);
    for (const secret of ['argv', 'agent', 'cli_version', 'cliVersion', 'git', 'secret', '0123456789abcdef', 'Test CLI']) {
      expect(json).not.toContain(secret);
    }
  });

  it('is missing when the file or the session folder does not exist', () => {
    expect(readMetrics(tempSession())).toEqual({ kind: 'missing' });
    expect(readMetrics(path.join(tempSession(), 'absent'))).toEqual({ kind: 'missing' });
  });

  it('is missing when a path segment is a file (ENOTDIR)', () => {
    const dir = tempSession();
    writeFileSync(path.join(dir, 'blocker'), 'x');
    expect(readMetrics(path.join(dir, 'blocker'))).toEqual({ kind: 'missing' });
  });

  it('is unreadable with the error code when the file cannot be read', () => {
    const dir = tempSession();
    mkdirSync(path.join(dir, METRICS_FILENAME));
    const read = readMetrics(dir);
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.error).toMatch(/^E[A-Z]+$/);
  });

  it('is invalid for unparsable JSON and for a non-object', () => {
    expect(readMetrics(tempSession('{ not json'))).toEqual({ kind: 'invalid', error: 'not valid JSON' });
    expect(readMetrics(tempSession('')).kind).toBe('invalid');
    expect(readMetrics(tempSession('[]'))).toEqual({ kind: 'invalid', error: 'not a JSON object' });
    expect(readMetrics(tempSession('null'))).toEqual({ kind: 'invalid', error: 'not a JSON object' });
    expect(readMetrics(tempSession('7'))).toEqual({ kind: 'invalid', error: 'not a JSON object' });
  });
});

describe('parseMetrics', () => {
  it('does not echo file contents when the JSON is malformed', () => {
    const read = readMetrics(tempSession('{"argv":secret-value, "agent_id": oops}'));
    expect(read).toEqual({ kind: 'invalid', error: 'not valid JSON' });
    expect(JSON.stringify(read)).not.toMatch(/secret|argv|agent/);
    expect(JSON.stringify(parseMetrics(file({ stages: { argv: 1 } })))).not.toContain('argv');
  });

  it('is invalid when totals, stages or executions have the wrong shape', () => {
    expect(parseMetrics(file({ totals: [] }))).toEqual({ kind: 'invalid', error: 'totals is not an object' });
    expect(parseMetrics(file({ totals: undefined })).kind).toBe('invalid');
    expect(parseMetrics(file({ stages: 'x' }))).toEqual({ kind: 'invalid', error: 'stages is not an object' });
    expect(parseMetrics(file({ stages: { plan: 3 } }))).toEqual({ kind: 'invalid', error: 'a stage is not an object' });
    expect(parseMetrics(file({ executions: {} }))).toEqual({ kind: 'invalid', error: 'executions is not a list' });
    expect(parseMetrics(file({ executions: [3] }))).toEqual({ kind: 'invalid', error: 'execution 1 is malformed' });
    expect(parseMetrics(file({ executions: [execution(), execution({ status: undefined })] }))).toEqual({
      kind: 'invalid',
      error: 'execution 2 is malformed',
    });
  });

  it('ignores unknown fields and keeps absent numbers null', () => {
    const read = parseMetrics(file({ future: { a: 1 }, executions: [execution({ extra: true })] }));
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.metrics.totals.wallSeconds).toBeNull();
    expect(read.metrics.totals.costPartial).toBeNull();
    expect(read.metrics.totals.revisions).toBeNull();
    expect(read.metrics.executions[0]).not.toHaveProperty('extra');
  });

  it('reads the skip reason, the verify summary and the route links', () => {
    const read = parseMetrics(
      file({
        executions: [
          execution({ status: 'skipped', skip: { reason: 'run_when was false', other: 1 } }),
          execution({
            execution_order: 2,
            verify: { runs: 3, red: 2, first_pass: false, failed_commands: ['pnpm gate', 4] },
            resumes_execution_id: '0001-plan--attempt-01',
            routed_from: '0002-review--attempt-01',
          }),
        ],
      }),
    );
    if (read.kind !== 'ok') throw new Error('expected ok');
    const [skipped, verified] = read.metrics.executions;
    expect(skipped?.skipReason).toBe('run_when was false');
    expect(verified?.verify).toEqual({ runs: 3, red: 2, firstPass: false, failedCommands: ['pnpm gate'] });
    expect(verified?.resumesExecutionId).toBe('0001-plan--attempt-01');
    expect(verified?.routedFrom).toBe('0002-review--attempt-01');
  });

  it('treats non-finite or non-numeric values as absent', () => {
    const read = parseMetrics(file({ totals: { wall_seconds: '12', turns: Number.NaN, usage: { cost_usd: '1' } } }));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.metrics.totals.wallSeconds).toBeNull();
    expect(read.metrics.totals.turns).toBeNull();
    expect(read.metrics.totals.usage.costUsd).toBeNull();
  });
});
