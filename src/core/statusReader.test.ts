import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import { publishedOutputs } from './outputs';
import { parseStatus, providerEventField, providerRetryAt, readStatus } from './statusReader';
import { capturedDir, syntheticDir } from './testHelpers';

const okJson = JSON.stringify({
  session_id: 's1',
  status: 'completed',
  latest_execution_status: 'completed',
  // The contract does not declare these; they are not read (B6).
  blocked_by_execution_ids: ['0001-plan--attempt-01'],
  running_stages: [{ execution_id: '0002-impl--attempt-01', stage_id: 'impl' }],
  questions: [{ id: '1', question: 'q?' }],
});

function statusOf(dir: string) {
  const read = readStatus(path.join(dir, 'status.json'));
  if (read.kind !== 'ok') throw new Error(`status.json did not read: ${read.kind}`);
  return read.status;
}

describe('parseStatus', () => {
  it('reads the contract fields under their snake_case names', () => {
    expect(parseStatus(okJson)).toEqual({ session_id: 's1', status: 'completed', latest_execution_status: 'completed' });
  });

  it('does not read questions, running_stages or blocked_by_execution_ids', () => {
    const parsed = parseStatus(okJson);
    expect(parsed).not.toHaveProperty('questions');
    expect(parsed).not.toHaveProperty('running_stages');
    expect(parsed).not.toHaveProperty('blocked_by_execution_ids');
  });

  it('returns null for non-JSON, non-objects and arrays', () => {
    expect(parseStatus('{oops')).toBeNull();
    expect(parseStatus('null')).toBeNull();
    expect(parseStatus('[1]')).toBeNull();
  });

  it('reads a numeric session_id as the same string as a quoted one', () => {
    expect(parseStatus('{"session_id":3,"status":"active"}')).toEqual(parseStatus('{"session_id":"3","status":"active"}'));
    expect(parseStatus('{"session_id":3,"status":"active"}')?.session_id).toBe('3');
  });

  it('drops a wrong-typed optional field and keeps the record', () => {
    const parsed = parseStatus(
      JSON.stringify({ session_id: 's1', status: 'active', title: 5, latest_stage_id: ['a'], outputs: 'x', baseline: [], handoff: 1 }),
    );
    expect(parsed).toEqual({ session_id: 's1', status: 'active' });
  });

  // RC1: each required field, missing and wrong-typed, on an otherwise valid record.
  describe.each(['session_id', 'status'])('required field %s', (field) => {
    const valid = { session_id: 's1', status: 'active' };
    const without = (value: unknown): string => JSON.stringify({ ...valid, [field]: value });

    it('accepts the otherwise valid record', () => {
      expect(parseStatus(JSON.stringify(valid))).toEqual(valid);
    });

    it('rejects a record without it', () => {
      const rest = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
      expect(parseStatus(JSON.stringify(rest))).toBeNull();
    });

    it.each([[1.5], [-1], [true], [null], [['a']], [{ a: 1 }], ['']])('rejects the wrong-typed value %j', (value) => {
      expect(parseStatus(without(value))).toBeNull();
    });

    it('reads as an invalid status file, which displays as Unknown invalid-status', () => {
      const dir = path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', 'corrupt-status', 'status.json');
      expect(readStatus(dir)).toEqual({ kind: 'error', reason: 'invalid' });
      const state = deriveDisplayState({ status: null, statusError: 'invalid', manifest: 'ok' }, { kind: 'none' });
      expect(state).toMatchObject({ state: 'unknown', unknownReason: 'invalid-status' });
    });
  });
});

