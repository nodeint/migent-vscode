/**
 * S5 Sessions view scenarios (plans/02-monitoring.md §8: AC1, AC7, AC8, AC9 badge, AC15 sessions, AC20 children,
 * AC21 subset). The provider is read directly (`getChildren`/`getTreeItem`), as VS Code would.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { deleteSession } from '../vscode/commands/deleteSession';
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
    const descendants = children(env, group).flatMap((node) => node.kind === 'recentPeriod' ? children(env, node) : [node]);
    const found = descendants.find((node) => node.kind === 'session' && node.sessionId === sessionId);
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
    name: 'Session files retain their directory structure, file icons and live updates',
    async run(env) {
      addSession(env.root, 'files', 'active');
      const folder = migentPath(env.root, 'sessions', 'files', 'custom', 'nested');
      write(path.join(folder, 'example.ts'), 'export {};');
      await waitForSessions(env, ['files']);
      const session = sessionNode(env, 'files');
      const files = children(env, session).find((node) => node.kind === 'directory');
      assert.ok(files);
      const baseWatchers = env.project()!.watcher.watchCount;
      const custom = children(env, files).find((node) => text(itemOf(env, node).label) === 'custom');
      assert.ok(custom);
      const nested = children(env, custom).find((node) => text(itemOf(env, node).label) === 'nested');
      assert.ok(nested);
      const file = children(env, nested).find((node) => text(itemOf(env, node).label) === 'example.ts');
      assert.ok(file);
      assert.equal(env.project()!.watcher.watchCount, baseWatchers + 3);
      const item = itemOf(env, file);
      assert.equal(item.resourceUri?.toString(), vscode.Uri.file(path.join(folder, 'example.ts')).toString());
      assert.equal(iconId(item), 'file');
      assert.equal(item.command?.command, 'vscode.open');
      const fired: unknown[] = [];
      const subscription = env.api.sessionsTree.onDidChangeTreeData((element) => fired.push(element));
      try {
        write(path.join(folder, 'new.json'), '{}');
        await waitFor('directory change notified', () => fired.some((event) => Array.isArray(event) && event.includes(nested)));
        assert.ok(labelsOf(env, children(env, nested)).includes('new.json'));
      } finally {
        subscription.dispose();
        if (files.kind === 'directory') env.api.sessionsTree.collapse(files);
        assert.equal(env.project()!.watcher.watchCount, baseWatchers);
        env.api.sessionsTree.collapse(session);
      }
    },
  },
  {
    name: 'Delete session respects cancellation and locks, then removes only the selected folder',
    async run(env) {
      addSession(env.root, 'delete-me', 'completed');
      addSession(env.root, 'keep-me', 'completed');
      await waitForSessions(env, ['delete-me', 'keep-me']);
      const project = env.project()!;
      const target = sessionNode(env, 'delete-me');
      const directory = migentPath(env.root, 'sessions', 'delete-me');
      const errors: string[] = [];
      let confirmed = false;
      let removals = 0;
      const ui = {
        confirm: async (): Promise<boolean> => confirmed,
        remove: async (uri: vscode.Uri): Promise<void> => {
          assert.equal(uri.fsPath.toLowerCase(), directory.toLowerCase());
          removals += 1;
          fs.rmSync(uri.fsPath, { recursive: true });
        },
        error: (message: string): void => { errors.push(message); },
      };
      const remove = (): Promise<void> =>
        deleteSession({ registry: env.api.registry, gate: env.api.control.gate }, target, ui);
      await remove();
      assert.equal(removals, 0, 'cancelling leaves the folder alone');
      confirmed = true;
      const held = env.api.control.gate.tryAcquire({ kind: 'session', project: project.key, sessionId: 'delete-me' });
      assert.ok(held);
      await remove();
      held.release();
      write(path.join(directory, 'session.lock'), freshLock());
      await remove();
      assert.equal(removals, 0, 'busy and locked sessions are not removed');
      assert.equal(errors.length, 2);
      fs.rmSync(path.join(directory, 'session.lock'));
      await deleteSession({ registry: env.api.registry, gate: env.api.control.gate }, target, {
        ...ui,
        remove: async () => { throw new Error('trash unavailable'); },
      });
      assert.match(errors[2] ?? '', /trash unavailable/);
      assert.ok(fs.existsSync(directory), 'a failed delete keeps the session');
      await remove();
      assert.equal(removals, 1);
      assert.equal(fs.existsSync(directory), false);
      assert.equal(fs.existsSync(migentPath(env.root, 'sessions', 'keep-me')), true);
      assert.equal(project.store.snapshot('delete-me'), undefined);
      assert.ok(project.store.snapshot('keep-me'));
    },
  },
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
      const periods = children(env, groups[2]!);
      assert.equal(periods.length, 1);
      assert.deepEqual(idsIn(periods[0]!), ['completed']);

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
    name: 'Recent groups sessions by creation date and preserves session commands',
    async run(env) {
      const now = new Date();
      for (const [id, days] of [['today', 0], ['yesterday', 1], ['older', 31]] as const) {
        const created = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12).toISOString();
        write(migentPath(env.root, 'sessions', id, 'manifest.yaml'), manifest(id, '').replace('2026-11-01T10:00:00.000+00:00', created));
        write(migentPath(env.root, 'sessions', id, 'status.json'), status('completed'));
      }
      await waitForSessions(env, ['today', 'yesterday', 'older']);
      const recent = children(env).find((node) => node.kind === 'group' && node.group === 'recent');
      assert.ok(recent);
      const periods = children(env, recent);
      assert.deepEqual(labelsOf(env, periods), ['Today', 'Yesterday', 'Older']);
      assert.deepEqual(periods.map((period) => children(env, period).map((node) => node.kind === 'session' && node.sessionId)), [
        ['today'], ['yesterday'], ['older'],
      ]);
      const session = sessionNode(env, 'today');
      assert.equal(itemOf(env, session).command?.command, 'migent.session.openResult');
      assert.equal(env.api.sessionsTree.getParent(session)?.id, periods[0]?.id);
    },
  },
  {
    name: 'Prepared is its own group after Needs attention: direct children, newest first, outside the limit and the badge, and moves on start',
    async run(env) {
      const { root } = env;
      const configuration = vscode.workspace.getConfiguration('migent', vscode.Uri.file(root));
      await configuration.update('sessions.limit', 1, vscode.ConfigurationTarget.WorkspaceFolder);
      try {
        for (const [id, state, minute] of [
          ['prep-old', 'prepared', '00'], ['prep-new', 'prepared', '02'], ['done', 'completed', '05'], ['old-done', 'completed', '01'],
          ['blocked', 'blocked', '04'],
        ] as const) {
          write(migentPath(root, 'sessions', id, 'manifest.yaml'), manifest(id, '').replace('10:00', `10:${minute}`));
          write(
            migentPath(root, 'sessions', id, 'status.json'),
            status(state, id === 'blocked' ? { blocked_by_execution_ids: ['0001-plan--attempt-01'] } : {}),
          );
        }
        const project = await createProject(env);
        await waitFor('sessions loaded', () => project.store.snapshot('prep-old') !== undefined);

        assert.equal(project.store.hiddenCount, 1, 'only the older completed session is hidden');
        const groups = children(env).filter((node) => node.kind === 'group');
        assert.deepEqual(labelsOf(env, groups), ['Needs attention', 'Prepared', 'Recent']);
        const prepared = groups[1]!;
        const rows = children(env, prepared);
        assert.deepEqual(rows.map((node) => node.kind === 'session' && node.sessionId), ['prep-new', 'prep-old']);
        assert.equal(iconId(itemOf(env, rows[0]!)), 'circle-outline');
        assert.match(itemOf(env, rows[0]!).contextValue ?? '', /^session\.prepared/);
        assert.equal(project.store.snapshot('prep-old')?.displayState.state, 'prepared', 'old prepared session is outside the limit');
        // Prepared sessions neither count toward the badge nor toward hidden sessions.
        await waitFor('badge', () => env.api.sessionsView.badge?.value === 1);

        // Starting a prepared session moves it to Running.
        write(migentPath(root, 'sessions', 'prep-new', 'status.json'), status('active'));
        write(migentPath(root, 'sessions', 'prep-new', 'session.lock'), freshLock());
        await waitFor('moved to Running', () => {
          const running = children(env).find((node) => itemOf(env, node).contextValue === 'group.running');
          return running !== undefined && children(env, running).some((node) => node.kind === 'session' && node.sessionId === 'prep-new');
        });
        const after = children(env).find((node) => itemOf(env, node).contextValue === 'group.prepared');
        assert.deepEqual(children(env, after!).map((node) => node.kind === 'session' && node.sessionId), ['prep-old']);
      } finally {
        await configuration.update('sessions.limit', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      }
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
        write(path.join(execution, 'artifacts', 'nested', 'result.json'), '{}');
        await waitFor('artifacts folder listed', () => labelsOf(env, children(env, executions[0]!)).includes('artifacts'));
        const artifacts = children(env, executions[0]!).find((node) => text(itemOf(env, node).label) === 'artifacts');
        assert.ok(artifacts);
        assert.ok(!labelsOf(env, children(env, executions[0]!)).includes('out.txt'));
        const entries = children(env, artifacts);
        assert.ok(labelsOf(env, entries).includes('out.txt'));
        const nested = entries.find((node) => text(itemOf(env, node).label) === 'nested');
        assert.ok(nested);
        const result = children(env, nested).find((node) => text(itemOf(env, node).label) === 'result.json');
        assert.ok(result);
        assert.equal(itemOf(env, result).resourceUri?.toString(),
          vscode.Uri.file(path.join(execution, 'artifacts', 'nested', 'result.json')).toString());
        write(path.join(execution, 'artifacts', 'nested', 'later.txt'), 'later');
        await waitFor('nested artifact change notified', () => fired.some((event) => Array.isArray(event) && event.includes(nested)));
        assert.ok(labelsOf(env, children(env, nested)).includes('later.txt'));
        fired.length = 0;
        fs.rmSync(path.join(execution, 'artifacts', 'nested', 'later.txt'));
        await waitFor('nested artifact deletion notified', () => fired.some((event) => Array.isArray(event) && event.includes(nested)));
        assert.ok(!labelsOf(env, children(env, nested)).includes('later.txt'));
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

      const configuration = vscode.workspace.getConfiguration('migent', vscode.Uri.file(root));
      await configuration.update('sessions.limit', 1, vscode.ConfigurationTarget.WorkspaceFolder);
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
        await configuration.update('sessions.limit', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
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
