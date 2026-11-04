/**
 * S7 CLI capability scenarios (plans/02-monitoring.md §8: AC13). The runner puts a `migent` launcher for
 * `fake-migent.js` first on `PATH` (as `npm install -g` would), so the default state is `ok`. A scenario
 * changes `PATH` for the extension host and runs Recheck, then restores it.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { type CapabilityKind, MINIMUM_CLI_VERSION } from '../cli/version';
import type { TreeNode } from '../vscode/views/nodes';
import { createProject, type Env, migentPath, runScenarios, type Scenario, waitFor, write } from './harness';

function kindOf(env: Env): CapabilityKind | undefined {
  const project = env.project();
  return project === undefined ? undefined : env.api.capability.state(project.key).kind;
}

const children = (env: Env, node?: TreeNode): TreeNode[] => env.api.sessionsTree.getChildren(node);

function diagnostic(env: Env): vscode.TreeItem | undefined {
  const node = children(env).find((candidate) => candidate.kind === 'leaf' && candidate.view.contextValue === 'diag.cli');
  return node === undefined ? undefined : env.api.sessionsTree.getTreeItem(node);
}

/** A launcher directory for `script` as the platform's package manager would write it, put first on PATH. */
function launcherDirectory(env: Env, name: string, script: string, cmdBody?: string): string {
  const directory = path.join(env.root, name);
  fs.mkdirSync(directory, { recursive: true });
  if (process.platform === 'win32') {
    const body = cmdBody ?? `@node "%~dp0\\${path.basename(script)}" %*\r\n`;
    write(path.join(directory, 'migent.cmd'), body);
  } else {
    write(path.join(directory, 'migent'), `#!/bin/sh\nexec node "$(dirname "$0")/${path.basename(script)}" "$@"\n`);
    fs.chmodSync(path.join(directory, 'migent'), 0o755);
  }
  return directory;
}

/** Run `check` with PATH replaced, after Recheck reaches `expected`; always restore PATH and Recheck. */
async function withPath(
  env: Env,
  value: (original: string) => string,
  expected: CapabilityKind,
  check: () => void,
): Promise<void> {
  const original = process.env.PATH ?? '';
  process.env.PATH = value(original);
  try {
    await vscode.commands.executeCommand('migent.cli.recheck');
    await waitFor(`capability ${expected}`, () => kindOf(env) === expected);
    check();
  } finally {
    process.env.PATH = original;
    await vscode.commands.executeCommand('migent.cli.recheck');
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
      const empty = path.join(env.root, 'empty-path');
      fs.mkdirSync(empty, { recursive: true });
      await withPath(env, () => empty, 'missing', () => {
        const item = diagnostic(env);
        assert.ok(item, 'diagnostic node exists');
        assert.match(String(item.label), /not found/);
        assert.match(String(item.tooltip), /Required version: 0\.3\.1/);
        assert.equal(env.api.capability.aggregate(), 'missing');
        assert.ok(children(env).some((node) => node.kind === 'group'), 'sessions stay visible');
      });
      assert.equal(kindOf(env), 'ok');
      assert.equal(diagnostic(env), undefined);
    },
  },
  {
    name: 'AC13: a .cmd launcher without a JavaScript entry is unsupported (Windows)',
    async run(env) {
      if (process.platform !== 'win32') return;
      await createProject(env);
      await waitFor('capability ok', () => kindOf(env) === 'ok');
      const directory = launcherDirectory(env, 'bad-launcher', 'none.js', '@echo off\r\n');
      await withPath(env, (original) => `${directory}${path.delimiter}${original}`, 'unsupported', () => {
        assert.match(String(diagnostic(env)?.tooltip), /\.cmd launcher/);
      });
    },
  },
  {
    name: 'AC13: a CLI older than the built-in minimum is old, with detected and required versions',
    async run(env) {
      await createProject(env);
      await waitFor('capability ok', () => kindOf(env) === 'ok');
      const directory = launcherDirectory(env, 'old-launcher', 'old-migent.js');
      fs.writeFileSync(path.join(directory, 'old-migent.js'), "console.log('migent 0.2.0');");
      await withPath(env, (original) => `${directory}${path.delimiter}${original}`, 'old', () => {
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
