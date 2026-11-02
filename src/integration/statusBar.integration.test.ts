/**
 * S9 status bar scenarios (plans/02-monitoring.md §6.8, AC9).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import * as vscode from 'vscode';

import {
  createProject,
  type Env,
  freshLock,
  manifest,
  migentPath,
  runScenarios,
  type Scenario,
  status,
  waitFor,
  write,
} from './harness';

function addSession(env: Env, id: string, state: string, extra: Record<string, unknown> = {}, isRunning = false): void {
  write(migentPath(env.root, 'sessions', id, 'manifest.yaml'), manifest(id));
  write(migentPath(env.root, 'sessions', id, 'status.json'), status(state, { workflow_id: 'plan', ...extra }));
  if (isRunning) write(migentPath(env.root, 'sessions', id, 'session.lock'), freshLock());
}

const scenarios: Scenario[] = [
  {
    name: 'AC9: the status bar counts running and needs-attention sessions and hides when both are zero',
    async run(env) {
      await createProject(env);
      assert.equal(env.api.statusBar.isVisible, false);
      addSession(env, 'r1', 'active', {}, true);
      await waitFor('running shown', () => env.api.statusBar.text === '$(sync~spin) Migent: 1 running');
      addSession(env, 'f1', 'active', { latest_execution_status: 'failed' });
      await waitFor('both parts', () => env.api.statusBar.text === '$(sync~spin) Migent: 1 running · 1 needs attention');
      addSession(env, 'c1', 'completed');
      assert.match(env.api.statusBar.tooltip, /1 failed/);

      assert.equal(env.api.statusBar.command, 'migent.sessions.focus');
      await vscode.commands.executeCommand(env.api.statusBar.command);
      await waitFor('sessions view focused', () => env.api.sessionsView.visible);

      fs.rmSync(migentPath(env.root, 'sessions', 'f1'), { recursive: true, force: true });
      await waitFor('attention part gone', () => env.api.statusBar.text === '$(sync~spin) Migent: 1 running');
      fs.rmSync(migentPath(env.root, 'sessions', 'r1'), { recursive: true, force: true });
      await waitFor('hidden when nothing is left', () => !env.api.statusBar.isVisible);
    },
  },
];

/** Run the S9 scenarios; returns the number of failed ones. */
export function runStatusBarScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
