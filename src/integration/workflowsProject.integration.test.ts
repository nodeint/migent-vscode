/**
 * S6 Workflows and Project view scenarios (plans/02-monitoring.md §8: AC4, AC5, AC6, AC15 workflows).
 * The providers are read directly (`getChildren`/`getTreeItem`), as VS Code would.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import * as vscode from 'vscode';

import type { MetaNode } from '../vscode/views/projectNodes';
import {
  createProject,
  type Env,
  migentPath,
  removeMigent,
  runScenarios,
  type Scenario,
  waitFor,
  write,
} from './harness';

const text = (value: vscode.TreeItem['label']): string => (typeof value === 'string' ? value : (value?.label ?? ''));
const workflows = (env: Env): MetaNode[] => env.api.workflowsTree.getChildren();
const labels = (env: Env): string[] =>
  workflows(env).map((node) => text(env.api.workflowsTree.getTreeItem(node).label));
const nodeFor = (env: Env, label: string): MetaNode => {
  const node = workflows(env).find((candidate) => text(env.api.workflowsTree.getTreeItem(candidate).label) === label);
  assert.ok(node, `workflow row ${label}`);
  return node;
};
const itemFor = (env: Env, label: string): vscode.TreeItem => env.api.workflowsTree.getTreeItem(nodeFor(env, label));
const workflow = (id: string, extra = ''): string => `id: ${id}\ntitle: ${id} title\nstages:\n  - id: a\n${extra}`;
const activeFile = (): string => vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase() ?? '';

const scenarios: Scenario[] = [
  {
    name: 'AC4/AC6: workflow rows open the editor page and config opens in a native editor; invalid files and duplicates are flagged',
    async run(env) {
      const project = await createProject(env);
      // Workflows directory missing, then empty.
      await waitFor('missing directory row', () => labels(env).join() === 'No workflows directory');
      fs.mkdirSync(migentPath(env.root, 'workflows'));
      await waitFor('empty directory row', () => labels(env).join() === 'No workflows');

      write(migentPath(env.root, 'workflows', 'plan.yaml'), workflow('plan'));
      write(migentPath(env.root, 'workflows', 'broken.yml'), 'id: [unclosed\n');
      write(migentPath(env.root, 'workflows', 'a.yaml'), workflow('dup'));
      write(migentPath(env.root, 'workflows', 'b.yaml'), workflow('dup'));
      await waitFor('rows listed', () => labels(env).length === 4);
      assert.deepEqual(labels(env), ['broken.yml', 'dup', 'dup', 'plan']);

      const broken = itemFor(env, 'broken.yml');
      assert.equal(broken.contextValue, 'workflow.invalid');
      assert.ok(broken.description);
      assert.match(String(broken.tooltip), /Invalid workflow/);
      assert.match(String(itemFor(env, 'dup').description), /^duplicate id · [ab]\.yaml$/);
      assert.equal(itemFor(env, 'plan').contextValue, 'workflow.ok');

      // Clicking a row opens the editor page for that file, including the invalid one.
      for (const [label, file] of [['plan', 'plan.yaml'], ['broken.yml', 'broken.yml']] as const) {
        const { command } = itemFor(env, label);
        assert.equal(command?.command, 'migent.workflow.edit');
        await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
        assert.ok(env.api.workflowEditor.has({ project: project.key, file }), `editor page opened for ${file}`);
      }

      // The row's Open Workflow File action still opens the real file, including the invalid one.
      for (const [label, file] of [['plan', 'plan.yaml'], ['broken.yml', 'broken.yml']] as const) {
        await vscode.commands.executeCommand('migent.workflow.open', nodeFor(env, label));
        assert.equal(activeFile(), vscode.Uri.file(migentPath(env.root, 'workflows', file)).fsPath.toLowerCase());
      }

      // Project view: config.yaml opens in the native editor.
      const [config] = env.api.projectTree.getChildren();
      assert.ok(config);
      const item = env.api.projectTree.getTreeItem(config);
      assert.equal(item.contextValue, 'config.ok');
      assert.equal(item.command?.command, 'migent.openConfig');
      await vscode.commands.executeCommand(item.command.command, ...(item.command.arguments ?? []));
      assert.ok(env.api.config.has(project.key), 'configuration page opened');
      await vscode.commands.executeCommand('migent.openConfigFile', config);
      assert.equal(activeFile(), vscode.Uri.file(migentPath(env.root, 'config.yaml')).fsPath.toLowerCase());

    },
  },
  {
    name: 'AC5/AC6: workflow and config edits refresh only their views without reloading sessions; config states render',
    async run(env) {
      const project = await createProject(env);
      const sessionEvents: string[] = [];
      project.store.onDidChange((event) => sessionEvents.push(event.kind));
      const projectEvents: string[] = [];
      project.store.onDidChangeProject((event) => projectEvents.push(event.kind));
      write(migentPath(env.root, 'workflows', 'plan.yaml'), workflow('plan'));
      await waitFor('workflow listed', () => labels(env).join() === 'plan');
      fs.renameSync(migentPath(env.root, 'workflows', 'plan.yaml'), migentPath(env.root, 'workflows', 'other.yaml'));
      await waitFor('rename seen', () =>
        workflows(env).some((node) => node.kind === 'workflow' && node.file.endsWith('other.yaml')),
      );
      fs.rmSync(migentPath(env.root, 'workflows', 'other.yaml'));
      await waitFor('deleted workflow gone', () => labels(env).join() === 'No workflows');

      const configItem = (): vscode.TreeItem => {
        const [node] = env.api.projectTree.getChildren();
        assert.ok(node);
        return env.api.projectTree.getTreeItem(node);
      };
      write(migentPath(env.root, 'config.yaml'), 'schema_version: [oops\n');
      await waitFor('invalid config', () => configItem().contextValue === 'config.invalid');
      assert.ok(configItem().command, 'an invalid config still opens its file');
      fs.rmSync(migentPath(env.root, 'config.yaml'));
      await waitFor('missing config', () => configItem().contextValue === 'config.missing');
      assert.equal(configItem().command, undefined, 'nothing to open and nothing created');
      assert.equal(fs.existsSync(migentPath(env.root, 'config.yaml')), false);

      assert.deepEqual(sessionEvents, [], 'no session store reload');
      assert.ok(!projectEvents.includes('scan'), 'no sessions scan');
    },
  },
  {
    name: 'AC19: deleting .migent removes the project rows',
    async run(env) {
      await createProject(env);
      write(migentPath(env.root, 'workflows', 'plan.yaml'), workflow('plan'));
      await waitFor('workflow listed', () => labels(env).join() === 'plan');
      removeMigent(env.root);
      await waitFor('rows gone', () => workflows(env).length === 0 && env.api.projectTree.getChildren().length === 0);
    },
  },
];

/** Run the S6 scenarios; returns the number of failed ones. */
export function runWorkflowsProjectScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
