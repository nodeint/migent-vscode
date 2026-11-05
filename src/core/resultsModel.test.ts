import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import {
  buildResultsModel,
  resolveHandoffPath,
  resolveOutputPath,
  type ResultsInput,
  resultsPanelTitle,
} from './resultsModel';
import { capturedDir, snapshotFromDir } from './testHelpers';
import type { WorkflowEntry } from './workflows';

const SOURCE = '00000000-0000-4000-8000-0000000000b1';
const TARGET = '00000000-0000-4000-8000-0000000000b2';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-results-'));
  temps.push(dir);
  return dir;
}

/** The captured directories are named for the fixture; the sessions carry the captured ids. */
function captured(name: 'handoff-source' | 'handoff-target'): SessionSnapshot {
  return { ...snapshotFromDir(capturedDir(name)), sessionId: name === 'handoff-source' ? SOURCE : TARGET };
}

function workflow(id: string, extra: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return { id, file: `${id}.yaml`, state: 'ok', error: null, title: null, stages: [], duplicate: false, ...extra };
}

function sourceInput(workflows: WorkflowEntry[] = []): ResultsInput {
  const source = captured('handoff-source');
  const target = captured('handoff-target');
  return {
    sessionId: source.sessionId,
    sessionDirPath: capturedDir('handoff-source'),
    snapshots: [source, target],
    eligibleIds: [source.sessionId, target.sessionId],
    workflows,
  };
}

function targetInput(): ResultsInput {
  const source = captured('handoff-source');
  const target = captured('handoff-target');
  return {
    sessionId: TARGET,
    sessionDirPath: capturedDir('handoff-target'),
    snapshots: [source, target],
    eligibleIds: [SOURCE, TARGET],
    workflows: [],
  };
}

