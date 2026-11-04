/**
 * Session Metrics page scenarios. The page itself is not inspected: the host's last posted model, its
 * panel titles and its intent handler are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { SESSION_METRICS_VIEW_TYPE } from '../vscode/sessionMetrics/panels';
import {
  createProject,
  type Env,
  migentPath,
  removeMigent,
  repoRoot,
  runScenarios,
  type Scenario,
  SETTLE_MS,
  sleep,
  waitFor,
  write,
} from './harness';

const CLOSE_SETTLE_MS = 1500;
/** The id inside the fixture's manifest; the fixture directory is copied under this name. */
const SESSION = '00000000-0000-4000-8000-000000000001';

const identity = (env: Env, sessionId: string = SESSION): { project: string; sessionId: string } => {
  const project = env.project();
  assert.ok(project, 'project exists');
  return { project: project.key, sessionId };
};

const activeFile = (): string => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText ? input.uri.fsPath.toLowerCase() : '';
};
const same = (left: string, right: string): boolean => left.toLowerCase() === path.normalize(right).toLowerCase();

const fixtureDir = (): string => path.join(repoRoot(), 'src', 'core', 'fixtures', 'sessions', 'completed');
const sessionFile = (env: Env, ...parts: string[]): string => migentPath(env.root, 'sessions', SESSION, ...parts);

/** A project with the completed fixture session, with or without its metrics.json. */
async function metricsProject(env: Env, options: { isMetricsKept: boolean }): Promise<void> {
  fs.mkdirSync(migentPath(env.root, 'sessions'), { recursive: true });
  fs.cpSync(fixtureDir(), migentPath(env.root, 'sessions', SESSION), { recursive: true });
  if (!options.isMetricsKept) fs.rmSync(sessionFile(env, 'metrics.json'));
  write(sessionFile(env, 'task.md'), 'a task\n');
  const project = await createProject(env);
  await waitFor('session loaded', () => project.store.snapshot(SESSION) !== undefined);
}

async function closeAll(env: Env): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('panels closed', () => env.api.sessionMetrics.count === 0 && env.api.results.count === 0);
  // VS Code keeps watching the folder of a closed file for a moment, which blocks deleting it on Windows.
  await sleep(CLOSE_SETTLE_MS);
}

interface Contribution {
  contributes: {
    commands: { command: string }[];
    menus: Record<string, { command: string; when?: string; group?: string }[]>;
  };
}

