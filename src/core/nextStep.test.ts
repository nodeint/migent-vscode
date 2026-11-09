import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import { type NextStepInput, previewNextStep, resolveLaunch, storedTask } from './nextStep';
import { capturedDir, snapshotFromDir } from './testHelpers';
import type { WorkflowEntry } from './workflows';

const SOURCE = '00000000-0000-4000-8000-0000000000b1';
const TARGET = '00000000-0000-4000-8000-0000000000b2';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copiedSource(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-nextstep-'));
  temps.push(dir);
  cpSync(capturedDir('handoff-source'), dir, { recursive: true });
  return dir;
}

function snapshots(): SessionSnapshot[] {
  return [
    { ...snapshotFromDir(capturedDir('handoff-source')), sessionId: SOURCE },
    { ...snapshotFromDir(capturedDir('handoff-target')), sessionId: TARGET },
  ];
}

function workflow(id: string, extra: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return { id, file: `${id}.yaml`, state: 'ok', error: null, title: null, stages: [], duplicate: false, ...extra };
}

function input(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    sourceId: SOURCE,
    sessionDirPath: capturedDir('handoff-source'),
    snapshots: snapshots(),
    workflows: [workflow('probe-target')],
    targetWorkflow: 'probe-target',
    ...overrides,
  };
}

describe('previewNextStep', () => {
  it('offers the canonical task and the target file', () => {
    expect(previewNextStep(input())).toMatchObject({
      target: { workflow: 'probe-target', state: 'available', file: 'probe-target.yaml' },
      suggestedTask: 'Acknowledge the note.',
      launchBlock: null,
    });
  });

  it('lists only Prepared or Running children of the target as active', () => {
    expect(previewNextStep(input()).activeChildren).toEqual([]);
    const prepared = snapshots().map((snapshot) =>
      snapshot.sessionId === TARGET ? { ...snapshot, displayState: { ...snapshot.displayState, state: 'prepared' as const } } : snapshot,
    );
    expect(previewNextStep(input({ snapshots: prepared })).activeChildren).toMatchObject([
      { sessionId: TARGET, state: 'prepared' },
    ]);
  });

  it('disables launching for each missing precondition', () => {
    const block = (overrides: Partial<NextStepInput>): string | null => previewNextStep(input(overrides)).launchBlock;
    expect(block({ workflows: [] })).toMatch(/No workflow/);
    expect(block({ workflows: [workflow('probe-target'), workflow('probe-target', { file: 'b.yaml' })] })).toMatch(
      /More than one/,
    );
    expect(block({ workflows: [workflow('probe-target', { state: 'invalid', error: 'bad yaml' })] })).toBe('bad yaml');
    expect(block({ targetWorkflow: 'other' })).toMatch(/not a suggestion/);
    expect(block({ snapshots: snapshots().slice(1), sourceId: SOURCE })).toMatch(/not loaded/);
    const running = snapshots().map((snapshot) =>
      snapshot.sessionId === SOURCE ? { ...snapshot, displayState: { ...snapshot.displayState, state: 'running' as const } } : snapshot,
    );
    expect(block({ snapshots: running })).toMatch(/not completed/);
  });

  it('blocks a tampered next.json whose suggestion the frozen workflow does not declare', () => {
    const dir = copiedSource();
    const next = path.join(dir, 'next.json');
    writeFileSync(
      next,
      JSON.stringify({
        schema_version: 1,
        next: [{ workflow: 'probe-target', task: 'Evil', artifacts: { x: { output: 'secret', path: 'outputs/s.md' } } }],
      }),
    );
    expect(previewNextStep(input({ sessionDirPath: dir })).launchBlock).toMatch(/not declared/);
    writeFileSync(next, '{ nope');
    expect(previewNextStep(input({ sessionDirPath: dir })).launchBlock).toMatch(/unreadable, invalid/);
  });
});

describe('resolveLaunch', () => {
  const base = input();

  it('leaves --task out when the task is the canonical default and sends an override otherwise', () => {
    expect(resolveLaunch(base, '  Acknowledge the note. ')).toMatchObject({
      kind: 'ok',
      launch: { workflowId: 'probe-target', priorSessionId: SOURCE, task: null, workflowFile: 'probe-target.yaml' },
    });
    expect(resolveLaunch(base, 'Do "this" — now')).toMatchObject({
      kind: 'ok',
      launch: { task: 'Do "this" — now' },
    });
  });

  it('refuses a whitespace-only task and a target that is no longer valid', () => {
    expect(resolveLaunch(base, '   ')).toEqual({ kind: 'blocked', reason: 'Enter a task.' });
    expect(resolveLaunch({ ...base, workflows: [] }, 'x').kind).toBe('blocked');
  });

  it('accepts a blank task for Prepare only', () => {
    expect(resolveLaunch(base, '   ', { allowEmpty: true })).toMatchObject({ kind: 'ok', launch: { taskText: '' } });
    expect(resolveLaunch({ ...base, workflows: [] }, '', { allowEmpty: true }).kind).toBe('blocked');
  });
});

describe('storedTask', () => {
  it('reads the current string and the former page object { task, fingerprint }', () => {
    expect(storedTask('Edited')).toBe('Edited');
    expect(storedTask({ task: 'Legacy task', fingerprint: 'x' })).toBe('Legacy task');
  });

  it('ignores blank, missing or malformed values', () => {
    for (const value of [undefined, null, '', '  ', {}, { task: 3 }, 7, ['a']]) expect(storedTask(value)).toBeUndefined();
  });
});
