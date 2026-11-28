import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { EventEntry } from './eventTail';
import { readRecentEvents } from './eventTail';
import type { ExecutionEntry } from './executions';
import type { SessionSnapshot } from './model';
import { buildOverviewModel, nextStepAction, type OverviewInput } from './overviewModel';
import type { ResultsNext, ResultsSuggestion } from './resultsModel';
import { buildResultsModel } from './resultsModel';
import { NO_SESSION_SUMMARY } from './sessionSummary';
import { executionEntry } from './testHelpers';
import { capturedDir, snapshotFromDir } from './testHelpers';

const SOURCE = '00000000-0000-4000-8000-0000000000b1';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sourceSnapshot(): SessionSnapshot {
  return { ...snapshotFromDir(capturedDir('handoff-source')), sessionId: SOURCE };
}

function sourceInput(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    sessionId: SOURCE,
    sessionDirPath: capturedDir('handoff-source'),
    snapshots: [sourceSnapshot()],
    eligibleIds: [SOURCE],
    workflows: [],
    executions: [],
    plan: { kind: 'missing' },
    events: [],
    ...overrides,
  };
}

function recentEvents(count: number): EventEntry[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-overview-events-'));
  temps.push(dir);
  const file = path.join(dir, 'events.jsonl');
  const lines = Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      v: 2,
      seq: index + 1,
      event: 'execution.started',
      timestamp: '2026-11-01T11:00:00.000Z',
      execution_id: '0001-draft--attempt-01',
      stage_id: 'draft',
      summary: `line-${index + 1}`,
      data: {},
    }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  return readRecentEvents(file, 5);
}

function runningSnapshot(): SessionSnapshot {
  const base = sourceSnapshot();
  const {status} = base;
  if (status === null) throw new Error('captured source has no status');
  return {
    ...base,
    displayState: { state: 'running', icon: 'sync~spin', writable: true },
    status: {
      ...status,
      // B6: `running_stages` is not read, so the running stage comes from `latest_stage_id` and the provider event.
      latest_stage_id: 'draft',
      latest_provider_event: { event: 'provider.turn_started', summary: 'drafting', stage_id: 'draft' },
    },
  };
}

function roleSnapshot(): SessionSnapshot {
  const base = sourceSnapshot();
  if (base.manifest === null) throw new Error('captured source has no manifest');
  return {
    ...base,
    displayState: { state: 'completed', icon: 'pass', writable: true },
    manifest: { ...base.manifest, schema_version: 2, workflow_id: 'plan', role: 'reviewer' },
    replyTargets: [
      { executionId: '0001-review--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' },
    ],
  };
}

function execution(id: string, stage: string, status: string): ExecutionEntry {
  return executionEntry({ id, stage, status });
}

describe('buildOverviewModel', () => {
  it('keeps the results blocks and adds the overview fields', () => {
    const input = sourceInput();
    const model = buildOverviewModel(input);

    expect(model).toMatchObject(buildResultsModel(input));
    expect(model.summary.state).toBe('completed');
    expect(model.progress).toEqual({
      kind: 'executions',
      rows: [],
      totals: { activeSeconds: null, wallSeconds: null, usage: null, costMissing: 0 },
    });
    expect(model.activity).toEqual({ visible: false });
    expect(model.actions).toEqual({ primary: null, secondary: [] });
  });

  it('counts the pending recorded questions in the summary', () => {
    const entry = (status: 'pending' | 'answered') => ({ item: {}, status, answer: null, answeredAt: null });
    const questions = [entry('pending'), entry('answered'), entry('pending')] as unknown as OverviewInput['questions'];
    expect(buildOverviewModel(sourceInput({ questions })).summary.pendingQuestions).toBe(2);
    expect(buildOverviewModel(sourceInput()).summary.pendingQuestions).toBe(0);
  });

  it('hides activity for a non-Running session even when events are supplied', () => {
    const model = buildOverviewModel(sourceInput({ events: recentEvents(7) }));

    expect(model.summary.isRunning).toBe(false);
    expect(model.activity).toEqual({ visible: false });
  });

  it('shows the five newest activity lines and the running facts for a Running session', () => {
    const model = buildOverviewModel(sourceInput({
      snapshots: [runningSnapshot()],
      executions: [execution('0001-draft--attempt-01', 'draft', 'running')],
      plan: { kind: 'ok', stages: ['draft', 'review'] },
      events: recentEvents(7),
    }));

    expect(model.summary).toMatchObject({ runningStage: null, runningSummary: 'drafting' });
    expect(model.activity.visible).toBe(true);
    if (model.activity.visible) {
      expect(model.activity.lines).toHaveLength(5);
      expect(model.activity.lines[0]).toContain('line-3');
      expect(model.activity.lines[4]).toContain('line-7');
    }
    expect(model.progress).toMatchObject({
      kind: 'stages',
      rows: [
        { id: 'draft', state: 'running', isCurrent: true },
        { id: 'review', state: 'not-run', isCurrent: false },
      ],
    });
    expect(model.actions).toEqual({ primary: 'showLog', secondary: ['stop'] });
  });

  it('lists executions for a role session and offers Reply when it can be sent', () => {
    const model = buildOverviewModel(sourceInput({
      snapshots: [roleSnapshot()],
      executions: [execution('0001-review--attempt-01', 'review', 'completed')],
    }));

    expect(model.progress).toMatchObject({
      kind: 'executions',
      rows: [{ executionId: '0001-review--attempt-01', state: 'completed' }],
    });
    expect(model.summary.latestExecution?.id).toBe('0001-review--attempt-01');
    expect(model.actions).toEqual({ primary: null, secondary: ['reply'] });
  });

  it('returns the unavailable defaults for a session the page cannot see', () => {
    const model = buildOverviewModel(sourceInput({ sessionId: 'gone', snapshots: [] }));

    expect(model.availability).toBe('unavailable');
    expect(model.summary).toEqual(NO_SESSION_SUMMARY);
    expect(model.progress).toEqual({ kind: 'empty' });
    expect(model.activity).toEqual({ visible: false });
    expect(model.actions).toEqual({ primary: null, secondary: [] });
  });
});