describe('buildResultsModel', () => {
  it('shows outputs, a declared suggestion and the observed child of the captured source session', () => {
    const model = buildResultsModel(sourceInput([workflow('probe-target')]));
    expect(model).toMatchObject({
      availability: 'ok',
      sessionId: SOURCE,
      title: 'Probe: handoff fixture source',
      state: 'Completed',
      workflowId: 'probe-source',
      source: null,
    });
    // The captured sample does not include outputs/note.md.
    expect(model.outputs.rows).toEqual([{ key: 'name:note', label: 'note', path: 'outputs/note.md', state: 'missing' }]);
    expect(model.next).toMatchObject({ state: 'ok', frozen: 'ok' });
    expect(model.next.suggestions).toEqual([
      {
        workflow: 'probe-target',
        task: 'Acknowledge the note.',
        declared: true,
        target: 'available',
        artifacts: [{ name: 'context_note', output: 'note', path: 'outputs/note.md', availability: 'missing' }],
      },
    ]);
    expect(model.children).toEqual([
      { sessionId: TARGET, title: 'Acknowledge the note.', state: 'Completed', task: null },
    ]);
    expect(JSON.stringify(model)).not.toContain('argv');
  });

  it('offers Reload only when next.json is unavailable although the frozen workflow declares downstream', () => {
    const dir = tempDir();
    cpSync(capturedDir('handoff-source'), dir, { recursive: true });
    rmSync(path.join(dir, 'next.json'));
    const snapshot = captured('handoff-source');
    const build = (): boolean =>
      buildResultsModel({
        sessionId: SOURCE,
        sessionDirPath: dir,
        snapshots: [snapshot],
        eligibleIds: [],
        workflows: [],
      }).next.canReload;
    expect(build()).toBe(true);
    cpSync(path.join(capturedDir('handoff-source'), 'next.json'), path.join(dir, 'next.json'));
    expect(build()).toBe(false);
  });

  it('reports the target workflow as not found, duplicate or invalid', () => {
    const states = (workflows: WorkflowEntry[]): string[] =>
      buildResultsModel(sourceInput(workflows)).next.suggestions.map((suggestion) => suggestion.target);
    expect(states([])).toEqual(['not-found']);
    expect(states([workflow('probe-target'), workflow('probe-target', { file: 'other.yaml' })])).toEqual(['duplicate']);
    expect(states([workflow('probe-target', { state: 'invalid' })])).toEqual(['invalid']);
  });

  it('shows the source link and handoff provenance of the captured target session', () => {
    const input = targetInput();
    const model = buildResultsModel(input);
    expect(model.source).toMatchObject({ sessionId: SOURCE, availability: 'retained' });
    expect(model.source?.provenance).toMatchObject({
      state: 'ok',
      artifacts: [
        {
          name: 'context_note',
          output: 'note',
          path: 'handoff/1/note.md',
          // The captured sample does not include handoff/1/note.md.
          localState: 'missing',
          sha256: '02edbc066ee4147972f6aa6d611524c74135a06528ec94a2450cc84dd3bf084b',
        },
      ],
    });
    expect(model.next.state).toBe('missing');

    const target = input.snapshots.filter((snapshot) => snapshot.sessionId === TARGET);
    expect(buildResultsModel({ ...input, snapshots: target }).source).toMatchObject({
      sessionId: SOURCE,
      availability: 'hidden',
      title: null,
    });
    expect(buildResultsModel({ ...input, snapshots: target, eligibleIds: [TARGET] }).source?.availability).toBe(
      'missing',
    );
  });

  it('keeps the session Completed with outputs when next.json is invalid or unsupported', () => {
    const dir = tempDir();
    const snapshot = captured('handoff-source');
    const build = (): ReturnType<typeof buildResultsModel> =>
      buildResultsModel({
        sessionId: snapshot.sessionId,
        sessionDirPath: dir,
        snapshots: [snapshot],
        eligibleIds: [],
        workflows: [],
      });
    expect(build().next).toMatchObject({ state: 'missing', frozen: 'absent', canReload: false });
    writeFileSync(path.join(dir, 'next.json'), '{ nope');
    expect(build().next.state).toBe('invalid');
    writeFileSync(path.join(dir, 'next.json'), '{"schema_version": 9}');
    expect(build().next).toMatchObject({ state: 'unsupported', detail: 'schema_version 9' });
    expect(build().state).toBe('Completed');
    expect(build().outputs.rows).toHaveLength(1);
  });

  it('is unavailable for a session that is not retained', () => {
    const model = buildResultsModel({ ...sourceInput(), snapshots: [], sessionId: 'gone' });
    expect(model).toMatchObject({ availability: 'unavailable', sessionId: 'gone', state: 'Unavailable' });
  });

  it('flags a handoff that does not match the observed shape but keeps the source link', () => {
    const target = captured('handoff-target');
    const manifest = target.manifest === null ? null : { ...target.manifest, raw: { handoff: 'x' } };
    const model = buildResultsModel({
      sessionId: TARGET,
      sessionDirPath: tempDir(),
      snapshots: [{ ...target, manifest }],
      eligibleIds: [],
      workflows: [],
    });
    expect(model.source).toMatchObject({ sessionId: SOURCE, provenance: { state: 'invalid' } });
  });
});

const NL = String.fromCharCode(10);
const BLANK_TASK = ['   ', '', ''].join(NL);
const LONG_TASK = ['', '# Heading', '', 'Do the thing.', '  second line  ', '', ''].join(NL);

describe('session meta and child task', () => {
  const withStatus = (patch: { createdAt?: string | null; updatedAt?: string | null }): ResultsInput => {
    const input = sourceInput();
    const source = captured('handoff-source');
    const status = source.status && { ...source.status, ...patch };
    return { ...input, snapshots: [{ ...source, status }, captured('handoff-target')] };
  };

  it('carries the session meta the header shows, for any state', () => {
    expect(buildResultsModel(withStatus({})).meta).toMatchObject({
      createdAt: '2026-11-01T11:17:47.350+00:00',
      updatedAt: '2026-11-01T11:17:52.960+00:00',
      isRunning: false,
      pendingQuestions: 0,
    });
    expect(buildResultsModel({ ...sourceInput(), snapshots: [], sessionId: 'gone' }).meta.updatedAt).toBeNull();
    const running = captured('handoff-source');
    const live = { ...running, displayState: { ...running.displayState, state: 'running' as const } };
    expect(buildResultsModel({ ...sourceInput(), snapshots: [live] }).meta.isRunning).toBe(true);
  });

  it('returns the whole child task.md trimmed, and null when it is missing or blank', () => {
    const root = tempDir();
    const sourceDir = path.join(root, SOURCE);
    cpSync(capturedDir('handoff-source'), sourceDir, { recursive: true });
    const input: ResultsInput = { ...sourceInput(), sessionDirPath: sourceDir };
    const childTask = (): string | null | undefined => buildResultsModel(input).children[0]?.task;
    expect(childTask()).toBeNull();
    const targetDir = path.join(root, TARGET);
    mkdirSync(targetDir);
    writeFileSync(path.join(targetDir, 'task.md'), BLANK_TASK);
    expect(childTask()).toBeNull();
    writeFileSync(path.join(targetDir, 'task.md'), LONG_TASK);
    expect(childTask()).toBe(LONG_TASK.trim());
  });
});

