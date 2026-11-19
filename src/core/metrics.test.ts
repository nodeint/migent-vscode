import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isValid, SessionMetrics } from '@nodeint/migent-contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { EXCLUDED_EXECUTION_KEYS, parseMetrics, readMetrics } from './metrics';
import { METRICS_RELATIVE_PATH } from './paths';

const FIXTURE = path.join(__dirname, 'fixtures', 'sessions', 'completed');
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempSession(content?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-metrics-'));
  temps.push(dir);
  if (content !== undefined) {
    mkdirSync(path.dirname(path.join(dir, METRICS_RELATIVE_PATH)), { recursive: true });
    writeFileSync(path.join(dir, METRICS_RELATIVE_PATH), content);
  }
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
    expect(read.metrics.totals).toMatchObject({ executions: 2, wall_seconds: 1200, cost_partial: true, revisions: 1 });
    expect(read.metrics.totals.usage?.cost_usd).toBe(0.5);
    expect(read.metrics.totals.usage_missing?.cost_usd).toBe(1);
    expect(Object.keys(read.metrics.stages)).toEqual(['plan', 'review_plan']);
    expect(read.metrics.executions.map((item) => [item.execution_order, item.stage_id, item.client])).toEqual([
      [1, 'plan', 'claude'],
      [2, 'review_plan', 'codex'],
    ]);
  });

  it('keeps documented nulls instead of substituting 0', () => {
    const read = readMetrics(FIXTURE);
    if (read.kind !== 'ok') throw new Error('expected ok');
    const [first, second] = read.metrics.executions;
    expect(first?.usage?.reasoning_tokens).toBeNull();
    expect(second?.usage?.cost_usd).toBeNull();
    expect(second?.usage_missing?.cost_usd).toBe(1);
    expect(first?.verify).toBeNull();
    expect(first?.skip).toBeNull();
    expect(first?.resumes_execution_id).toBeNull();
  });

  it('copies none of the excluded execution keys', () => {
    const read = parseMetrics(
      file({
        executions: [
          execution({ argv: ['x'], agent_id: 'a', cli_version: '1', git_head: 'abc', git_dirty: true, error: 'boom' }),
        ],
      }),
    );
    if (read.kind !== 'ok') throw new Error('expected ok');
    for (const key of EXCLUDED_EXECUTION_KEYS) expect(read.metrics.executions[0]).not.toHaveProperty(key);
    expect(read.metrics.executions[0]).not.toHaveProperty('error');
    expect(Object.keys(read.metrics).sort()).toEqual(['executions', 'stages', 'totals']);
  });

  it('accepts a conforming record that omits every optional field', () => {
    const read = parseMetrics({
      totals: {},
      stages: { plan: {} },
      executions: [{ execution_id: 'e1', execution_order: 1, stage_id: 'plan', status: 'completed' }],
    });
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.metrics.executions[0]?.usage).toBeUndefined();
    expect(read.metrics.totals.wall_seconds).toBeUndefined();
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
    mkdirSync(path.join(dir, METRICS_RELATIVE_PATH), { recursive: true });
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

  it('keeps a stage id of __proto__', () => {
    const read = parseMetrics(JSON.parse('{"totals":{},"stages":{"__proto__":{"executions":2},"plan":{}},"executions":[]}'));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(Object.keys(read.metrics.stages)).toEqual(['__proto__', 'plan']);
    expect(Object.getOwnPropertyDescriptor(read.metrics.stages, '__proto__')?.value).toMatchObject({ executions: 2 });
  });

  it.each(['totals', 'stages', 'executions'])('is invalid when %s is missing or of the wrong type, without throwing', (field) => {
    for (const bad of [undefined, null, 7, 'x', true]) {
      const read = parseMetrics(file({ [field]: bad }));
      expect(read.kind).toBe('invalid');
      expect(JSON.stringify(read)).not.toMatch(/argv|agent/);
    }
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

  it.each(['execution_id', 'execution_order', 'stage_id', 'status'])(
    'rejects an execution whose required %s is missing or of the wrong type',
    (field) => {
      for (const bad of field === 'execution_order' ? [undefined, null, {}, '1', ''] : [undefined, null, 7, {}, '']) {
        expect(parseMetrics(file({ executions: [execution({ [field]: bad })] }))).toEqual({
          kind: 'invalid',
          error: 'execution 1 is malformed',
        });
      }
    },
  );

  it('ignores unknown fields and leaves absent numbers absent, never 0', () => {
    const read = parseMetrics(file({ future: { a: 1 }, executions: [execution({ extra: true })] }));
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.metrics.totals.wall_seconds).toBeUndefined();
    expect(read.metrics.totals.cost_partial).toBeUndefined();
    expect(read.metrics.totals.revisions).toBeUndefined();
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
    expect(skipped?.skip).toEqual({ reason: 'run_when was false' });
    expect(verified?.verify).toEqual({ runs: 3, red: 2, first_pass: false, failed_commands: ['pnpm gate'] });
    expect(verified?.resumes_execution_id).toBe('0001-plan--attempt-01');
    expect(verified?.routed_from).toBe('0002-review--attempt-01');
  });

  it('treats non-finite or non-numeric values as absent', () => {
    const read = parseMetrics(file({ totals: { wall_seconds: '12', turns: Number.NaN, usage: { cost_usd: '1' } } }));
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.metrics.totals.wall_seconds).toBeUndefined();
    expect(read.metrics.totals.turns).toBeUndefined();
    expect(read.metrics.totals.usage?.cost_usd).toBeUndefined();
  });
});

describe('plugin metrics file location', () => {
  it('is missing when only the legacy root metrics.json exists', () => {
    const dir = tempSession();
    writeFileSync(path.join(dir, 'metrics.json'), readFileSync(path.join(FIXTURE, METRICS_RELATIVE_PATH), 'utf8'));
    expect(readMetrics(dir)).toEqual({ kind: 'missing' });
  });

  it('is missing when plugins/ or plugins/metrics/ is absent', () => {
    const dir = tempSession();
    expect(readMetrics(dir)).toEqual({ kind: 'missing' });
    mkdirSync(path.join(dir, 'plugins'));
    expect(readMetrics(dir)).toEqual({ kind: 'missing' });
  });
});

describe('captured plugins/metrics/metrics.json against the contract', () => {
  it('conforms to the contract shape and still reads ok', () => {
    const value: unknown = JSON.parse(readFileSync(path.join(FIXTURE, METRICS_RELATIVE_PATH), 'utf8'));
    expect(isValid(SessionMetrics, value)).toBe(true);
    expect(parseMetrics(value).kind).toBe('ok');
  });
});
