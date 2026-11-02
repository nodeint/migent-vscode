/**
 * Phase 3 control scenarios (plans/03-control.md §5). The fixture CLI (`fake-migent.js`) writes the same
 * session files the real CLI does, so these drive `ControlService` through the real runner, gate, watcher
 * and store. UI prompts (Quick Pick, Input Box) are not driven; the service methods behind them are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SessionSnapshot } from '../core/model';
import { createProject, type Env, freshLock, manifest, migentPath, runScenarios, type Scenario, status, waitFor, write } from './harness';

const RUN_MS = 'MIGENT_FAKE_RUN_MS';

function sessions(env: Env): SessionSnapshot[] {
  return env.project()?.store.all() ?? [];
}

const stateOf = (env: Env, state: string): SessionSnapshot | undefined =>
  sessions(env).find((snapshot) => snapshot.displayState.state === state);

/** Run `body` with the fake CLI configured by environment variables, restoring them afterwards. */
async function withFake(settings: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const scenarios: Scenario[] = [
  {
    name: 'AC1/AC4: Run starts one session, repeated clicks add none, and the gate is released after reconciliation',
    async run(env) {
      const project = await createProject(env);
      await withFake({ [RUN_MS]: '1200' }, async () => {
        // Two entry points press Run in the same instant: the launch key lets exactly one through.
        const both = Promise.all([
          env.api.control.runNew(project, 'plan', 'first task'),
          env.api.control.runNew(project, 'plan', 'second task'),
        ]);
        await waitFor('session running', () => stateOf(env, 'running') !== undefined);
        const running = stateOf(env, 'running');
        assert.ok(running);
        assert.ok(env.api.control.gate.current(project.key, running.sessionId), 'gate is held while running');
        await both;
        await waitFor('session completed', () => stateOf(env, 'completed') !== undefined);
        assert.equal(sessions(env).length, 1, 'exactly one session was created');
        assert.equal(env.api.control.gate.current(project.key, running.sessionId), undefined, 'gate released');
      });
    },
  },
  {
    name: 'AC2: Stop ends the run with a cancelled session, and Continue can resume it',
    async run(env) {
      const project = await createProject(env);
      await withFake({ [RUN_MS]: '30000' }, async () => {
        const run = env.api.control.runNew(project, 'plan', 'long task');
        await waitFor('session running', () => stateOf(env, 'running') !== undefined);
        const running = stateOf(env, 'running');
        assert.ok(running);
        await env.api.control.cancel(project, running);
        await run;
        await waitFor('session cancelled', () => stateOf(env, 'cancelled') !== undefined);
        assert.equal(env.api.control.gate.current(project.key, running.sessionId), undefined, 'gate released');
        const cancelled = stateOf(env, 'cancelled');
        assert.ok(cancelled);
        await withFake({ [RUN_MS]: '200' }, async () => {
          await env.api.control.continueSession(project, cancelled);
          await waitFor('session completed after continue', () => stateOf(env, 'completed') !== undefined);
        });
      });
    },
  },
  {
    name: 'AC5: Prepare keeps task text; Save & Run starts that prepared session without changing task.md',
    async run(env) {
      const project = await createProject(env);
      const file = await env.api.control.prepare(project, { workflowId: 'plan', title: 'Prepared', taskText: 'Write it.' });
      assert.ok(file, 'prepare returns task.md');
      assert.equal(fs.readFileSync(file, 'utf8'), 'Write it.');
      await waitFor('prepared session', () => stateOf(env, 'prepared') !== undefined);
      const prepared = stateOf(env, 'prepared');
      assert.ok(prepared);
      await withFake({ [RUN_MS]: '200' }, async () => {
        await env.api.control.runPrepared(project, prepared, 'plan');
        await waitFor('prepared session completed', () => stateOf(env, 'completed') !== undefined);
      });
      assert.equal(fs.readFileSync(file, 'utf8'), 'Write it.', 'task.md untouched by the run');
      assert.equal(sessions(env).length, 1, 'no replacement session');
    },
  },
  {
    name: 'AC5: Prepare without task text still leaves an empty task.md to edit',
    async run(env) {
      const project = await createProject(env);
      const file = await env.api.control.prepare(project, { workflowId: 'plan', title: 'Compose' });
      assert.ok(file, 'prepare returns task.md');
      assert.equal(fs.readFileSync(file, 'utf8'), '');
    },
  },
  {
    name: 'AC6: a foreign lock blocks writes on that session only, with its owner named',
    async run(env) {
      write(migentPath(env.root, 'sessions', 'held', 'manifest.yaml'), manifest('held', 'workflow_id: plan\n'));
      write(migentPath(env.root, 'sessions', 'held', 'status.json'), status('active'));
      write(
        migentPath(env.root, 'sessions', 'held', 'session.lock'),
        JSON.stringify({ pid: 4242, host: 'some-other-host', heartbeat_at: new Date().toISOString() }),
      );
      write(migentPath(env.root, 'sessions', 'free', 'manifest.yaml'), manifest('free', 'workflow_id: plan\n'));
      write(migentPath(env.root, 'sessions', 'free', 'status.json'), status('active'));
      const project = await createProject(env);
      await waitFor('both sessions', () => sessions(env).length === 2);
      const held = project.store.snapshot('held');
      const free = project.store.snapshot('free');
      assert.ok(held && free);
      assert.deepEqual(
        { held: env.api.control.check(project, held), free: env.api.control.check(project, free).ok },
        {
          held: { ok: false, reason: 'foreign-lock', host: 'some-other-host', pid: 4242, heartbeatAt: held.lock.kind === 'alive' ? held.lock.heartbeatAt : null, recovery: 'refresh' },
          free: true,
        },
      );
      assert.ok(env.api.control.check(project).ok, 'creating a new session stays available');
    },
  },
  {
    name: 'AC3: an own live lock keeps Stop available, and a stale gate never outlives a command error',
    async run(env) {
      write(migentPath(env.root, 'sessions', 'own', 'manifest.yaml'), manifest('own', 'workflow_id: plan\n'));
      write(migentPath(env.root, 'sessions', 'own', 'status.json'), status('active'));
      write(migentPath(env.root, 'sessions', 'own', 'session.lock'), freshLock());
      const project = await createProject(env);
      await waitFor('own session running', () => stateOf(env, 'running') !== undefined);
      const own = project.store.snapshot('own');
      assert.ok(own);
      assert.ok(env.api.control.check(project, own).ok, 'own lock does not block');
      // The fake CLI exits 2 for a session it does not run; the failed command must free the gate.
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_EXIT: '2' }, async () => {
        await env.api.control.runNew(project, 'plan', 'will fail');
      });
      assert.equal(env.api.control.gate.isLaunchBusy({ kind: 'launch', project: project.key, workflowId: 'plan' }), false);
      assert.ok(path.isAbsolute(env.root));
    },
  },
  {
    name: 'AC7: a changed workflow file is detected against the session copy, with absolute paths for the diff',
    async run(env) {
      const original = ['id: plan', 'stages:', '  - id: a', ''].join('\n');
      write(migentPath(env.root, 'workflows', 'plan.yaml'), original);
      write(migentPath(env.root, 'sessions', 'w1', 'manifest.yaml'), manifest('w1', 'workflow_id: plan' + '\n'));
      write(migentPath(env.root, 'sessions', 'w1', 'status.json'), status('cancelled'));
      write(migentPath(env.root, 'sessions', 'w1', 'workflow.frozen.yaml'), original);
      const project = await createProject(env);
      await waitFor('workflow and session', () => project.catalog.workflows().entries.length === 1 && sessions(env).length === 1);
      const snapshot = project.store.snapshot('w1');
      assert.ok(snapshot);
      assert.equal(env.api.control.workflowChange(project, snapshot), undefined, 'identical copy is not a change');
      write(migentPath(env.root, 'workflows', 'plan.yaml'), original + '  - id: b' + '\n');
      project.catalog.reloadWorkflow('plan.yaml');
      const change = env.api.control.workflowChange(project, snapshot);
      assert.ok(change, 'edited workflow is a change');
      assert.ok(path.isAbsolute(change.current) && fs.existsSync(change.current), 'current path is a real file');
      assert.ok(fs.existsSync(change.frozen), 'frozen path is a real file');
    },
  },
];

export function runControlScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
