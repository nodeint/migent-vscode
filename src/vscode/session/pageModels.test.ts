import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TailEvent } from '../../core/eventTail';
import type { SessionSnapshot } from '../../core/model';
import type { OverviewModel } from '../../core/overviewModel';
import { eventsPath } from '../../core/paths';
import { OVERVIEW_ACTIVITY_LIMIT } from '../../core/sessionActivity';
import { capturedDir, snapshotFromDir } from '../../core/testHelpers';
import type { ProjectRegistry } from '../projects';
import { buildOverviewPage } from './pageModels';

const { readRecentEvents } = vi.hoisted(() => ({ readRecentEvents: vi.fn() }));

vi.mock('../../core/eventTail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/eventTail')>();
  return { ...actual, readRecentEvents };
});

const SESSION = '00000000-0000-4000-8000-0000000000b1';
const PROJECT = 'project';
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'migent-overview-page-'));
  const target = path.join(root, '.migent', 'sessions', SESSION);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(capturedDir('handoff-source'), target, { recursive: true });
  readRecentEvents.mockReset();
  readRecentEvents.mockReturnValue([]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function snapshot(state: 'running' | 'completed'): SessionSnapshot {
  const base = snapshotFromDir(path.join(root, '.migent', 'sessions', SESSION));
  const {status} = base;
  return {
    ...base,
    sessionId: SESSION,
    displayState: { ...base.displayState, state, icon: 'x', writable: true },
    ...(status === null
      ? {}
      : {
          status: state === 'running'
            ? {
                ...status,
                runningStages: [
                  { executionId: null, stageId: 'draft', client: null, event: null, summary: null, updatedAt: null },
                ],
              }
            : status,
        }),
  };
}

function registryOf(snapshots: readonly SessionSnapshot[]): ProjectRegistry {
  const context = {
    root,
    store: {
      all: () => snapshots,
      snapshot: (sessionId: string) => snapshots.find((candidate) => candidate.sessionId === sessionId),
      scanOutcome: { eligible: snapshots.map((candidate) => candidate.sessionId) },
    },
    catalog: { workflows: () => ({ entries: [] }) },
  };
  return { project: () => context } as unknown as ProjectRegistry;
}

function overviewOf(snapshots: readonly SessionSnapshot[]): OverviewModel {
  const entry = { project: PROJECT, sessionId: SESSION };
  const page = buildOverviewPage(entry, registryOf(snapshots));
  if (page.tab !== 'overview') throw new Error('expected the overview tab');
  return page.overview as OverviewModel;
}

function event(seq: number): TailEvent {
  return {
    seq,
    v: 2,
    event: 'execution.started',
    timestamp: '2026-11-01T11:00:00.000Z',
    executionId: null,
    stageId: 'draft',
    summary: `line-${seq}`,
    data: {},
    raw: {},
    rawLine: null,
  };
}

describe('buildOverviewPage', () => {
  it('reads recent events only for a Running session and reads the stage plan', () => {
    readRecentEvents.mockReturnValue([1, 2, 3, 4, 5].map(event));

    const model = overviewOf([snapshot('running')]);

    expect(readRecentEvents).toHaveBeenCalledWith(eventsPath(root, SESSION), OVERVIEW_ACTIVITY_LIMIT);
    expect(model.activity.visible).toBe(true);
    expect(model.progress).toMatchObject({
      kind: 'stages',
      rows: [{ id: 'draft', state: 'not-run', isCurrent: true }],
    });
  });

  it('does not read events for a completed session and hides activity', () => {
    const model = overviewOf([snapshot('completed')]);

    expect(readRecentEvents).not.toHaveBeenCalled();
    expect(model.activity).toEqual({ visible: false });
    expect(model.progress).toMatchObject({ kind: 'stages', rows: [{ id: 'draft' }] });
  });
});
