import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  anchorWatch,
  classifyPath,
  desiredWatches,
  diffWatches,
  routeSessionChanges,
  type WatchPlanInput,
  watchTargetKey,
} from './watchPlan';

const root = path.resolve('/work/proj');
const migent = path.join(root, '.migent');
const sessions = path.join(migent, 'sessions');

function input(overrides: Partial<WatchPlanInput> = {}): WatchPlanInput {
  return {
    projectRoot: root,
    migentExists: true,
    sessionsState: 'ok',
    workflowsState: 'ok',
    discoveredSessions: ['s1', 'pending-one'],
    retained: [],
    turns: {},
    dirExists: () => true,
    ...overrides,
  };
}

function folders(plan: WatchPlanInput): string[] {
  return desiredWatches(plan).map((watch) => path.relative(root, watch.folder).split(path.sep).join('/'));
}

describe('anchorWatch', () => {
  it('watches the workspace root for .migent', () => {
    expect(anchorWatch(root)).toEqual({ id: root, folder: root, pattern: '.migent' });
  });
});

describe('desiredWatches', () => {
  it('watches .migent, workflows, sessions and every discovered session directory, pending included', () => {
    const watches = desiredWatches(input());
    expect(folders(input())).toEqual([
      '.migent',
      '.migent/sessions',
      '.migent/sessions/pending-one',
      '.migent/sessions/s1',
      '.migent/workflows',
    ]);
    expect(watches.find((watch) => watch.folder === migent)?.pattern).toBe('{config.yaml,sessions,workflows}');
    expect(watches.find((watch) => watch.folder === sessions)?.pattern).toBe('*');
    expect(watches.find((watch) => watch.folder === path.join(sessions, 's1'))?.pattern).toBe(
      '{manifest.yaml,status.json,session.lock,cancel.requested,questions.json,next.json,workflow.frozen.yaml,metrics.json,events.jsonl,executions,outputs}',
    );
    expect(watches.find((watch) => watch.folder === path.join(migent, 'workflows'))?.pattern).toBe('*.{yaml,yml}');
  });

  it('uses only patterns without path separators', () => {
    const plan = input({
      retained: [
        { kind: 'executions', sessionId: 's1' },
        { kind: 'execution', sessionId: 's1', executionId: 'e1' },
        { kind: 'outputs', sessionId: 's1' },
      ],
      turns: { 's1/e1': ['turn-1'] },
    });
    for (const watch of desiredWatches(plan)) expect(watch.pattern).not.toMatch(/[\\/]/);
  });

  it('is empty without .migent, and drops folders whose scan is missing', () => {
    expect(desiredWatches(input({ migentExists: false }))).toEqual([]);
    expect(folders(input({ sessionsState: 'missing', workflowsState: 'missing' }))).toEqual(['.migent']);
    expect(folders(input({ sessionsState: 'empty', discoveredSessions: [] }))).toEqual([
      '.migent',
      '.migent/sessions',
      '.migent/workflows',
    ]);
  });

  it('adds detail watchers only for retained targets, and only while the folder exists', () => {
    const plan = input({ retained: [{ kind: 'executions', sessionId: 's1' }, { kind: 'outputs', sessionId: 's1' }] });
    expect(folders(plan)).toEqual(expect.arrayContaining(['.migent/sessions/s1/executions', '.migent/sessions/s1/outputs']));
    expect(folders(input({ ...plan, dirExists: (p) => !p.endsWith('outputs') }))).not.toContain('.migent/sessions/s1/outputs');
    expect(folders(input())).not.toContain('.migent/sessions/s1/executions');
  });

  it('watches a retained execution with artifacts, turns and each existing turn directory', () => {
    const plan = input({
      retained: [{ kind: 'execution', sessionId: 's1', executionId: 'e1' }],
      turns: { 's1/e1': ['turn-1', 'turn-2'] },
    });
    const exec = '.migent/sessions/s1/executions/e1';
    expect(folders(plan)).toEqual(
      expect.arrayContaining([exec, `${exec}/artifacts`, `${exec}/turns`, `${exec}/turns/turn-1`, `${exec}/turns/turn-2`]),
    );
    // conversation.json holds the reply turn that confirms a reply, so a change to it must reach the consumer.
    const execution = desiredWatches(plan).find((watch) => watch.folder.endsWith(path.join('executions', 'e1')));
    expect(execution?.pattern).toContain('conversation.json');
    expect(execution?.pattern).toContain('failure.md');
    expect(execution?.pattern).toContain('diagnostics.json');
    const turn = desiredWatches(plan).find((watch) => watch.folder.endsWith(path.join('turns', 'turn-1')));
    expect(turn?.pattern).toBe('verify.md');
    const noArtifacts = input({ ...plan, dirExists: (p) => !p.endsWith('artifacts') });
    expect(folders(noArtifacts)).not.toContain(`${exec}/artifacts`);
  });

  it('ignores retained targets of sessions that are no longer discovered', () => {
    const plan = input({ retained: [{ kind: 'outputs', sessionId: 'gone' }] });
    expect(folders(plan).some((folder) => folder.includes('gone'))).toBe(false);
  });

  it('has one watcher per folder even when targets overlap, and a stable order', () => {
    const target = { kind: 'executions', sessionId: 's1' } as const;
    const once = desiredWatches(input({ retained: [target] }));
    const twice = desiredWatches(input({ retained: [target, target] }));
    expect(twice).toEqual(once);
    expect(new Set(once.map((watch) => watch.id)).size).toBe(once.length);
  });
});