describe('resultsPanelTitle', () => {
  it('is the session title, whatever the state', () => {
    const model = buildResultsModel(sourceInput());
    expect(resultsPanelTitle(model)).toBe(model.title);
    expect(resultsPanelTitle({ ...model, state: 'Running' })).toBe(model.title);
  });

  it('shortens a long title', () => {
    const model = buildResultsModel(sourceInput());
    const title = resultsPanelTitle({ ...model, title: 'x'.repeat(80) });
    expect(title.startsWith('x')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThan(80);
  });

  it('is neutral for an unavailable session', () => {
    expect(resultsPanelTitle(buildResultsModel({ ...sourceInput(), snapshots: [], sessionId: 'gone' }))).toBe('Results');
  });
});

describe('intent resolution', () => {
  it('resolves an output key to an existing file only', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'outputs'));
    writeFileSync(path.join(dir, 'outputs', 'loose.md'), 'x');
    const snapshot = captured('handoff-source');
    const input = {
      sessionId: snapshot.sessionId,
      sessionDirPath: dir,
      snapshots: [snapshot],
      eligibleIds: [],
      workflows: [],
    };
    expect(resolveOutputPath(input, 'path:outputs/loose.md')).toBe(path.join(dir, 'outputs', 'loose.md'));
    expect(resolveOutputPath(input, 'name:note')).toBeNull();
    expect(resolveOutputPath(input, 'path:../../etc/passwd')).toBeNull();
    writeFileSync(path.join(dir, 'outputs', 'note.md'), 'n');
    expect(resolveOutputPath(input, 'name:note')).toBe(path.join(dir, 'outputs', 'note.md'));
  });

  it('keeps a published name and an unnamed path with the same text apart', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'outputs'));
    writeFileSync(path.join(dir, 'outputs', 'published.md'), 'p');
    writeFileSync(path.join(dir, 'outputs', 'loose.md'), 'l');
    const base = snapshotFromDir(capturedDir('handoff-source'));
    const status = base.status && {
      ...base.status,
      outputs: [
        { name: 'outputs/loose.md', path: 'outputs/published.md', sourceExecutionId: null, publishedByExecutionId: null },
      ],
    };
    const snapshot = { ...base, status };
    const input = {
      sessionId: snapshot.sessionId,
      sessionDirPath: dir,
      snapshots: [snapshot],
      eligibleIds: [],
      workflows: [],
    };
    const keys = buildResultsModel(input).outputs.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
    expect(resolveOutputPath(input, 'name:outputs/loose.md')).toBe(path.join(dir, 'outputs', 'published.md'));
    expect(resolveOutputPath(input, 'path:outputs/loose.md')).toBe(path.join(dir, 'outputs', 'loose.md'));
  });

  it('resolves a handoff artifact name to its confined local copy', () => {
    const dir = tempDir();
    const target = captured('handoff-target');
    const input = { sessionId: TARGET, sessionDirPath: dir, snapshots: [target], eligibleIds: [], workflows: [] };
    expect(resolveHandoffPath(input, 'context_note')).toBeNull();
    mkdirSync(path.join(dir, 'handoff', '1'), { recursive: true });
    writeFileSync(path.join(dir, 'handoff', '1', 'note.md'), 'n');
    expect(resolveHandoffPath(input, 'context_note')).toBe(path.join(dir, 'handoff', '1', 'note.md'));
    expect(resolveHandoffPath(input, 'other')).toBeNull();
  });
});
