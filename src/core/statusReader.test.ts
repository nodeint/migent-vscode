import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseStatus, readStatus } from './statusReader';
import { capturedDir, syntheticDir } from './testHelpers';

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

function statusOf(dir: string) {
  const read = readStatus(path.join(dir, 'status.json'));
  if (read.kind !== 'ok') throw new Error(`status.json did not read: ${read.kind}`);
  return read.status;
}

describe('parseStatus questions, outputs and provider event', () => {
  it('summarizes the pending questions of the captured question-pending sample', () => {
    const { questions, raw } = statusOf(capturedDir('question-pending'));
    expect(raw.status).toBe('question');
    expect(questions.map((question) => question.id)).toEqual(['1', '2', '3']);
    expect(questions[0]).toEqual({
      id: '1',
      question: 'Which editor theme should be the default?',
      context: expect.stringContaining('default theme'),
      selection: 'single',
      options: [
        { id: 'A', label: 'Follow system', description: expect.stringContaining('OS setting') },
        { id: 'B', label: 'Light', description: 'Always uses the light theme.' },
        { id: 'C', label: 'Dark', description: 'Always uses the dark theme.' },
      ],
      recommended: ['A'],
      executionId: '0001-planner--attempt-01',
      stageId: 'planner',
      recipient: 'human',
      file: 'executions/0001-planner--attempt-01/questions.json',
    });
    expect(questions[1]).toMatchObject({ selection: 'multiple', recommended: [] });
    expect(questions[1]?.options[0]?.description).toBeNull();
  });

  it('has no pending questions once the key is absent after the reply', () => {
    expect(statusOf(capturedDir('question-answered')).questions).toEqual([]);
  });

  it('reads pending questions in synthetic Running and Blocked sessions', () => {
    expect(statusOf(syntheticDir('running-questions')).questions).toHaveLength(1);
    const blocked = statusOf(syntheticDir('blocked-questions'));
    expect(blocked.questions.map((question) => question.stageId)).toEqual(['review', 'plan']);
    expect(blocked.blockedByExecutionIds).toEqual(['0002-review--attempt-01']);
  });

  it('skips question records without an id or text instead of guessing', () => {
    const parsed = parseStatus(JSON.stringify({ questions: [{ id: '1' }, 'x', { id: '2', question: 'ok?' }] }));
    expect(parsed?.questions.map((question) => question.id)).toEqual(['2']);
  });

  it('reads the outputs map in file order and skips entries without a path', () => {
    expect(statusOf(capturedDir('handoff-source')).outputs).toEqual([
      {
        name: 'note',
        path: 'outputs/note.md',
        sourceExecutionId: '0001-draft--attempt-01',
        publishedByExecutionId: '0001-draft--attempt-01',
      },
    ]);
    const parsed = parseStatus(JSON.stringify({ outputs: { a: { path: 'outputs/a.md' }, b: {}, c: 3 } }));
    expect(parsed?.outputs.map((output) => output.name)).toEqual(['a']);
  });

  it('keeps only the small scalar fields of latest_provider_event', () => {
    const event = {
      v: 2,
      event: 'provider.turn_completed',
      summary: 'completed',
      stage_id: 'planner',
      execution_id: '0001-planner--attempt-01',
      provider: 'claude',
      timestamp: '2026-11-01T11:17:13.282+00:00',
      details: { argv: Array.from({ length: 5000 }, (_, i) => `--flag-${i}`) },
      data: { usage: { input_tokens: 1 } },
    };
    const parsed = parseStatus(JSON.stringify({ status: 'active', latest_provider_event: event }));
    expect(parsed?.latestProviderEvent).toEqual({
      event: 'provider.turn_completed',
      summary: 'completed',
      stageId: 'planner',
      executionId: '0001-planner--attempt-01',
      provider: 'claude',
      timestamp: '2026-11-01T11:17:13.282+00:00',
    });
    expect(parsed?.raw).not.toHaveProperty('latest_provider_event');
    expect(JSON.stringify(parsed)).not.toContain('--flag-4999');
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