describe('diffWatches', () => {
  it('adds missing watchers, removes surplus ones and replaces a changed pattern', () => {
    const desired = desiredWatches(input({ discoveredSessions: ['s1'] }));
    const live = new Map(desired.map((watch) => [watch.id, watch.pattern]));
    expect(diffWatches(desired, live)).toEqual({ add: [], remove: [] });

    live.delete(path.join(sessions, 's1'));
    live.set(path.join(sessions, 'deleted'), '*');
    live.set(sessions, 'something-else');
    const diff = diffWatches(desired, live);
    expect(diff.add.map((watch) => watch.id).sort()).toEqual([sessions, path.join(sessions, 's1')].sort());
    expect(diff.remove.sort()).toEqual([sessions, path.join(sessions, 'deleted')].sort());
  });
});

describe('watchTargetKey', () => {
  it('is distinct per target', () => {
    const keys = [
      watchTargetKey({ kind: 'executions', sessionId: 's1' }),
      watchTargetKey({ kind: 'outputs', sessionId: 's1' }),
      watchTargetKey({ kind: 'execution', sessionId: 's1', executionId: 'e1' }),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe('classifyPath', () => {
  const at = (...parts: string[]) => classifyPath(root, path.join(migent, ...parts));

  it('classifies project-level paths', () => {
    expect(classifyPath(root, migent)).toEqual({ kind: 'migent-dir' });
    expect(at('config.yaml')).toEqual({ kind: 'config' });
    expect(at('sessions')).toEqual({ kind: 'sessions-dir' });
    expect(at('workflows')).toEqual({ kind: 'workflows-dir' });
    expect(at('workflows', 'plan.yaml')).toEqual({ kind: 'workflow', file: 'plan.yaml' });
    expect(at('workflows', 'plan.yml')).toEqual({ kind: 'workflow', file: 'plan.yml' });
    expect(at('workflows', 'notes.txt')).toBeNull();
  });

  it('classifies session paths', () => {
    expect(at('sessions', 's1')).toEqual({ kind: 'session-dir', sessionId: 's1' });
    for (const file of ['manifest.yaml', 'status.json', 'session.lock', 'cancel.requested']) {
      expect(at('sessions', 's1', file)).toEqual({ kind: 'session-snapshot', sessionId: 's1' });
    }
    expect(at('sessions', 's1', 'questions.json')).toEqual({ kind: 'session-files', sessionId: 's1', target: { kind: 'questions' } });
    expect(at('sessions', 's1', 'next.json')).toMatchObject({ target: { kind: 'next' } });
    expect(at('sessions', 's1', 'workflow.frozen.yaml')).toMatchObject({ target: { kind: 'next' } });
    expect(at('sessions', 's1', 'events.jsonl')).toMatchObject({ target: { kind: 'events' } });
    expect(at('sessions', 's1', 'metrics.json')).toEqual({ kind: 'session-files', sessionId: 's1', target: { kind: 'metrics' } });
    expect(at('sessions', 's1', 'metrics.json', 'deeper')).toBeNull();
    expect(at('sessions', 's1', 'outputs')).toMatchObject({ target: { kind: 'outputs' } });
    expect(at('sessions', 's1', 'outputs', 'note.md')).toMatchObject({ target: { kind: 'outputs' } });
  });

  it('classifies execution paths: the directory itself is a list change, anything inside is that execution', () => {
    expect(at('sessions', 's1', 'executions')).toMatchObject({ target: { kind: 'executions' } });
    expect(at('sessions', 's1', 'executions', 'e1')).toMatchObject({ target: { kind: 'executions' } });
    expect(at('sessions', 's1', 'executions', 'e1', 'response.md')).toMatchObject({
      sessionId: 's1',
      target: { kind: 'execution', executionId: 'e1' },
    });
    expect(at('sessions', 's1', 'executions', 'e1', 'turns', 'turn-1', 'verify.md')).toMatchObject({
      target: { kind: 'execution', executionId: 'e1' },
    });
  });

  it('ignores unknown paths and paths outside the project or .migent', () => {
    expect(at('sessions', 's1', 'task.md')).toBeNull();
    expect(at('sessions', 's1', 'handoff', '1', 'a.md')).toBeNull();
    expect(at('sessions', 's1', 'status.json', 'deeper')).toBeNull();
    expect(at('other')).toBeNull();
    expect(classifyPath(root, path.join(root, 'src', 'index.ts'))).toBeNull();
    expect(classifyPath(root, path.resolve('/elsewhere/.migent/config.yaml'))).toBeNull();
    expect(classifyPath(root, root)).toBeNull();
  });
});

describe('routeSessionChanges', () => {
  it('requests a snapshot refresh and de-duplicates file targets in first-seen order', () => {
    const changes = [
      classifyPath(root, path.join(sessions, 's1', 'questions.json')),
      classifyPath(root, path.join(sessions, 's1', 'status.json')),
      classifyPath(root, path.join(sessions, 's1', 'questions.json')),
      classifyPath(root, path.join(sessions, 's1', 'executions', 'e1', 'response.md')),
      classifyPath(root, path.join(sessions, 's1', 'executions', 'e1', 'prompt.md')),
      classifyPath(root, path.join(sessions, 's1', 'executions', 'e2', 'prompt.md')),
    ].filter((change) => change !== null);
    expect(routeSessionChanges(changes)).toEqual({
      shouldRefreshSnapshot: true,
      targets: [
        { kind: 'questions' },
        { kind: 'execution', executionId: 'e1' },
        { kind: 'execution', executionId: 'e2' },
      ],
    });
  });

  it('does not refresh the snapshot for detail-only changes', () => {
    const change = classifyPath(root, path.join(sessions, 's1', 'events.jsonl'));
    expect(routeSessionChanges(change === null ? [] : [change])).toEqual({
      shouldRefreshSnapshot: false,
      targets: [{ kind: 'events' }],
    });
  });
});
