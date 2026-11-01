/**
 * S5 Sessions view scenarios (plans/02-monitoring.md §8: AC1, AC7, AC8, AC9 badge, AC15 sessions, AC20 children,
 * AC21 subset). The provider is read directly (`getChildren`/`getTreeItem`), as VS Code would.
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
  writeAtomic,
} from './harness';

const text = (value: vscode.TreeItem['label']): string => (typeof value === 'string' ? value : (value?.label ?? ''));
const labelsOf = (env: Env, nodes: TreeNode[]): string[] =>
  nodes.map((node) => text(env.api.sessionsTree.getTreeItem(node).label));
const children = (env: Env, node?: TreeNode): TreeNode[] => env.api.sessionsTree.getChildren(node);
const itemOf = (env: Env, node: TreeNode): vscode.TreeItem => env.api.sessionsTree.getTreeItem(node);
const iconId = (item: vscode.TreeItem): string => (item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : '');

function sessionNode(env: Env, sessionId: string): TreeNode {
  for (const group of children(env)) {
    const found = children(env, group).find((node) => node.kind === 'session' && node.sessionId === sessionId);
    if (found) return found;
  }
  throw new Error(`session ${sessionId} is not in the tree`);
}

function addSession(root: string, id: string, state: string, extra: Record<string, unknown> = {}, manifestExtra = ''): void {
  write(migentPath(root, 'sessions', id, 'manifest.yaml'), manifest(id, manifestExtra));
  write(migentPath(root, 'sessions', id, 'status.json'), status(state, { workflow_id: 'plan', ...extra }));
}

function copyCaptured(root: string, fixture: string, id: string): void {
  const source = path.join(repoRoot(), 'src', 'core', 'fixtures', 'captured', fixture);
  fs.cpSync(source, migentPath(root, 'sessions', id), { recursive: true });
}

async function waitForSessions(env: Env, ids: string[]): Promise<void> {
  const project = await createProject(env);
  await waitFor(`sessions loaded: ${ids.join(', ')}`, () => ids.every((id) => project.store.snapshot(id) !== undefined));
}

const scenarios: Scenario[] = [
  {
    name: 'AC1/AC9: sessions are grouped by state with icons, Unknown shows its reason, and the badge counts unique attention sessions',
    async run(env) {
      const { root } = env;
      fs.mkdirSync(migentPath(root, 'sessions'), { recursive: true });
      addSession(root, 'running', 'active');
      write(migentPath(root, 'sessions', 'running', 'session.lock'), freshLock());
      addSession(root, 'completed', 'completed');
      addSession(root, 'failed', 'active', { latest_execution_status: 'failed' });
      addSession(root, 'blocked', 'blocked', { blocked_by_execution_ids: ['0001-plan--attempt-01'] });
      addSession(root, 'stopped', 'active');
      copyCaptured(root, 'question-pending', 'asking');
      addSession(root, 'broken', 'active');
      write(migentPath(root, 'sessions', 'broken', 'status.json'), '{oops');
      addSession(root, 'future', 'active', {}, 'x: 1\n');
      write(migentPath(root, 'sessions', 'future', 'manifest.yaml'), 'session_id: future\nschema_version: 99\n');
      await waitForSessions(env, ['running', 'completed', 'failed', 'blocked', 'stopped', 'asking', 'broken', 'future']);

      const groups = children(env);
      assert.deepEqual(labelsOf(env, groups), ['Running', 'Needs attention', 'Recent']);
      const idsIn = (group: TreeNode): string[] =>
        children(env, group).flatMap((node) => (node.kind === 'session' ? [node.sessionId] : [])).sort();
      assert.deepEqual(idsIn(groups[0]!), ['running']);
      assert.deepEqual(idsIn(groups[1]!), ['asking', 'blocked', 'broken', 'failed', 'future', 'stopped']);
      assert.deepEqual(idsIn(groups[2]!), ['completed']);

      assert.equal(iconId(itemOf(env, sessionNode(env, 'running'))), 'sync~spin');
      assert.equal(iconId(itemOf(env, sessionNode(env, 'failed'))), 'error');
      const broken = itemOf(env, sessionNode(env, 'broken'));
      assert.equal(broken.description, 'status.json invalid');
      assert.equal(iconId(broken), 'bracket-error');
      assert.equal(broken.contextValue, 'session.unknown;reason-invalid-status');
      const future = itemOf(env, sessionNode(env, 'future'));
      assert.equal(future.description, 'Unsupported schema version 99');
      assert.equal(iconId(future), 'question');
      assert.equal(itemOf(env, sessionNode(env, 'asking')).contextValue, 'session.question;questions');

      // Blocked, Failed and Question count once each; Stopped and Unknown do not.
      await waitFor('badge', () => env.api.sessionsView.badge?.value === 3);
    },
  },
  {
    name: 'AC8: pending questions show in Question, Blocked and Running sessions, and history shows answers',
    async run(env) {
      const { root } = env;
      copyCaptured(root, 'question-pending', 'asking');
      copyCaptured(root, 'question-answered', 'answered');
      const synthetic = path.join(repoRoot(), 'src', 'core', 'fixtures', 'synthetic');
      for (const [fixture, id] of [['blocked-questions', 'blocked-q'], ['running-questions', 'running-q']] as const) {
        fs.cpSync(path.join(synthetic, fixture), migentPath(root, 'sessions', id), { recursive: true });
      }
      write(migentPath(root, 'sessions', 'running-q', 'session.lock'), freshLock());
      await waitForSessions(env, ['asking', 'answered', 'blocked-q', 'running-q']);

      const questionsOf = (id: string): TreeNode => {
        const found = children(env, sessionNode(env, id)).find((node) => node.kind === 'questions');
        assert.ok(found, `${id} has a Questions node`);
        return found;
      };
      for (const id of ['asking', 'blocked-q', 'running-q']) {
        const groups = children(env, questionsOf(id)).filter((node) => node.kind === 'questionGroup');
        assert.ok(groups.length > 0, `${id} lists pending question groups`);
      }
      const runningGroup = children(env).find((node) => itemOf(env, node).contextValue === 'group.running');
      assert.ok(runningGroup && children(env, runningGroup).some((node) => node.kind === 'session' && node.sessionId === 'running-q'));

      const askingGroups = children(env, questionsOf('asking')).filter((node) => node.kind === 'questionGroup');
      assert.equal(askingGroups.length, 1);
      assert.equal(itemOf(env, askingGroups[0]!).description, '3 pending');
      const pending = children(env, askingGroups[0]!);
      assert.equal(pending.length, 3);
      assert.match(labelsOf(env, pending)[0] ?? '', /Which editor theme/);

      const history = children(env, questionsOf('answered')).find((node) => node.kind === 'history');
      assert.ok(history);
      const records = children(env, history);
      assert.deepEqual(
        records.map((node) => itemOf(env, node).description),
        ['answered · Light', 'answered · Windows, Linux', 'answered · "Either is fine; this is a fixture probe…"'],
      );
    },
  },
  {
    name: 'AC20/AC21: execution files follow the disk through narrow refreshes, and collapsing releases the watchers',
    async run(env) {
      const { root } = env;
      const executionId = '0001-plan--attempt-01';
      addSession(root, 's1', 'active');
      const execution = migentPath(root, 'sessions', 's1', 'executions', executionId);
      write(path.join(execution, 'execution.json'), JSON.stringify({ execution_id: executionId, stage_id: 'plan', status: 'completed' }));
      write(path.join(execution, 'prompt.md'), 'p');
      await waitForSessions(env, ['s1']);
      const project = env.project()!;
      const baseWatchers = project.watcher.watchCount;

      const fired: unknown[] = [];
      const subscription = env.api.sessionsTree.onDidChangeTreeData((element) => fired.push(element));
      try {
        const session = sessionNode(env, 's1');
        const executions = children(env, session).filter((node) => node.kind === 'execution');
        assert.equal(executions.length, 1);
        assert.equal(itemOf(env, executions[0]!).label, 'plan · attempt 1');
        assert.deepEqual(labelsOf(env, children(env, executions[0]!)), ['prompt.md']);
        assert.ok(env.api.sessionsTree.retainedCount >= 2, 'expanding retains executions and the execution');
        assert.ok(project.watcher.watchCount > baseWatchers);

        write(path.join(execution, 'response.md'), 'r');
        await waitFor('response.md listed', () => labelsOf(env, children(env, executions[0]!)).includes('response.md'));
        write(path.join(execution, 'artifacts', 'out.txt'), 'o');
        await waitFor('artifact listed', () => labelsOf(env, children(env, executions[0]!)).includes('out.txt'));
        write(path.join(execution, 'turns', 'turn-1', 'verify.md'), 'v');
        await waitFor('verify listed by turn', () => labelsOf(env, children(env, executions[0]!)).includes('verify · turn 1'));
        await waitFor('the tree was told to refresh', () => fired.length > 0);

        env.api.sessionsTree.collapse(executions[0]!);
        env.api.sessionsTree.collapse(session);
        assert.equal(env.api.sessionsTree.retainedCount, 0);
        await waitFor('detail watchers removed', () => project.watcher.watchCount === baseWatchers);
      } finally {
        subscription.dispose();
      }
    },
  },
  {
    name: 'AC7: background updates keep the selection and do not change the active editor',
    async run(env) {
      const { root } = env;
      addSession(root, 's1', 'active');
      addSession(root, 's2', 'completed');
      await waitForSessions(env, ['s1', 's2']);

      const note = path.join(root, 'note.txt');
      fs.writeFileSync(note, 'note');
      try {
        await vscode.commands.executeCommand('workbench.view.extension.migent');
        const selected = sessionNode(env, 's1');
        await env.api.sessionsView.reveal(selected, { select: true, focus: false });
        await vscode.window.showTextDocument(vscode.Uri.file(note));
        const editorBefore = vscode.window.activeTextEditor?.document.uri.toString();
        assert.equal(env.api.sessionsView.selection[0]?.id, selected.id);

        writeAtomic(migentPath(root, 'sessions', 's1', 'status.json'), status('active', { latest_stage_id: 'implement' }));
        addSession(root, 's3', 'completed');
        await waitFor('update visible', () => String(itemOf(env, sessionNode(env, 's1')).description).includes('implement'));
        await waitFor('new session visible', () => env.project()?.store.snapshot('s3') !== undefined);
        await sleep(SETTLE_MS);

        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), editorBefore, 'active editor unchanged');
        assert.equal(env.api.sessionsView.selection[0]?.id, selected.id, 'selection unchanged');
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(note, { force: true });
      }
    },
  },
  {
    name: 'AC15/Show more: a missing sessions folder reads as "No sessions yet", and Show more raises the limit',
    async run(env) {
      const { root } = env;
      await createProject(env);
      assert.deepEqual(labelsOf(env, children(env)), ['No sessions yet']);

      const configuration = vscode.workspace.getConfiguration('migent');
      await configuration.update('sessions.limit', 1, vscode.ConfigurationTarget.Workspace);
      try {
        fs.rmSync(path.join(root, '.migent'), { recursive: true, force: true });
        await waitFor('project removed', () => env.project() === undefined);
        for (const [index, id] of ['a', 'b', 'c'].entries()) {
          write(migentPath(root, 'sessions', id, 'manifest.yaml'), manifest(id, '').replace('10:00', `10:0${index}`));
          write(migentPath(root, 'sessions', id, 'status.json'), status('completed'));
        }
        const project = await createProject(env);
        await waitFor('limited', () => project.store.hiddenCount === 2);
        const more = children(env).find((node) => node.kind === 'leaf' && node.view.contextValue === 'more');
        assert.ok(more && more.kind === 'leaf');
        assert.equal(more.view.label, 'Show more (2 hidden)');
        await vscode.commands.executeCommand(more.view.command!.command, ...more.view.command!.arguments);
        assert.equal(project.store.hiddenCount, 1, 'limit raised by migent.sessions.limit');
      } finally {
        await configuration.update('sessions.limit', undefined, vscode.ConfigurationTarget.Workspace);
      }
    },
  },
  {
    name: 'Commands: copy id and open task act on the tree node; a missing file is reported, never created',
    async run(env) {
      const { root } = env;
      addSession(root, 's1', 'active');
      write(migentPath(root, 'sessions', 's1', 'task.md'), '# task');
      await waitForSessions(env, ['s1']);
      const node = sessionNode(env, 's1');

      await vscode.commands.executeCommand('migent.session.copyId', node);
      assert.equal(await vscode.env.clipboard.readText(), 's1');

      await vscode.commands.executeCommand('migent.session.openTask', node);
      const taskPath = migentPath(root, 'sessions', 's1', 'task.md').toLowerCase();
      await waitFor('task.md opened', () => vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase() === taskPath);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      await vscode.commands.executeCommand('migent.session.openQuestions', node);
      await sleep(SETTLE_MS);
      assert.equal(vscode.window.activeTextEditor, undefined, 'nothing opened for a missing file');
      assert.ok(!fs.existsSync(migentPath(root, 'sessions', 's1', 'questions.json')), 'missing file was not created');
    },
  },
  {
    name: 'AC21 subset: a questions.json that appears later updates the history without a Refresh',
    async run(env) {
      const { root } = env;
      addSession(root, 's1', 'question', {
        questions: [{ id: '1', question: 'Proceed?', selection: 'single', options: [{ id: 'A', label: 'Yes' }], execution_id: 'e1', stage_id: 'plan', recipient: 'human' }],
      });
      await waitForSessions(env, ['s1']);
      const questions = children(env, sessionNode(env, 's1')).find((node) => node.kind === 'questions')!;
      const history = children(env, questions).find((node) => node.kind === 'history')!;
      assert.deepEqual(labelsOf(env, children(env, history)), ['No structured history']);

      const fired: unknown[] = [];
      const subscription = env.api.sessionsTree.onDidChangeTreeData((element) => fired.push(element));
      try {
        const answered = path.join(repoRoot(), 'src', 'core', 'fixtures', 'captured', 'question-answered', 'questions.json');
        write(migentPath(root, 'sessions', 's1', 'questions.json'), fs.readFileSync(answered, 'utf8'));
        await waitFor('history re-read', () => children(env, history).length === 3);
        await waitFor('the tree was told to refresh', () => fired.length > 0);
      } finally {
        subscription.dispose();
      }
    },
  },
];

/** Run the S5 scenarios; returns the number of failed ones. */
export function runSessionsTreeScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
