/**
 * S10 Overview scenarios (plans/02-monitoring.md §6.8, AC10, AC21 subset, §6.6 no focus stealing), run on the
 * Overview tab of the Session page. The page itself is not inspected: the host's last posted model and its intent
 * handler are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { OverviewModel } from '../core/overviewModel';
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
  settledRevision,
  sleep,
  status,
  waitFor,
  write,
} from './harness';

const CLOSE_SETTLE_MS = 1500;
const SOURCE = '00000000-0000-4000-8000-0000000000b1';
const TARGET = '00000000-0000-4000-8000-0000000000b2';

const eventLine = (seq: number, event: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    v: 1,
    seq,
    event,
    timestamp: '2026-11-01T10:15:30.000+00:00',
    execution_id: '0001-plan--attempt-01',
    ...extra,
  })}\n`;


const identity = (env: Env, sessionId: string): { project: string; sessionId: string } => {
  const project = env.project();
  assert.ok(project, 'project exists');
  return { project: project.key, sessionId };
};

/** The Overview tab model last posted to the session's Session panel; null on any other tab or without a panel. */
const overviewOf = (env: Env, id: { project: string; sessionId: string }): OverviewModel | null => {
  const page = env.api.session.lastModel(id);
  return page?.tab === 'overview' ? page.overview : null;
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
      .flatMap((node) => node.kind === 'recentPeriod' ? env.api.sessionsTree.getChildren(node) : [node])
      .find((node) => node.kind === 'session' && node.sessionId === sessionId);
    if (found) return found;
  }
  throw new Error(`session ${sessionId} is not in the tree`);
}

async function closeAll(env: Env): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('panels closed', () => env.api.session.count === 0);
  // VS Code keeps watching the folder of a closed file for a moment, which blocks deleting it on Windows.
  await sleep(CLOSE_SETTLE_MS);
}

