/**
 * S10 Results overview scenarios (plans/02-monitoring.md §6.8, AC10, AC21 subset, §6.6 no focus stealing).
 * The page itself is not inspected: the host's last posted model and its intent handler are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { TreeNode } from '../vscode/views/nodes';
import {
  createProject,
  type Env,
  freshLock,
  manifest,
  migentPath,
  repoRoot,
  runScenarios,
  type Scenario,
  SETTLE_MS,
  sleep,
  status,
  waitFor,
  write,
} from './harness';

const CLOSE_SETTLE_MS = 1500;
const SOURCE = '00000000-0000-4000-8000-0000000000b1';
const TARGET = '00000000-0000-4000-8000-0000000000b2';

const identity = (env: Env, sessionId: string): { project: string; sessionId: string } => {
  const project = env.project();
  assert.ok(project, 'project exists');
  return { project: project.key, sessionId };
};

/** The file in the active tab: the focused part (for example the Output panel) does not change it. */
const activeFile = (): string => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText ? input.uri.fsPath.toLowerCase() : '';
};
const same = (left: string, right: string): boolean => left.toLowerCase() === path.normalize(right).toLowerCase();
const describeEditors = (): string =>
  `active=${activeFile()} tabs=${vscode.window.tabGroups.all
    .flatMap((group) => group.tabs.map((tab) => `${tab.label}${tab.isActive ? '*' : ''}`))
    .join(',')}`;

function copyCaptured(root: string, fixture: string, id: string): void {
  const source = path.join(repoRoot(), 'src', 'core', 'fixtures', 'captured', fixture);
  fs.cpSync(source, migentPath(root, 'sessions', id), { recursive: true });
}

async function handoffProject(env: Env): Promise<void> {
  const { root } = env;
  fs.mkdirSync(migentPath(root, 'sessions'), { recursive: true });
  copyCaptured(root, 'handoff-source', SOURCE);
  copyCaptured(root, 'handoff-target', TARGET);
  write(migentPath(root, 'sessions', SOURCE, 'outputs', 'note.md'), 'a note\n');
  write(migentPath(root, 'sessions', TARGET, 'handoff', '1', 'note.md'), 'a note\n');
  write(migentPath(root, 'workflows', 'probe-target.yaml'), 'id: probe-target\nstages: []\n');
  const project = await createProject(env);
  await waitFor('sessions loaded', () => [SOURCE, TARGET].every((id) => project.store.snapshot(id) !== undefined));
  await waitFor('workflow loaded', () => project.catalog.workflows().entries.length === 1);
}

function sessionNode(env: Env, sessionId: string): TreeNode {
  for (const group of env.api.sessionsTree.getChildren()) {
    const found = env.api.sessionsTree
      .getChildren(group)
      .find((node) => node.kind === 'session' && node.sessionId === sessionId);
    if (found) return found;
  }
  throw new Error(`session ${sessionId} is not in the tree`);
}

async function closeAll(env: Env): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('panels closed', () => env.api.results.count === 0);
  // VS Code keeps watching the folder of a closed file for a moment, which blocks deleting it on Windows.
  await sleep(CLOSE_SETTLE_MS);
}

