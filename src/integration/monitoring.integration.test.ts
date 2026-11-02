/**
 * S4 host skeleton scenarios (plans/02-monitoring.md §8: AC2, AC5, AC14, AC19, AC20 subset, AC21 subset).
 *
 * Runs inside the extension host against the fixture workspace. Files are written from Node, as the
 * Migent CLI would, and the extension must pick them up through its own watchers.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  createProject,
  freshLock,
  manifest,
  migentPath,
  removeMigent,
  runScenarios,
  type Scenario,
  SETTLE_MS,
  sleep,
  status,
  waitFor,
  write,
  writeAtomic,
} from './harness';

const scenarios: Scenario[] = [
  {
    name: 'AC19/AC14: a folder is promoted when .migent appears and demoted when it is deleted',
    async run(env) {
      assert.equal(env.project(), undefined, 'no project before .migent exists');
      await createProject(env);
      removeMigent(env.root);
      await waitFor('project demoted', () => env.project() === undefined);
      assert.ok(env.changes.some((change) => change.type === 'projects'));
      write(migentPath(env.root, 'config.yaml'), 'schema_version: 1\n');
      await waitFor('project promoted again without reload', () => env.project() !== undefined);
    },
  },
  {
    name: 'AC2: a session directory whose marker arrives after its create event still appears, then follows its files',
    async run(env) {
      const project = await createProject(env);
      const dir = migentPath(env.root, 'sessions', 's1');
      fs.mkdirSync(dir, { recursive: true });
      await waitFor('pending directory discovered', () => project.store.scanOutcome.pending.includes('s1'));
      assert.equal(project.store.snapshot('s1'), undefined, 'no row before a marker exists');

      write(path.join(dir, 'manifest.yaml'), manifest('s1'));
      await waitFor('session promoted by its manifest', () => project.store.snapshot('s1') !== undefined);
      assert.ok(!project.store.scanOutcome.pending.includes('s1'));

      writeAtomic(path.join(dir, 'status.json'), status('active'));
      await waitFor('stopped', () => project.store.snapshot('s1')?.displayState.state === 'stopped');
      write(path.join(dir, 'session.lock'), freshLock());
      await waitFor('running', () => project.store.snapshot('s1')?.displayState.state === 'running');
      fs.rmSync(path.join(dir, 'session.lock'));
      await waitFor('stopped again', () => project.store.snapshot('s1')?.displayState.state === 'stopped');
      writeAtomic(path.join(dir, 'status.json'), status('completed'));
      await waitFor('completed', () => project.store.snapshot('s1')?.displayState.state === 'completed');
    },
  },
  {
    name: 'AC19: deleting and recreating sessions/ and a session directory resumes live updates, leaving no stale watcher',
    async run(env) {
      const project = await createProject(env);
      write(migentPath(env.root, 'sessions', 's1', 'manifest.yaml'), manifest('s1'));
      write(migentPath(env.root, 'sessions', 's1', 'status.json'), status('active'));
      await waitFor('s1 loaded', () => project.store.snapshot('s1') !== undefined);
      const withSessions = project.watcher.watchCount;

      fs.rmSync(migentPath(env.root, 'sessions'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await waitFor('sessions state missing', () => project.store.scanOutcome.state === 'missing');
      assert.equal(project.store.snapshot('s1'), undefined);
      await waitFor('watchers of the deleted folders disposed', () => project.watcher.watchCount < withSessions);

      write(migentPath(env.root, 'sessions', 's2', 'manifest.yaml'), manifest('s2'));
      write(migentPath(env.root, 'sessions', 's2', 'status.json'), status('active'));
      await waitFor('s2 appears after recreation', () => project.store.snapshot('s2') !== undefined);
      writeAtomic(migentPath(env.root, 'sessions', 's2', 'status.json'), status('completed'));
      await waitFor('s2 follows its files', () => project.store.snapshot('s2')?.displayState.state === 'completed');

      fs.rmSync(migentPath(env.root, 'sessions', 's2'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await waitFor('s2 removed', () => project.store.snapshot('s2') === undefined);
      // The files vanish before the directory does, so the directory is dropped from the scan a debounce later.
      await waitFor('s2 directory dropped from the scan', () => !project.store.scanOutcome.discovered.includes('s2'));
    },
  },
  {
    name: 'AC5/AC6: workflow and config edits update only the catalog, and invalid files are listed',
    async run(env) {
      const project = await createProject(env);
      let loads = 0;
      const originalLoad = project.store.load.bind(project.store);
      project.store.load = (): void => {
        loads += 1;
        originalLoad();
      };
      const before = env.changes.length;

      write(migentPath(env.root, 'workflows', 'plan.yaml'), 'id: plan\nstages:\n  - id: a\n');
      await waitFor('workflow listed', () => project.catalog.workflows().entries.some((entry) => entry.id === 'plan'));
      write(migentPath(env.root, 'workflows', 'broken.yaml'), 'id: [unclosed\n');
      await waitFor('invalid workflow listed with its error', () =>
        project.catalog.workflows().entries.some((entry) => entry.file === 'broken.yaml' && entry.state === 'invalid'),
      );
      write(migentPath(env.root, 'workflows', 'copy.yaml'), 'id: plan\n');
      await waitFor('duplicate id flagged', () =>
        project.catalog.workflows().entries.filter((entry) => entry.duplicate).length === 2,
      );
      fs.rmSync(migentPath(env.root, 'workflows', 'copy.yaml'));
      fs.rmSync(migentPath(env.root, 'workflows', 'broken.yaml'));
      await waitFor('only plan remains', () => project.catalog.workflows().entries.length === 1);

      writeAtomic(migentPath(env.root, 'config.yaml'), 'schema_version: 7\n');
      await waitFor('config re-read', () => project.catalog.config().schemaVersion === 7);

      fs.rmSync(migentPath(env.root, 'workflows'), { recursive: true });
      await waitFor('workflows folder missing', () => project.catalog.workflows().state === 'missing');
      write(migentPath(env.root, 'workflows', 'again.yaml'), 'id: again\n');
      await waitFor('workflows watched again after recreation', () =>
        project.catalog.workflows().entries.some((entry) => entry.id === 'again'),
      );

      assert.equal(loads, 0, 'session store was reloaded by a workflow or config edit');
      assert.ok(
        !env.changes.slice(before).some((change) => change.type === 'session'),
        'a session change was emitted by a workflow or config edit',
      );
    },
  },
  {
    name: 'AC20: retaining an execution watches its files, and releasing removes the detail watchers',
    async run(env) {
      const project = await createProject(env);
      write(migentPath(env.root, 'sessions', 's1', 'manifest.yaml'), manifest('s1'));
      write(migentPath(env.root, 'sessions', 's1', 'status.json'), status('active'));
      const execution = migentPath(env.root, 'sessions', 's1', 'executions', 'e1');
      write(path.join(execution, 'execution.json'), '{}');
      await waitFor('session loaded', () => project.store.snapshot('s1') !== undefined);
      await sleep(SETTLE_MS);
      const base = project.watcher.watchCount;
      const executionChanges = (): number =>
        env.changes.filter(
          (change) =>
            change.type === 'files' && change.targets.some((target) => target.kind === 'execution' && target.executionId === 'e1'),
        ).length;

      const handle = project.watcher.retain({ kind: 'execution', sessionId: 's1', executionId: 'e1' });
      assert.ok(project.watcher.watchCount > base, 'retain adds watchers');
      const first = executionChanges();
      write(path.join(execution, 'response.md'), 'r');
      await waitFor('response.md reported', () => executionChanges() > first);

      // A turn directory created after the retain, then a verify.md written into it.
      const second = executionChanges();
      fs.mkdirSync(path.join(execution, 'turns', 'turn-1'), { recursive: true });
      await waitFor('turn directory reported', () => executionChanges() > second);
      await sleep(SETTLE_MS);
      const third = executionChanges();
      write(path.join(execution, 'turns', 'turn-1', 'verify.md'), 'v');
      await waitFor('verify.md reported through the new turn watcher', () => executionChanges() > third);

      handle.dispose();
      await waitFor('detail watchers released', () => project.watcher.watchCount === base);
    },
  },
  {
    name: 'AC21 subset: migent.refresh re-announces everything and keeps live updates working',
    async run(env) {
      const project = await createProject(env);
      write(migentPath(env.root, 'sessions', 's1', 'manifest.yaml'), manifest('s1'));
      write(migentPath(env.root, 'sessions', 's1', 'status.json'), status('active'));
      await waitFor('session loaded', () => project.store.snapshot('s1') !== undefined);
      await sleep(SETTLE_MS);
      const before = project.watcher.watchCount;
      const count = (): number => env.changes.filter((change) => change.type === 'refresh').length;
      const refreshes = count();

      await vscode.commands.executeCommand('migent.refresh');
      assert.equal(count(), refreshes + 1, 'refresh change emitted');
      assert.equal(project.watcher.watchCount, before, 'watcher set rebuilt to the same size');

      writeAtomic(migentPath(env.root, 'sessions', 's1', 'status.json'), status('completed'));
      await waitFor('live update after refresh', () => project.store.snapshot('s1')?.displayState.state === 'completed');
    },
  },
];

/** Run the S4 scenarios; returns the number of failed ones. */
export function runMonitoringScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
