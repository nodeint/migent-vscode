/**
 * S7 CLI capability scenarios (plans/02-monitoring.md §8: AC13). The fixture workspace points
 * `migent.cli.path` at `fake-migent.js` (run with node), so the default state is `ok`.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { type CapabilityKind, MINIMUM_CLI_VERSION } from '../cli/version';
import type { TreeNode } from '../vscode/views/nodes';
import { createProject, type Env, migentPath, runScenarios, type Scenario, waitFor, write } from './harness';

/** The fixture workspace's own `migent.cli.path` (a workspace-relative node script). */
const FIXTURE_CLI = './fake-migent.js';

async function setting(key: string, value: string | undefined): Promise<void> {
  await vscode.workspace.getConfiguration('migent').update(key, value, vscode.ConfigurationTarget.Workspace);
}

function kindOf(env: Env): CapabilityKind | undefined {
  const project = env.project();
  return project === undefined ? undefined : env.api.capability.state(project.key).kind;
}

const children = (env: Env, node?: TreeNode): TreeNode[] => env.api.sessionsTree.getChildren(node);

function diagnostic(env: Env): vscode.TreeItem | undefined {
  const node = children(env).find((candidate) => candidate.kind === 'leaf' && candidate.view.contextValue === 'diag.cli');
  return node === undefined ? undefined : env.api.sessionsTree.getTreeItem(node);
}

/** Change a setting, wait for the new capability kind, and always restore the fixture setting. */
async function withSetting(
  env: Env,
  key: string,
  value: string,
  expected: CapabilityKind,
  check: () => void,
): Promise<void> {
  await setting(key, value);
  try {
    await waitFor(`capability ${expected}`, () => kindOf(env) === expected);
    check();
  } finally {
    await setting(key, key === 'cli.path' ? FIXTURE_CLI : undefined);
    await waitFor('capability restored', () => kindOf(env) === 'ok');
  }
}

const scenarios: Scenario[] = [
  {
    name: 'AC13: a missing CLI shows a diagnostic with versions while sessions stay visible, and Recheck recovers',
    async run(env) {
      write(migentPath(env.root, 'sessions', 's1', 'manifest.yaml'), 'session_id: s1\nschema_version: 2\n');
      write(migentPath(env.root, 'sessions', 's1', 'status.json'), JSON.stringify({ status: 'completed' }));
      await createProject(env);
      await waitFor('capability ok', () => kindOf(env) === 'ok');
      await withSetting(env, 'cli.path', 'no-such-migent-cli', 'missing', () => {
        const item = diagnostic(env);
        assert.ok(item, 'diagnostic node exists');
        assert.match(String(item.label), /not found/);
        assert.match(String(item.tooltip), /Required version: 0\.3\.1/);
        assert.equal(env.api.capability.aggregate(), 'missing');
        assert.ok(children(env).some((node) => node.kind === 'group'), 'sessions stay visible');
      });
      await vscode.commands.executeCommand('migent.cli.recheck');
      assert.equal(kindOf(env), 'ok');
      assert.equal(diagnostic(env), undefined);
    },
  },
  {
    name: 'AC13: a .cmd launcher is unsupported',
    async run(env) {
      await createProject(env);
      fs.writeFileSync(path.join(env.root, 'migent.cmd'), '@echo off\r\n');
      await withSetting(env, 'cli.path', './migent.cmd', 'unsupported', () => {
        assert.match(String(diagnostic(env)?.tooltip), /\.cmd launcher/);
      });
    },
  },
  {
    name: 'AC13: a CLI older than the built-in minimum is old, with detected and required versions',
    async run(env) {
      await createProject(env);
      await waitFor('capability ok', () => kindOf(env) === 'ok');
      fs.writeFileSync(path.join(env.root, 'old-migent.js'), "console.log('migent 0.2.0');");
      await withSetting(env, 'cli.path', './old-migent.js', 'old', () => {
        const project = env.project();
        const state = project === undefined ? undefined : env.api.capability.state(project.key);
        assert.equal(state?.detected, '0.2.0');
        assert.equal(state?.required, MINIMUM_CLI_VERSION);
        assert.match(String(diagnostic(env)?.label), /older than/);
      });
    },
  },
];

/** Run the S7 scenarios; returns the number of failed ones. */
export function runCapabilityScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
