import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSessionMetricsModel, type SessionMetricsModel, sessionMetricsPanelTitle } from './sessionMetricsModel';
import { snapshotFromDir } from './testHelpers';

const FIXTURE = path.join(__dirname, 'fixtures', 'sessions', 'completed');
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A session folder without metrics.json, or with the given content. */
function session(metrics?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-metricsmodel-'));
  temps.push(dir);
  cpSync(path.join(FIXTURE, 'status.json'), path.join(dir, 'status.json'));
  if (metrics !== undefined) writeFileSync(path.join(dir, 'metrics.json'), metrics);
  return dir;
}

const snapshot = snapshotFromDir(FIXTURE);
const build = (sessionDirPath: string): SessionMetricsModel =>
  buildSessionMetricsModel({ sessionId: snapshot.sessionId, sessionDirPath, snapshots: [snapshot] });

describe('buildSessionMetricsModel', () => {
  it('builds the ok model of a completed session with metrics', () => {
    const model = build(FIXTURE);
    expect(model).toMatchObject({
      availability: 'ok',
      sessionId: snapshot.sessionId,
      title: 'Plan the feature',
      state: 'Completed',
      workflowId: 'plan',
      completedAt: '2026-10-26T09:20:00.000+00:00',
      meta: { isRunning: false, pendingQuestions: 0 },
    });
    expect(model.metrics.kind).toBe('ok');
    if (model.metrics.kind !== 'ok') return;
    expect(model.metrics.totals.costPartial).toBe(true);
    expect(model.metrics.stages.map((stage) => stage.id)).toEqual(['plan', 'review_plan']);
    expect(model.metrics.executions).toHaveLength(2);
  });

  it('keeps nullable values as null and passes no machine fields on', () => {
    const model = build(FIXTURE);
    if (model.metrics.kind !== 'ok') throw new Error('expected ok');
    expect(model.metrics.executions[1]?.usage.costUsd).toBeNull();
    expect(model.metrics.executions[0]?.verify).toBeNull();
    const json = JSON.stringify(model);
    for (const secret of ['argv', 'agent', 'cli_version', 'git_head', 'git_dirty', 'secret']) {
      expect(json).not.toContain(secret);
    }
  });

  it('shows a missing file as missing, with the session header intact', () => {
    const model = build(session());
    expect(model.availability).toBe('ok');
    expect(model.metrics).toEqual({ kind: 'missing' });
    expect(model.state).toBe('Completed');
  });

  it('shows an invalid file with its reason', () => {
    const model = build(session('{ not json'));
    expect(model.availability).toBe('ok');
    expect(model.metrics.kind).toBe('invalid');
    expect(model.metrics.kind === 'invalid' && model.metrics.error).not.toBe('');
  });

  it('shows an unreadable file with its error code', () => {
    const dir = session();
    mkdirSync(path.join(dir, 'metrics.json'));
    expect(build(dir).metrics.kind).toBe('unreadable');
  });

  it('is unavailable for an unknown session and does not read the disk for it', () => {
    const model = buildSessionMetricsModel({ sessionId: 'gone', sessionDirPath: FIXTURE, snapshots: [snapshot] });
    expect(model).toEqual({
      availability: 'unavailable',
      sessionId: 'gone',
      title: 'gone',
      state: 'Unavailable',
      workflowId: null,
      completedAt: null,
      meta: { stageId: null, createdAt: null, updatedAt: null, isRunning: false, pendingQuestions: 0 },
      metrics: { kind: 'missing' },
    });
  });

  it('leaves completion time and duration empty for a session that is not Completed', () => {
    const failed = { ...snapshot, displayState: { ...snapshot.displayState, state: 'failed' as const } };
    const model = buildSessionMetricsModel({
      sessionId: failed.sessionId,
      sessionDirPath: FIXTURE,
      snapshots: [failed],
    });
    expect(model.state).toBe('Failed');
    expect(model.completedAt).toBeNull();
  });
});

describe('sessionMetricsPanelTitle', () => {
  it('is the session title, whatever the state', () => {
    const base = build(FIXTURE);
    expect(sessionMetricsPanelTitle(base)).toBe(base.title);
    expect(sessionMetricsPanelTitle({ ...base, state: 'Running' })).toBe(base.title);
  });

  it('shortens a long title', () => {
    const base = build(FIXTURE);
    expect(sessionMetricsPanelTitle({ ...base, title: 'x'.repeat(60) })).toBe(`${'x'.repeat(31)}…`);
  });

  it('is plain "Metrics" for an unavailable session', () => {
    expect(sessionMetricsPanelTitle({ ...build(FIXTURE), availability: 'unavailable' })).toBe('Metrics');
  });
});
