import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import { buildNextStepModel, fingerprintOf, type NextStepInput,resolveLaunch } from './nextStep';
import { parseNextStepMessage } from './nextStepIntent';
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
    override: null,
    ...overrides,
  };
}

describe('buildNextStepModel', () => {
  it('prefills the canonical task, lists the context mapping and the observed child', () => {
    const model = buildNextStepModel(input());
    expect(model).toMatchObject({
      availability: 'ok',
      sourceState: 'Completed',
      target: { workflow: 'probe-target', state: 'available', file: 'probe-target.yaml' },
      suggestedTask: 'Acknowledge the note.',
      task: 'Acknowledge the note.',
      isOverridden: false,
      launchBlock: null,
    });
    expect(model.artifacts).toMatchObject([{ name: 'context_note', output: 'note', path: 'outputs/note.md' }]);
    expect(model.children).toMatchObject([{ sessionId: TARGET, isActive: false }]);
    expect(JSON.stringify(model)).not.toContain('argv');
  });

  it('keeps a local override and flags a changed suggestion instead of resetting it', () => {
    const kept = buildNextStepModel(input({ override: { task: 'My task', fingerprint: 'old' } }));
    expect(kept).toMatchObject({ task: 'My task', isOverridden: true, suggestionChanged: true });
    const dir = copiedSource();
    const same = buildNextStepModel(
      input({ sessionDirPath: dir, override: { task: 'My task', fingerprint: fingerprintOfSource(dir) } }),
    );
    expect(same.suggestionChanged).toBe(false);
  });

  it('disables launching for each missing precondition', () => {
    const block = (overrides: Partial<NextStepInput>): string | null =>
      buildNextStepModel(input(overrides)).launchBlock;
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
    expect(buildNextStepModel(input({ sessionDirPath: dir })).launchBlock).toMatch(/not declared/);
    writeFileSync(next, '{ nope');
    expect(buildNextStepModel(input({ sessionDirPath: dir })).launchBlock).toMatch(/unreadable, invalid/);
  });
});

function fingerprintOfSource(dir: string): string {
  const model = buildNextStepModel(input({ sessionDirPath: dir }));
  return fingerprintOf({
    workflow: 'probe-target',
    task: model.suggestedTask,
    artifacts: model.artifacts,
    argv: [],
    declared: true,
  });
}

describe('resolveLaunch', () => {
  const base = { ...input(), override: undefined };

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
});

describe('parseNextStepMessage', () => {
  it('accepts supported intents and drops anything carrying a path, command or unknown intent', () => {
    expect(parseNextStepMessage({ type: 'intent', intent: 'run', task: 'a' })).toEqual({
      type: 'intent',
      value: { intent: 'run', task: 'a' },
    });
    expect(parseNextStepMessage({ type: 'intent', intent: 'run' })).toBeNull();
    expect(parseNextStepMessage({ type: 'intent', intent: 'exec', command: 'rm' })).toBeNull();
    expect(parseNextStepMessage({ type: 'intent', intent: 'openSession', sessionId: '' })).toBeNull();
    expect(parseNextStepMessage('x')).toBeNull();
  });
});