const scenarios: Scenario[] = [
  {
    name: 'AC10: a Completed row opens one reused Results panel; the header commands target its session',
    async run(env) {
      await handoffProject(env);
      const id = identity(env, SOURCE);
      const item = env.api.sessionsTree.getTreeItem(sessionNode(env, SOURCE));
      const { command } = item;
      assert.ok(command, 'a Completed row has a click command');
      assert.equal(command.command, 'migent.session.openResult');

      write(migentPath(env.root, 'sessions', 'running', 'manifest.yaml'), manifest('running'));
      write(migentPath(env.root, 'sessions', 'running', 'status.json'), status('active', { workflow_id: 'plan' }));
      write(migentPath(env.root, 'sessions', 'running', 'session.lock'), freshLock());
      await waitFor('running loaded', () => env.project()?.store.snapshot('running') !== undefined);
      assert.equal(env.api.sessionsTree.getTreeItem(sessionNode(env, 'running')).command, undefined);

      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      await waitFor('panel opened', () => env.api.results.has(id));
      await waitFor('model posted', () => env.api.results.lastModel(id) !== null);
      const model = env.api.results.lastModel(id);
      assert.ok(model);
      assert.equal(model.availability, 'ok');
      assert.equal(model.state, 'Completed');
      assert.deepEqual(
        model.outputs.rows.map((row) => [row.key, row.state]),
        [['name:note', 'ok']],
      );
      assert.equal(model.next.suggestions.length, 1);
      assert.equal(model.next.suggestions[0]?.target, 'available');
      assert.deepEqual(
        model.children.map((child) => child.sessionId),
        [TARGET],
      );

      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      assert.equal(env.api.results.count, 1, 'reopening reuses the panel');

      await waitFor('panel is active', () => env.api.results.activeTarget()?.sessionId === SOURCE);
      await vscode.commands.executeCommand('migent.session.openTask');
      await waitFor('task.md of the bound session opened', () =>
        same(activeFile(), path.join(env.root, '.migent', 'sessions', SOURCE, 'task.md')),
      );
      await closeAll(env);
    },
  },
  {
    name: 'AC10: page intents open real files by identity; unknown intents and paths are ignored',
    async run(env) {
      await handoffProject(env);
      const source = identity(env, SOURCE);
      const target = identity(env, TARGET);
      const baseline = env.project()?.watcher.watchCount ?? 0;
      env.api.results.open(source);
      await waitFor('model posted', () => env.api.results.lastModel(source) !== null);
      const expectOpens = async (label: string, file: string): Promise<void> => {
        try {
          await waitFor(label, () => same(activeFile(), file));
        } catch (error) {
          throw new Error(`${String(error)} (${describeEditors()})`, { cause: error });
        }
      };

      await env.api.results.handle(source, { type: 'intent', intent: 'openOutput', name: 'name:note' });
      await expectOpens('output opened', path.join(env.root, '.migent', 'sessions', SOURCE, 'outputs', 'note.md'));
      await env.api.results.handle(source, { type: 'intent', intent: 'openNextFile' });
      await expectOpens('next.json opened', path.join(env.root, '.migent', 'sessions', SOURCE, 'next.json'));
      await env.api.results.handle(source, { type: 'intent', intent: 'openTargetWorkflow', workflow: 'probe-target' });
      await expectOpens('workflow opened', path.join(env.root, '.migent', 'workflows', 'probe-target.yaml'));

      const before = activeFile();
      await env.api.results.handle(source, { type: 'intent', intent: 'openOutput', name: 'path:../../../etc/passwd' });
      await env.api.results.handle(source, { type: 'intent', intent: 'run', command: 'migent' });
      await env.api.results.handle(source, { type: 'intent', intent: 'openOutput', path: 'C:/x', name: 7 });
      await sleep(SETTLE_MS);
      assert.equal(activeFile(), before, 'invalid intents open nothing');

      // Lineage: the child opens its own panel, which shows the source link and the handoff provenance.
      await env.api.results.handle(source, { type: 'intent', intent: 'openSession', sessionId: TARGET });
      await waitFor('child panel opened', () => env.api.results.has(target));
      await waitFor('child model posted', () => env.api.results.lastModel(target) !== null);
      const child = env.api.results.lastModel(target);
      assert.ok(child?.source);
      assert.equal(child.source.sessionId, SOURCE);
      assert.equal(child.source.availability, 'retained');
      assert.equal(child.source.provenance.state, 'ok');
      await env.api.results.handle(target, { type: 'intent', intent: 'openHandoffFile', name: 'context_note' });
      await expectOpens('handoff file opened', path.join(env.root, '.migent', 'sessions', TARGET, 'handoff', '1', 'note.md'));
      assert.equal(env.api.results.count, 2);
      await waitFor('open panels hold outputs watchers', () => (env.project()?.watcher.watchCount ?? 0) > baseline);
      await closeAll(env);
      await waitFor('outputs watchers released', () => (env.project()?.watcher.watchCount ?? 0) <= baseline);
    },
  },
  {
    name: 'AC21/§6.6: background changes update an open panel without focusing, revealing or selecting anything',
    async run(env) {
      await handoffProject(env);
      const source = identity(env, SOURCE);
      env.api.results.open(source);
      await waitFor('model posted', () => env.api.results.lastModel(source) !== null);
      const taskFile = path.join(env.root, '.migent', 'sessions', SOURCE, 'task.md');
      await vscode.window.showTextDocument(vscode.Uri.file(taskFile), { preview: false });
      await waitFor('editor focused', () => same(activeFile(), taskFile) && env.api.results.activeTarget() === undefined);
      const baseline = env.api.results.revision(source);

      // An unrelated session changes: the panel re-reads and finds nothing new, so it posts nothing.
      write(migentPath(env.root, 'sessions', 'other', 'manifest.yaml'), manifest('other'));
      write(migentPath(env.root, 'sessions', 'other', 'status.json'), status('completed', { workflow_id: 'plan' }));
      await waitFor('other loaded', () => env.project()?.store.snapshot('other') !== undefined);
      await sleep(SETTLE_MS);
      assert.equal(env.api.results.revision(source), baseline, 'an unchanged model is not posted again');

      write(migentPath(env.root, 'sessions', SOURCE, 'outputs', 'extra.md'), 'x');
      await waitFor('new output shown', () =>
        env.api.results.lastModel(source)?.outputs.rows.some((row) => row.key === 'path:outputs/extra.md') === true,
      );
      write(migentPath(env.root, 'sessions', SOURCE, 'next.json'), '{ not json');
      await waitFor('invalid next.json shown', () => env.api.results.lastModel(source)?.next.state === 'invalid');
      assert.equal(env.api.results.lastModel(source)?.state, 'Completed', 'an invalid next.json keeps the session Completed');
      fs.rmSync(migentPath(env.root, 'sessions', SOURCE, 'next.json'));
      await waitFor('missing next.json shown', () => env.api.results.lastModel(source)?.next.state === 'missing');
      assert.equal(env.api.results.lastModel(source)?.outputs.rows.length, 2, 'outputs stay visible');

      assert.ok(same(activeFile(), taskFile), 'the active editor did not change');
      assert.equal(env.api.results.activeTarget(), undefined, 'the panel was not focused');

      // A write the watcher did not report (simulated by a refresh) is picked up by Refresh.
      write(migentPath(env.root, 'sessions', SOURCE, 'next.json'), JSON.stringify({ schema_version: 1, next: [] }));
      await vscode.commands.executeCommand('migent.refresh');
      await waitFor('refresh re-read next.json', () => env.api.results.lastModel(source)?.next.state === 'ok');

      fs.rmSync(migentPath(env.root, 'sessions', SOURCE), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await waitFor('removed session shown unavailable', () => env.api.results.lastModel(source)?.availability === 'unavailable');
      assert.ok(env.api.results.has(source), 'the panel stays open');

      await closeAll(env);
    },
  },
];

/** Run the S10 scenarios; returns the number of failed ones. */
export function runResultsScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