function suggestion(workflow: string, launch: ResultsSuggestion['launch'], ran = false): ResultsSuggestion {
  return {
    workflow,
    task: null,
    declared: true,
    target: 'available',
    launch,
    children: ran ? [{ sessionId: 'c', title: 't', state: 'Completed', createdAt: null }] : [],
    artifacts: [],
    recommendedBy: [],
  };
}

const NO_RECOMMENDATIONS: ResultsNext['recommendations'] = { state: 'missing', detail: null, notes: [], count: 0 };

const READY = { state: 'ready' } as const;
const BLOCKED = { state: 'blocked', reason: 'notDeclared' } as const;

function nextOf(...suggestions: ResultsSuggestion[]): ResultsNext {
  return { state: 'ok', detail: null, suggestions, recommendations: NO_RECOMMENDATIONS };
}

describe('nextStepAction', () => {
  it('runs the one actionable suggestion, even beside a blocked one', () => {
    expect(nextStepAction('completed', nextOf(suggestion('a', READY)))).toEqual({ kind: 'run', workflow: 'a' });
    expect(nextStepAction('completed', nextOf(suggestion('a', READY), suggestion('b', BLOCKED)))).toEqual({
      kind: 'run',
      workflow: 'a',
    });
  });

  it('asks to choose only among actionable suggestions', () => {
    expect(nextStepAction('completed', nextOf(suggestion('a', READY), suggestion('b', READY)))).toEqual({
      kind: 'choose',
      count: 2,
    });
    expect(
      nextStepAction('completed', nextOf(suggestion('a', READY), suggestion('b', READY), suggestion('c', BLOCKED))),
    ).toEqual({ kind: 'choose', count: 2 });
  });

  it('reports blocked, never run, when no suggestion can launch', () => {
    for (const reason of ['notDeclared', 'declarationUnreadable', 'targetNotFound', 'targetInvalid', 'targetDuplicate'] as const) {
      expect(nextStepAction('completed', nextOf(suggestion('a', { state: 'blocked', reason })))).toEqual({
        kind: 'blocked',
        count: 1,
      });
    }
  });

  it('is done when every suggestion already ran or there are none', () => {
    expect(nextStepAction('completed', nextOf(suggestion('a', READY, true)))).toEqual({ kind: 'done' });
    expect(nextStepAction('completed', nextOf())).toEqual({ kind: 'done' });
    expect(nextStepAction('completed', { state: 'missing', detail: null, suggestions: [], recommendations: NO_RECOMMENDATIONS })).toEqual({ kind: 'done' });
  });

  it('does not change with recommendations (AC8)', () => {
    const withRecommendations: ResultsNext = {
      ...nextOf(suggestion('a', READY), suggestion('b', READY)),
      recommendations: {
        state: 'ok',
        detail: null,
        count: 2,
        notes: [{ stageId: 'design', workflow: null, reason: 'none', warning: null }],
      },
    };
    const suggestions = [{ ...suggestion('a', READY), recommendedBy: [{ stageId: 'design', reason: 'r' }] }, suggestion('b', READY)];
    for (const next of [nextOf(...suggestions), withRecommendations, { ...withRecommendations, suggestions }]) {
      expect(nextStepAction('completed', next)).toEqual({ kind: 'choose', count: 2 });
    }
  });

  it('is null for a session that is not Completed or an unusable next.json', () => {
    expect(nextStepAction('running', nextOf(suggestion('a', READY)))).toBeNull();
    expect(nextStepAction('completed', { state: 'invalid', detail: 'x', suggestions: [], recommendations: NO_RECOMMENDATIONS })).toBeNull();
  });
});