const scenarios: Scenario[] = [
  {
    name: 'metrics: the command opens one reused page for a Completed session and posts a model without machine fields',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      await vscode.commands.executeCommand('migent.session.openMetrics', id);
      await waitFor('panel opened', () => env.api.sessionMetrics.has(id));
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id) !== null);
      const model = env.api.sessionMetrics.lastModel(id);
      assert.ok(model);
      assert.equal(model.availability, 'ok');
      assert.equal(model.state, 'Completed');
      assert.equal(model.workflowId, 'plan');
      assert.equal(
        env.api.sessionMetrics.title(id),
        env.api.sessionMetrics.lastModel(id)?.title,
        'a session titles its tab with the session title',
      );
      assert.equal(model.metrics.kind, 'ok');
      if (model.metrics.kind !== 'ok') return;
      assert.equal(model.metrics.totals.costPartial, true);
      assert.deepEqual(
        model.metrics.stages.map((stage) => stage.id),
        ['plan', 'review_plan'],
      );
      assert.equal(model.metrics.executions.length, 2);
      assert.equal(model.metrics.executions[1]?.usage.costUsd, null, 'a missing cost stays null');
      const json = JSON.stringify(model);
      for (const secret of ['argv', 'agent', 'cli_version', 'git_head', 'git_dirty', 'secret']) {
        assert.ok(!json.includes(secret), `the model does not contain ${secret}`);
      }

      await vscode.commands.executeCommand('migent.session.openMetrics', id);
      assert.equal(env.api.sessionMetrics.count, 1, 'reopening reuses the panel');
      await closeAll(env);
    },
  },
  {
    name: 'metrics: a Completed session without metrics.json opens an explanatory model; the file appearing updates it',
    async run(env) {
      await metricsProject(env, { isMetricsKept: false });
      const id = identity(env);
      env.api.sessionMetrics.open(id);
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id) !== null);
      assert.deepEqual(env.api.sessionMetrics.lastModel(id)?.metrics, { kind: 'missing' });
      assert.equal(env.api.sessionMetrics.lastModel(id)?.state, 'Completed');
      assert.equal(env.api.sessionMetrics.title(id), env.api.sessionMetrics.lastModel(id)?.title);

      const taskFile = sessionFile(env, 'task.md');
      await vscode.window.showTextDocument(vscode.Uri.file(taskFile), { preview: false });
      await waitFor('editor focused', () => same(activeFile(), taskFile));
      const baseline = env.api.sessionMetrics.revision(id);

      fs.copyFileSync(path.join(fixtureDir(), 'metrics.json'), sessionFile(env, 'metrics.json'));
      await waitFor('created metrics.json shown', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'ok');
      assert.ok(env.api.sessionMetrics.revision(id) > baseline, 'the revision grew');
      assert.ok(same(activeFile(), taskFile), 'a background change did not move the active editor');
      await closeAll(env);
    },
  },
  {
    name: 'metrics: rewriting metrics.json bumps the revision; invalid content shows invalid; an unrelated change posts nothing',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      env.api.sessionMetrics.open(id);
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'ok');
      const first = env.api.sessionMetrics.revision(id);

      const changed = JSON.parse(fs.readFileSync(sessionFile(env, 'metrics.json'), 'utf8')) as {
        totals: { cost_partial: boolean };
      };
      changed.totals.cost_partial = false;
      write(sessionFile(env, 'metrics.json'), JSON.stringify(changed));
      await waitFor('rewritten metrics shown', () => {
        const metrics = env.api.sessionMetrics.lastModel(id)?.metrics;
        return metrics?.kind === 'ok' && metrics.totals.costPartial === false;
      });
      assert.ok(env.api.sessionMetrics.revision(id) > first, 'the revision grew');

      write(sessionFile(env, 'metrics.json'), '{ not json');
      await waitFor('invalid metrics shown', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'invalid');
      assert.equal(env.api.sessionMetrics.lastModel(id)?.state, 'Completed', 'an invalid file keeps the session Completed');

      const settled = env.api.sessionMetrics.revision(id);
      write(sessionFile(env, 'outputs', 'note.md'), 'x');
      await sleep(SETTLE_MS);
      assert.equal(env.api.sessionMetrics.revision(id), settled, 'an unchanged model is not posted again');
      await closeAll(env);
    },
  },
  {
    name: 'metrics: page intents act on the panel session by identity; unknown intents are ignored',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      env.api.sessionMetrics.open(id);
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id) !== null);

      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'openMetricsFile' });
      await waitFor('metrics.json opened', () => same(activeFile(), sessionFile(env, 'metrics.json')));
      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'sessionAction', action: 'openTask' });
      await waitFor('task.md opened', () => same(activeFile(), sessionFile(env, 'task.md')));
      const before = activeFile();
      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'run', command: 'migent' });
      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'sessionAction', action: 'deleteSession' });
      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'sessionAction', action: 'migent.session.openTask' });
      await sleep(SETTLE_MS);
      assert.equal(activeFile(), before, 'unknown intents open nothing');
      await env.api.sessionMetrics.handle(id, { type: 'intent', intent: 'openResults' });
      await waitFor('results opened', () => env.api.results.has(id));

      await closeAll(env);
    },
  },
  {
    name: 'metrics: a Results Metrics action opens the page; the command is hidden from the Command Palette',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      env.api.results.open(id);
      await waitFor('results model posted', () => env.api.results.lastModel(id) !== null);
      await env.api.results.handle(id, { type: 'intent', intent: 'sessionAction', action: 'openMetrics' });
      await waitFor('metrics page opened', () => env.api.sessionMetrics.has(id));

      const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8')) as Contribution;
      const { menus, commands } = manifest.contributes;
      assert.ok(commands.some((item) => item.command === 'migent.session.openMetrics'));
      assert.deepEqual(
        menus.commandPalette?.filter((item) => item.command === 'migent.session.openMetrics').map((item) => item.when),
        ['false'],
      );
      const entry = menus['view/item/context']?.find((item) => item.command === 'migent.session.openMetrics');
      assert.equal(entry?.group, '1_open@6');
      assert.match(entry?.when ?? '', /viewItem =~ \/\^session\\\.completed\//);
      await closeAll(env);
    },
  },
  {
    name: 'metrics: restore adopts a deserialized panel once; it is unavailable when the project disappears',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      env.api.sessionMetrics.open(id);
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'ok');
      await closeAll(env);
      assert.equal(env.api.sessionMetrics.has(id), false);

      const create = (): vscode.WebviewPanel =>
        vscode.window.createWebviewPanel(SESSION_METRICS_VIEW_TYPE, 'Metrics', vscode.ViewColumn.Active, {
          enableScripts: true,
        });
      env.api.sessionMetrics.restore(create(), id);
      assert.ok(env.api.sessionMetrics.has(id), 'the stored identity restores the panel');
      await waitFor('restored model posted', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'ok');
      assert.equal(
        env.api.sessionMetrics.title(id),
        env.api.sessionMetrics.lastModel(id)?.title,
        'the restored panel is titled again',
      );
      env.api.sessionMetrics.restore(create(), id);
      env.api.sessionMetrics.restore(create(), { project: '', sessionId: '' });
      env.api.sessionMetrics.restore(create(), 'garbage');
      assert.equal(env.api.sessionMetrics.count, 1, 'a duplicate or malformed state adopts nothing');

      fs.rmSync(migentPath(env.root, 'sessions', SESSION), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await waitFor('removed session shown unavailable', () => env.api.sessionMetrics.lastModel(id)?.availability === 'unavailable');
      assert.ok(env.api.sessionMetrics.has(id), 'the panel stays open');
      assert.equal(env.api.sessionMetrics.lastModel(id)?.sessionId, SESSION);
      assert.equal(env.api.sessionMetrics.title(id), 'Metrics', 'an unavailable page has the plain title');
      await closeAll(env);
    },
  },
  {
    name: 'metrics: the page becomes unavailable when its project disappears and stays open',
    async run(env) {
      await metricsProject(env, { isMetricsKept: true });
      const id = identity(env);
      env.api.sessionMetrics.open(id);
      await waitFor('model posted', () => env.api.sessionMetrics.lastModel(id)?.metrics.kind === 'ok');

      removeMigent(env.root);
      // A dropped delete event is recovered by Refresh, as in the harness.
      for (let attempt = 0; env.project() !== undefined && attempt < 20; attempt += 1) {
        env.api.registry.refresh();
        await sleep(SETTLE_MS);
      }
      assert.equal(env.project(), undefined, 'the project is gone');
      await waitFor('project removal shown unavailable', () => env.api.sessionMetrics.lastModel(id)?.availability === 'unavailable');
      assert.ok(env.api.sessionMetrics.has(id), 'the panel stays open');
      assert.equal(env.api.sessionMetrics.title(id), 'Metrics');
      assert.equal(env.api.sessionMetrics.lastModel(id)?.sessionId, SESSION);
      await closeAll(env);
    },
  },
];

/** Run the Session Metrics scenarios; returns the number of failed ones. */
export function runSessionMetricsScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