const scenarios: Scenario[] = [
  {
    name: 'AC10: a session row opens one reused Overview panel; a palette-style command targets its session',
    async run(env) {
      await handoffProject(env);
      const id = identity(env, SOURCE);
      const item = env.api.sessionsTree.getTreeItem(sessionNode(env, SOURCE));
      const { command } = item;
      assert.ok(command, 'a Completed row has a click command');
      assert.equal(command.command, 'migent.session.open');

      write(migentPath(env.root, 'sessions', 'running', 'manifest.yaml'), manifest('running'));
      write(migentPath(env.root, 'sessions', 'running', 'status.json'), status('active', { workflow_id: 'plan' }));
      write(migentPath(env.root, 'sessions', 'running', 'session.lock'), freshLock());
      await waitFor('running loaded', () => env.project()?.store.snapshot('running') !== undefined);
      assert.equal(env.api.sessionsTree.getTreeItem(sessionNode(env, 'running')).command?.command, 'migent.session.open');

      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      await waitFor('panel opened', () => env.api.session.has(id));
      await waitFor('model posted', () => overviewOf(env, id) !== null);
      const model = overviewOf(env, id);
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
      assert.equal(env.api.session.count, 1, 'reopening reuses the panel');

      await waitFor('panel is active', () => env.api.session.activeTarget()?.sessionId === SOURCE);
      await vscode.commands.executeCommand('migent.session.openTask');
      await waitFor('task.md of the bound session opened', () =>
        same(activeFile(), path.join(env.root, '.migent', 'sessions', SOURCE, 'task.md')),
      );
      await closeAll(env);
    },
  },
  {
    name: 'A non-completed row opens Overview for its own session, expandable, reused and updated in place',
    async run(env) {
      await handoffProject(env);
      write(migentPath(env.root, 'sessions', 'running', 'manifest.yaml'), manifest('running'));
      write(migentPath(env.root, 'sessions', 'running', 'status.json'), status('active', { workflow_id: 'plan' }));
      write(migentPath(env.root, 'sessions', 'running', 'session.lock'), freshLock());
      await waitFor('running loaded', () => env.project()?.store.snapshot('running') !== undefined);
      const id = identity(env, 'running');
      const node = sessionNode(env, 'running');
      const item = env.api.sessionsTree.getTreeItem(node);
      assert.notEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None, 'the row stays expandable');
      const { command } = item;
      assert.ok(command, 'a Running row has a click command');
      assert.equal(command.command, 'migent.session.open');
      assert.deepEqual(command.arguments, [node]);

      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      await waitFor('panel opened', () => env.api.session.has(id));
      await waitFor('model posted', () => overviewOf(env, id) !== null);
      const running = overviewOf(env, id);
      assert.ok(running);
      assert.equal(running.availability, 'ok');
      assert.equal(running.sessionId, 'running');
      assert.equal(running.state, 'Running');
      assert.deepEqual(running.outputs.rows, []);
      assert.deepEqual(running.next.suggestions, []);

      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      assert.equal(env.api.session.count, 1, 'reopening reuses the panel');

      fs.rmSync(migentPath(env.root, 'sessions', 'running', 'session.lock'));
      write(migentPath(env.root, 'sessions', 'running', 'status.json'), status('completed', { workflow_id: 'plan' }));
      await waitFor('panel shows Completed', () => overviewOf(env, id)?.state === 'Completed');
      assert.equal(env.api.session.count, 1, 'the transition did not open another panel');
      await closeAll(env);
    },
  },
  {
    name: 'P8: Latest activity follows events.jsonl appends while Running, without focus changes',
    async run(env) {
      write(migentPath(env.root, 'sessions', 'live', 'manifest.yaml'), manifest('live'));
      write(migentPath(env.root, 'sessions', 'live', 'status.json'), status('active', { workflow_id: 'plan' }));
      write(migentPath(env.root, 'sessions', 'live', 'session.lock'), freshLock());
      const events = migentPath(env.root, 'sessions', 'live', 'events.jsonl');
      write(events, eventLine(1, 'execution.started', { summary: 'claude/sonnet' }));
      write(migentPath(env.root, 'sessions', 'live', 'task.md'), 'Do the work\n');

      await createProject(env);
      await waitFor('live loaded', () => env.project()?.store.snapshot('live')?.displayState.state === 'running');
      const id = identity(env, 'live');
      env.api.session.open(id, { tab: 'overview' });
      await waitFor('overview posted', () => overviewOf(env, id) !== null);
      const running = overviewOf(env, id);
      assert.ok(running);
      assert.equal(running.activity.visible, true);
      assert.equal(running.activity.lines.length, 1);
      assert.match(running.activity.lines[0] ?? '', /plan#1 started · claude\/sonnet/);

      // Work in a text editor, so the panel is not the active target; the append must not steal focus.
      const taskFile = migentPath(env.root, 'sessions', 'live', 'task.md');
      await vscode.window.showTextDocument(vscode.Uri.file(taskFile), { preview: false });
      await waitFor('editor focused', () => same(activeFile(), taskFile) && env.api.session.activeTarget() === undefined);
      const baseline = await settledRevision(env, id);

      fs.appendFileSync(events, eventLine(2, 'execution.completed'));
      await waitFor('activity followed the append', () => {
        const model = overviewOf(env, id);
        return (
          env.api.session.revision(id) > baseline &&
          model?.activity.visible === true &&
          model.activity.lines.length === 2
        );
      });
      const followed = overviewOf(env, id);
      assert.ok(followed?.activity.visible);
      assert.match(followed.activity.lines[1] ?? '', /plan#1 completed/);
      assert.ok(same(activeFile(), taskFile), 'the active editor did not change');
      assert.equal(env.api.session.activeTarget(), undefined, 'the panel was not focused');
      assert.equal(env.api.session.count, 1, 'no second panel was opened');
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
      env.api.session.open(source, { tab: 'overview' });
      await waitFor('model posted', () => overviewOf(env, source) !== null);
      const expectOpens = async (label: string, file: string): Promise<void> => {
        try {
          await waitFor(label, () => same(activeFile(), file));
        } catch (error) {
          throw new Error(`${String(error)} (${describeEditors()})`, { cause: error });
        }
      };

      await env.api.session.handle(source, { type: 'intent', intent: 'openOutput', name: 'name:note' });
      await expectOpens('output opened', path.join(env.root, '.migent', 'sessions', SOURCE, 'outputs', 'note.md'));
      await env.api.session.handle(source, { type: 'intent', intent: 'openNextFile' });
      await expectOpens('next.json opened', path.join(env.root, '.migent', 'sessions', SOURCE, 'next.json'));
      await env.api.session.handle(source, { type: 'intent', intent: 'openTargetWorkflow', workflow: 'probe-target' });
      await expectOpens('workflow opened', path.join(env.root, '.migent', 'workflows', 'probe-target.yaml'));
      // Copy goes through the host: the closed intent carries identity only and the host writes the clipboard.
      await env.api.session.handle(source, { type: 'intent', intent: 'copyValue', kind: 'sessionId', sessionId: SOURCE });
      assert.equal(await vscode.env.clipboard.readText(), SOURCE);
      // Header actions run the existing session command for this panel's own session, never the active panel's.
      await env.api.session.handle(source, { type: 'intent', intent: 'sessionAction', action: 'openTask' });
      await expectOpens('task.md of the panel session opened', path.join(env.root, '.migent', 'sessions', SOURCE, 'task.md'));
      env.api.session.open(target, { tab: 'overview' });
      await waitFor('target panel model', () => overviewOf(env, target) !== null);
      await env.api.session.handle(target, { type: 'intent', intent: 'sessionAction', action: 'openTask' });
      await expectOpens('task.md of the other panel session opened', path.join(env.root, '.migent', 'sessions', TARGET, 'task.md'));

      const before = activeFile();
      await env.api.session.handle(source, { type: 'intent', intent: 'openOutput', name: 'path:../../../etc/passwd' });
      await env.api.session.handle(source, { type: 'intent', intent: 'run', command: 'migent' });
      await env.api.session.handle(source, { type: 'intent', intent: 'openOutput', path: 'C:/x', name: 7 });
      await env.api.session.handle(source, { type: 'intent', intent: 'sessionAction', action: 'deleteSession' });
      await env.api.session.handle(source, { type: 'intent', intent: 'sessionAction', action: 'migent.session.openOutput' });
      await env.api.session.handle(source, { type: 'intent', intent: 'sessionAction' });
      await sleep(SETTLE_MS);
      assert.equal(activeFile(), before, 'invalid intents open nothing');

      // Lineage: the child opens its own panel, which shows the source link and the handoff provenance.
      await env.api.session.handle(source, { type: 'intent', intent: 'openSession', sessionId: TARGET });
      await waitFor('child panel opened', () => env.api.session.has(target));
      await waitFor('child model posted', () => overviewOf(env, target) !== null);
      const child = overviewOf(env, target);
      assert.ok(child?.source);
      assert.equal(child.source.sessionId, SOURCE);
      assert.equal(child.source.availability, 'retained');
      assert.equal(child.source.provenance.state, 'ok');
      await env.api.session.handle(target, { type: 'intent', intent: 'openHandoffFile', name: 'context_note' });
      await expectOpens('handoff file opened', path.join(env.root, '.migent', 'sessions', TARGET, 'handoff', '1', 'note.md'));
      await env.api.session.handle(target, { type: 'intent', intent: 'copyValue', kind: 'handoffHash', name: 'context_note' });
      assert.equal(
        await vscode.env.clipboard.readText(),
        '02edbc066ee4147972f6aa6d611524c74135a06528ec94a2450cc84dd3bf084b',
      );
      await env.api.session.handle(target, { type: 'intent', intent: 'copyValue', kind: 'handoffSourcePath', name: 'context_note' });
      // The recorded source path is copied verbatim; the captured fixture was recorded on Windows.
      assert.equal(
        await vscode.env.clipboard.readText(),
        `C:\\project\\.migent\\sessions\\${SOURCE}\\outputs\\note.md`,
      );
      assert.equal(env.api.session.count, 2);
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
      env.api.session.open(source, { tab: 'overview' });
      await waitFor('model posted', () => overviewOf(env, source) !== null);
      const taskFile = path.join(env.root, '.migent', 'sessions', SOURCE, 'task.md');
      await vscode.window.showTextDocument(vscode.Uri.file(taskFile), { preview: false });
      await waitFor('editor focused', () => same(activeFile(), taskFile) && env.api.session.activeTarget() === undefined);
      const baseline = await settledRevision(env, source);

      // An unrelated session changes: the panel re-reads and finds nothing new, so it posts nothing.
      write(migentPath(env.root, 'sessions', 'other', 'manifest.yaml'), manifest('other'));
      write(migentPath(env.root, 'sessions', 'other', 'status.json'), status('completed', { workflow_id: 'plan' }));
      await waitFor('other loaded', () => env.project()?.store.snapshot('other') !== undefined);
      await sleep(SETTLE_MS);
      assert.equal(env.api.session.revision(source), baseline, 'an unchanged model is not posted again');

      write(migentPath(env.root, 'sessions', SOURCE, 'outputs', 'extra.md'), 'x');
      await waitFor('new output shown', () =>
        overviewOf(env, source)?.outputs.rows.some((row) => row.key === 'path:outputs/extra.md') === true,
      );
      write(migentPath(env.root, 'sessions', SOURCE, 'next.json'), '{ not json');
      await waitFor('invalid next.json shown', () => overviewOf(env, source)?.next.state === 'invalid');
      assert.equal(overviewOf(env, source)?.state, 'Completed', 'an invalid next.json keeps the session Completed');
      fs.rmSync(migentPath(env.root, 'sessions', SOURCE, 'next.json'));
      await waitFor('missing next.json shown', () => overviewOf(env, source)?.next.state === 'missing');
      assert.equal(overviewOf(env, source)?.outputs.rows.length, 2, 'outputs stay visible');

      assert.ok(same(activeFile(), taskFile), 'the active editor did not change');
      assert.equal(env.api.session.activeTarget(), undefined, 'the panel was not focused');

      // A write the watcher did not report (simulated by a refresh) is picked up by Refresh.
      write(migentPath(env.root, 'sessions', SOURCE, 'next.json'), JSON.stringify({ schema_version: 1, next: [] }));
      await vscode.commands.executeCommand('migent.refresh');
      await waitFor('refresh re-read next.json', () => overviewOf(env, source)?.next.state === 'ok');

      fs.rmSync(migentPath(env.root, 'sessions', SOURCE), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await waitFor('removed session shown unavailable', () => overviewOf(env, source)?.availability === 'unavailable');
      assert.ok(env.api.session.has(source), 'the panel stays open');

      await closeAll(env);
    },
  },
];

/** Run the S10 Overview scenarios; returns the number of failed ones. */
export function runOverviewScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