describe('parseStatus outputs and provider event', () => {
  it('has no pending questions to read from the captured question-pending sample (B6)', () => {
    const status = statusOf(capturedDir('question-pending'));
    expect(status.status).toBe('question');
    expect(status).not.toHaveProperty('questions');
  });

  it('keeps the blocked and running synthetic sessions without the dropped fields (B6)', () => {
    expect(statusOf(syntheticDir('running-questions'))).not.toHaveProperty('questions');
    const blocked = statusOf(syntheticDir('blocked-questions'));
    expect(blocked.status).toBe('blocked');
    expect(blocked).not.toHaveProperty('blocked_by_execution_ids');
  });

  it('reads the outputs map keyed by name and skips entries without a path', () => {
    expect(statusOf(capturedDir('handoff-source')).outputs).toEqual({
      note: {
        path: 'outputs/note.md',
        source_execution_id: '0001-draft--attempt-01',
        published_by_execution_id: '0001-draft--attempt-01',
      },
    });
    const parsed = parseStatus(
      JSON.stringify({ session_id: 's1', status: 'active', outputs: { a: { path: 'outputs/a.md' }, b: {}, c: 3 } }),
    );
    expect(Object.keys(parsed?.outputs ?? {})).toEqual(['a']);
  });

  it('keeps an output named __proto__ as an own entry', () => {
    const parsed = parseStatus(
      '{"session_id":"s1","status":"completed","outputs":{"__proto__":{"path":"outputs/result.md"},"note":{"path":"outputs/n.md"}}}',
    );
    expect(Object.keys(parsed?.outputs ?? {})).toEqual(['__proto__', 'note']);
    expect(Object.getPrototypeOf(parsed?.outputs)).toBe(Object.prototype);
    expect(publishedOutputs(parsed).map(([name]) => name)).toEqual(['__proto__', 'note']);
  });

  it('keeps only the small scalar fields of latest_provider_event', () => {
    const event = {
      v: 2,
      event: 'provider.turn_completed',
      summary: 'completed',
      stage_id: 'planner',
      execution_id: '0001-planner--attempt-01',
      client: 'claude',
      timestamp: '2026-11-01T11:17:13.282+00:00',
      details: { argv: Array.from({ length: 5000 }, (_, i) => `--flag-${i}`) },
      data: { usage: { input_tokens: 1 } },
    };
    const parsed = parseStatus(JSON.stringify({ session_id: 's1', status: 'active', latest_provider_event: event }));
    expect(parsed?.latest_provider_event).toEqual({
      event: 'provider.turn_completed',
      summary: 'completed',
      stage_id: 'planner',
      execution_id: '0001-planner--attempt-01',
      client: 'claude',
      timestamp: '2026-11-01T11:17:13.282+00:00',
    });
    expect(JSON.stringify(parsed)).not.toContain('--flag-4999');
    expect(providerEventField(parsed, 'stage_id')).toBe('planner');
    expect(providerEventField(parsed, 'client')).toBe('claude');
    expect(providerEventField(null, 'client')).toBeNull();
  });
});

describe('parseStatus quota event', () => {
  it('reads details.retry_at and treats an empty value as absent', () => {
    const quota = (retryAt: string) =>
      providerRetryAt(
        parseStatus(
          JSON.stringify({
            session_id: 's1',
            status: 'active',
            latest_provider_event: { event: 'provider.quota', details: { retry_at: retryAt } },
          }),
        ),
      );
    expect(quota('2026-11-03T12:00:00.000+00:00')).toBe('2026-11-03T12:00:00.000+00:00');
    expect(quota('')).toBeNull();
    expect(quota('  ')).toBeNull();
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
      expect(read.status.latest_decision).toBe('approved');
    }
  });
});

// RC2: every conforming fixture status.json is accepted. `corrupt-status` is the one fixture that is not JSON.
describe('fixture status files', () => {
  const root = path.join(__dirname, 'fixtures');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'status.json') files.push(full);
    }
  };
  walk(root);

  it('finds the fixture status files', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  // The value each fixture must read as: the file's contract fields with only the approved normalization (a numeric id
  // becomes a string). `questions`, `running_stages` and `blocked_by_execution_ids` are omitted (B6); a provider event
  // keeps only its scalar fields and `details.retry_at`.
  const stringFields = ['title', 'workflow_id', 'workflow_path', 'task', 'created_at', 'updated_at', 'task_sha256',
    'latest_execution_id', 'latest_execution_status', 'latest_stage_id', 'latest_decision', 'completion_method', 'terminal_execution_id'];
  const eventFields = ['event', 'summary', 'stage_id', 'execution_id', 'client', 'timestamp'];
  const idOf = (value: unknown): string | undefined =>
    typeof value === 'number' ? String(value) : typeof value === 'string' && value !== '' ? value : undefined;
  const expectedOf = (raw: Record<string, unknown>): Record<string, unknown> => {
    const expected: Record<string, unknown> = { session_id: idOf(raw.session_id), status: raw.status };
    for (const name of stringFields) if (typeof raw[name] === 'string' && raw[name] !== '') expected[name] = raw[name];
    if (idOf(raw.prior_session_id) !== undefined) expected.prior_session_id = idOf(raw.prior_session_id);
    for (const name of ['handoff', 'baseline', 'outputs']) if (typeof raw[name] === 'object' && raw[name] !== null) expected[name] = raw[name];
    const event = raw.latest_provider_event as Record<string, unknown> | undefined;
    if (event !== undefined) {
      const kept: Record<string, unknown> = {};
      for (const name of eventFields) if (typeof event[name] === 'string' && event[name] !== '') kept[name] = event[name];
      const retryAt = (event.details as Record<string, unknown> | undefined)?.retry_at;
      if (typeof retryAt === 'string' && retryAt.trim() !== '') kept.details = { retry_at: retryAt.trim() };
      expected.latest_provider_event = kept;
    }
    return expected;
  };

  it.each(files.map((file) => [path.relative(root, file).replaceAll('\\', '/'), file]))('accepts %s', (name, file) => {
    const read = readStatus(file);
    if (name === 'sessions/corrupt-status/status.json') {
      expect(read.kind).toBe('error');
      return;
    }
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.status).toEqual(expectedOf(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
  });
});
