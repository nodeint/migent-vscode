/**
 * Phase 3 control scenarios (plans/03-control.md §5). The fixture CLI (`fake-migent.js`) writes the same
 * session files the real CLI does, so these drive `ControlService` through the real runner, gate, watcher
 * and store. UI prompts (Quick Pick, Input Box) are not driven; the service methods behind them are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { SessionSnapshot } from '../core/model';
import type { ProjectContext } from '../vscode/projects';
import { openWorkflowDraft, type PreparedSession } from '../vscode/workflowDraft';
import { createProject, type Env, freshLock, manifest, migentPath, openScenarioFolder, repoRoot, runScenarios, type Scenario, sleep, status, waitFor, write } from './harness';

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

interface PickItem {
  label: string;
  description?: string;
}

interface Answers {
  /** Root of the project to pick; the project picker is cancelled when undefined. */
  project?: string;
  workflow?: string;
  mode?: string;
  title?: string;
  /** What is done in the task Input Box, in order; the box is dismissed afterwards. Undefined dismisses at once. */
  task?: { kind: 'accept' | 'button'; value: string }[];
}

/** Records the prompts the New session command raises and answers them from `answers`; restores the API after. */
async function withPrompts(answers: Answers, body: (prompts: string[]) => Promise<void>): Promise<void> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const saved = {
    pick: window.showQuickPick,
    input: window.showInputBox,
    box: window.createInputBox,
    error: window.showErrorMessage,
  };
  const prompts: string[] = [];
  const wanted = (title: string): string | undefined => {
    if (title === 'Migent project') return answers.project;
    if (title === 'New session') return answers.workflow;
    return answers.mode;
  };
  window.showQuickPick = (items: PickItem[], options: { title?: string }): Promise<PickItem | undefined> => {
    const title = options.title ?? '';
    prompts.push(`pick:${title}`);
    const key = wanted(title);
    return Promise.resolve(items.find((item) => item.label === key || item.description === key));
  };
  window.showErrorMessage = (message: string): Promise<undefined> => {
    prompts.push(`error:${message}`);
    return Promise.resolve(undefined);
  };
  window.showInputBox = (options: {
    title?: string;
    validateInput?: (value: string) => string | undefined;
  }): Promise<string | undefined> => {
    prompts.push(`input:${options.title ?? ''}`);
    const invalid = answers.title === undefined ? undefined : options.validateInput?.(answers.title);
    if (invalid !== undefined) prompts.push(`invalid:${invalid}`);
    return Promise.resolve(invalid === undefined ? answers.title : undefined);
  };
  window.createInputBox = () => {
    const handlers: Record<string, () => void> = {};
    const box = {
      value: '',
      buttons: [],
      title: '',
      validationMessage: undefined as string | undefined,
      onDidAccept: (fn: () => void) => (handlers.accept = fn),
      onDidTriggerButton: (fn: () => void) => (handlers.button = fn),
      onDidHide: (fn: () => void) => (handlers.hide = fn),
      dispose: () => undefined,
      show: () => {
        prompts.push(`box:${box.title}`);
        setTimeout(() => {
          for (const event of answers.task ?? []) {
            box.value = event.value;
            (event.kind === 'accept' ? handlers.accept : handlers.button)?.();
            if (box.validationMessage !== undefined) prompts.push(`invalid:${box.validationMessage}`);
            box.validationMessage = undefined;
          }
          handlers.hide?.();
        }, 0);
      },
    };
    return box;
  };
  try {
    await body(prompts);
  } finally {
    window.showQuickPick = saved.pick;
    window.showInputBox = saved.input;
    window.createInputBox = saved.box;
    window.showErrorMessage = saved.error;
  }
}

const WORKFLOWS = ['plan', 'review'];

async function addWorkflows(project: ProjectContext, root: string): Promise<void> {
  for (const id of WORKFLOWS) write(migentPath(root, 'workflows', `${id}.yaml`), `id: ${id}\nstages:\n  - id: a\n`);
  await waitFor(`workflows listed in ${root}`, () => project.catalog.workflows().entries.length === WORKFLOWS.length);
}

/** A second project in its own workspace folder, with the same workflows; the caller disposes the folder. */
async function openSecondProject(
  env: Env,
): Promise<{ project: ProjectContext; root: string; dispose: () => Promise<void> }> {
  const knownKeys = new Set(env.api.registry.projects().map((candidate) => candidate.key));
  const folder = await openScenarioFolder();
  write(migentPath(folder.root, 'config.yaml'), 'schema_version: 1\n');
  await waitFor('second project appears', () => env.api.registry.projects().length === knownKeys.size + 1);
  // Match by identity, not by path text: on Windows the registry's root can differ in spelling (8.3 short names,
  // drive-letter case) from the path the folder was created under.
  const project = env.api.registry.projects().find((candidate) => !knownKeys.has(candidate.key));
  assert.ok(project, 'second project is registered');
  await waitFor('second CLI capability checked', () => env.api.capability.state(project.key).kind !== 'checking');
  await addWorkflows(project, folder.root);
  return { project, root: folder.root, dispose: () => folder.dispose() };
}

const argvAt = (root: string): string[][] => {
  const file = path.join(root, 'fake-argv.log');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);
};

const sessionsAt = (root: string): string[] => {
  const dir = migentPath(root, 'sessions');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

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
    name: 'AC5: Prepare creates editable tasks and Save & Run preserves the task',
    async run(env) {
      const project = await createProject(env);
      const prepared0 = await env.api.control.prepare(project, { workflowId: 'plan', title: 'Prepared', taskText: 'Write it.' });
      assert.ok(prepared0, 'prepare returns the session files');
      const file = prepared0.taskFile;
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
      const emptyPrepared = await env.api.control.prepare(project, { workflowId: 'plan', title: 'Compose' });
      assert.ok(emptyPrepared, 'prepare returns task.md');
      assert.equal(fs.readFileSync(emptyPrepared.taskFile, 'utf8'), '');
    },
  },
  {
    name: 'New session: Prepare in the picked project of two, with the picked workflow, asks each question once and does not start',
    async run(env) {
      const first = await createProject(env);
      await addWorkflows(first, env.root);
      const second = await openSecondProject(env);
      try {
        await withPrompts({ project: second.project.root, workflow: 'review', mode: 'Prepare', title: ' Draft plan ' }, async (prompts) => {
          await vscode.commands.executeCommand('migent.session.new');
          assert.deepEqual(prompts, ['pick:Migent project', 'pick:New session', 'pick:New session · review', 'input:Prepare review']);
        });
        await waitFor('prepared session in the second project', () => second.project.store.all().length === 1);
        const [prepared] = second.project.store.all();
        assert.equal(prepared.displayState.state, 'prepared');
        assert.equal(prepared.manifest?.workflowId, 'review');
        assert.deepEqual(argvAt(second.root).map((line) => line.slice(0, 2)), [['session', 'prepare']]);
        assert.ok(argvAt(second.root)[0].includes('Draft plan'), 'the trimmed title was sent');
        assert.ok(argvAt(second.root)[0].includes('review'), 'the picked workflow was sent');
        assert.deepEqual([argvAt(env.root), sessionsAt(env.root)], [[], []], 'the other project is untouched');
        assert.ok(vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('task.md'), 'task.md is open');
      } finally {
        await second.dispose();
      }
    },
  },
  {
    name: 'New session: Run now with Compose in editor keeps the text and prepares the picked workflow; Save & Run then starts it',
    async run(env) {
      const project = await createProject(env);
      await addWorkflows(project, env.root);
      await withPrompts({ workflow: 'review', mode: 'Run now', task: [{ kind: 'button', value: 'Half written' }] }, async (prompts) => {
        await vscode.commands.executeCommand('migent.session.new');
        assert.deepEqual(prompts, ['pick:New session', 'pick:New session · review', 'box:Run review']);
      });
      await waitFor('prepared session', () => stateOf(env, 'prepared') !== undefined);
      const prepared = stateOf(env, 'prepared');
      assert.ok(prepared);
      assert.equal(prepared.manifest?.workflowId, 'review');
      assert.equal(fs.readFileSync(migentPath(env.root, 'sessions', prepared.sessionId, 'task.md'), 'utf8'), 'Half written');
      assert.deepEqual(argvAt(env.root).map((line) => line[1]), ['prepare'], 'nothing was run');
      await withFake({ [RUN_MS]: '200' }, async () => {
        await vscode.commands.executeCommand('migent.session.start');
        await waitFor('same session completed', () => stateOf(env, 'completed')?.sessionId === prepared.sessionId);
      });
      assert.equal(sessions(env).length, 1, 'no replacement session');
    },
  },
  {
    name: 'New session: Run now with a short task runs the picked workflow with that task, and an empty task is refused',
    async run(env) {
      const project = await createProject(env);
      await addWorkflows(project, env.root);
      await withFake({ [RUN_MS]: '100' }, async () => {
        await withPrompts(
          { workflow: 'review', mode: 'Run now', task: [{ kind: 'accept', value: '   ' }, { kind: 'accept', value: ' Do the thing ' }] },
          async (prompts) => {
            await vscode.commands.executeCommand('migent.session.new');
            assert.equal(prompts.filter((prompt) => prompt.startsWith('invalid:')).length, 1, 'the empty task was refused once');
          },
        );
        await waitFor('session completed', () => stateOf(env, 'completed') !== undefined);
      });
      const runs = argvAt(env.root).filter((line) => line[1] === 'run');
      assert.equal(runs.length, 1, 'exactly one run');
      assert.ok(runs[0].includes('review') && runs[0].includes('Do the thing'), `workflow and task were sent: ${runs[0].join(' ')}`);
      assert.equal(stateOf(env, 'completed')?.manifest?.workflowId, 'review');
    },
  },
  {
    name: 'New session: cancelling or leaving the project, workflow, mode, title or task empty creates and runs nothing',
    async run(env) {
      const first = await createProject(env);
      await addWorkflows(first, env.root);
      const second = await openSecondProject(env);
      try {
        const attempts: Answers[] = [
          {},
          { project: env.root },
          { project: env.root, workflow: 'plan' },
          { project: second.project.root, workflow: 'plan', mode: 'Prepare' },
          { project: second.project.root, workflow: 'plan', mode: 'Prepare', title: '  ' },
          { project: second.project.root, workflow: 'plan', mode: 'Run now' },
          { project: second.project.root, workflow: 'plan', mode: 'Run now', task: [{ kind: 'accept', value: '' }] },
        ];
        for (const answers of attempts) {
          await withPrompts(answers, async () => {
            await vscode.commands.executeCommand('migent.session.new');
          });
        }
        await sleep(300);
        assert.deepEqual([argvAt(env.root), argvAt(second.root)], [[], []], 'the CLI was never called');
        assert.deepEqual([sessionsAt(env.root), sessionsAt(second.root)], [[], []], 'no session was created');
      } finally {
        await second.dispose();
      }
    },
  },
  {
    name: 'New session: the Sessions title bar offers a play-icon action beside Refresh, and the Palette does not',
    async run() {
      interface Item {
        command: string;
        when?: string;
        group?: string;
        icon?: string;
        title?: string;
      }
      const { contributes } = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8')) as {
        contributes: { commands: Item[]; menus: Record<string, Item[]> };
      };
      const command = contributes.commands.find((item) => item.command === 'migent.session.new');
      assert.deepEqual([command?.title, command?.icon], ['New session', '$(play)']);
      const titleBar = contributes.menus['view/title'].filter((item) => item.when?.startsWith('view == migent.sessions'));
      assert.deepEqual(
        titleBar.map((item) => [item.command, item.group?.startsWith('navigation')]),
        [['migent.session.new', true], ['migent.refresh', true]],
      );
      assert.ok(!titleBar.some((item) => item.when?.includes('sessionsState')), 'shown for empty and populated lists');
      assert.deepEqual(
        contributes.menus.commandPalette.filter((item) => item.command === 'migent.session.new').map((item) => item.when),
        ['false'],
      );
      assert.ok((await vscode.commands.getCommands(true)).includes('migent.session.new'), 'the command is registered');
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

const argvLog = (env: Env): string[][] =>
  fs
    .readFileSync(path.join(env.root, 'fake-argv.log'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);

const sessionFile = (env: Env, sessionId: string, name: string): string =>
  path.join(env.root, '.migent', 'sessions', sessionId, name);

const snapshotOf = (project: ProjectContext, sessionId: string): SessionSnapshot => {
  const snapshot = project.store.snapshot(sessionId);
  assert.ok(snapshot, 'session is in the store');
  return snapshot;
};

/** Prepare a session whose task is written, and wait until the store shows it as prepared. */
async function prepareReady(env: Env, project: ProjectContext, taskText?: string): Promise<PreparedSession> {
  const prepared = await env.api.control.prepare(project, { workflowId: 'plan', title: 'Draft', taskText });
  assert.ok(prepared, 'prepared');
  await waitFor('prepared session in the store', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'prepared');
  return prepared;
}

const gateHeld = (env: Env, project: ProjectContext, sessionId: string): boolean =>
  env.api.control.gate.current(project.key, sessionId) !== undefined;

scenarios.push(
  {
    name: "AC2/AC4: Prepare returns the session's workflow.yaml, and the open action opens that session's file",
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project);
      assert.equal(path.basename(prepared.workflowFile), 'workflow.yaml');
      assert.equal(path.basename(path.dirname(prepared.workflowFile)), prepared.sessionId, 'in the session folder');
      assert.ok(fs.existsSync(prepared.workflowFile), 'draft exists');
      await openWorkflowDraft(project, prepared.sessionId);
      const draftPath = vscode.Uri.file(prepared.workflowFile).fsPath;
      const isShown = (): boolean =>
        vscode.window.visibleTextEditors.some((editor) => editor.document.uri.fsPath === draftPath);
      await waitFor('draft editor', isShown);
      // The file may vanish before the click: nothing opens and nothing throws.
      fs.rmSync(prepared.workflowFile);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await openWorkflowDraft(project, prepared.sessionId);
      assert.equal(isShown(), false, 'no editor for a vanished draft');
    },
  },
  {
    name: 'AC1/AC4: Continue on an edited draft shows no change and never sends --refresh-workflow; a legacy session still adopts',
    async run(env) {
      const project = await createProject(env);
      write(migentPath(env.root, 'workflows', 'plan.yaml'), 'id: plan\nstages: []\n');
      const prepared = await prepareReady(env, project, 'Do it.');
      fs.appendFileSync(prepared.workflowFile, '# edited draft\n');
      let stopped: SessionSnapshot | undefined;
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_EXIT: '1' }, async () => {
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
        await waitFor('stopped', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'stopped');
        assert.ok(fs.existsSync(sessionFile(env, prepared.sessionId, 'workflow.frozen.yaml')), 'frozen');
        // The live file now differs from the frozen draft, which must not count as a change for a drafted session.
        write(migentPath(env.root, 'workflows', 'plan.yaml'), 'id: plan\nstages:\n  - id: b\n');
        project.catalog.reloadWorkflow('plan.yaml');
        stopped = snapshotOf(project, prepared.sessionId);
        assert.equal(env.api.control.workflowChange(project, stopped), undefined);
      });
      await withFake({ [RUN_MS]: '100' }, async () => {
        assert.ok(stopped);
        await env.api.control.continueSession(project, stopped, 'updated');
      });
      const last = argvLog(env).at(-1);
      assert.ok(last !== undefined && last.includes('continue'), 'continue was dispatched');
      assert.ok(!last.includes('--refresh-workflow'), `no adoption flag: ${JSON.stringify(last)}`);
      // Without workflow.yaml the live file is compared and adoption is still sent.
      write(migentPath(env.root, 'sessions', 'old', 'manifest.yaml'), manifest('old', 'workflow_id: plan\n'));
      write(migentPath(env.root, 'sessions', 'old', 'status.json'), status('cancelled'));
      write(migentPath(env.root, 'sessions', 'old', 'workflow.frozen.yaml'), 'id: plan\nstages: []\n');
      await waitFor('legacy session', () => project.store.snapshot('old') !== undefined);
      const old = snapshotOf(project, 'old');
      assert.ok(env.api.control.workflowChange(project, old), 'legacy session still sees the changed workflow');
      await withFake({ [RUN_MS]: '100' }, async () => {
        await env.api.control.continueSession(project, old, 'updated');
      });
      assert.ok(argvLog(env).at(-1)?.includes('--refresh-workflow'), 'legacy adoption still sends the flag');
    },
  },
  {
    name: 'AC3: a rejected draft changes nothing, frees the gate, and a corrected draft then runs',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project, 'Do it.');
      const draft = prepared.workflowFile;
      const original = fs.readFileSync(draft, 'utf8');
      fs.writeFileSync(draft, original.replace('id: plan', 'id: other'));
      await withFake({ [RUN_MS]: '100' }, async () => {
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
        assert.ok(!fs.existsSync(sessionFile(env, prepared.sessionId, 'workflow.frozen.yaml')), 'a rejected draft is not frozen');
        assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'prepared', 'state unchanged');
        assert.equal(gateHeld(env, project, prepared.sessionId), false, 'gate released, so retry is possible');
        fs.writeFileSync(draft, original);
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
        await waitFor('completed after the correction', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'completed');
        assert.ok(fs.existsSync(sessionFile(env, prepared.sessionId, 'workflow.frozen.yaml')), 'corrected draft is frozen');
      });
    },
  },
  {
    name: 'A failed 0.3.6 preflight changes nothing, releases the gate, and the fixed draft then runs',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project, 'Do it.');
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_PREFLIGHT: 'fail' }, async () => {
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
        assert.ok(!fs.existsSync(sessionFile(env, prepared.sessionId, 'workflow.frozen.yaml')), 'a preflight failure freezes nothing');
        assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'prepared', 'state unchanged');
        assert.equal(gateHeld(env, project, prepared.sessionId), false, 'gate released, so retry is possible');
      });
      await withFake({ [RUN_MS]: '100' }, async () => {
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
        await waitFor('completed after the preflight passed', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'completed');
      });
    },
  },
  {
    name: 'A failed 0.3.6 execution writes its failure.md report',
    async run(env) {
      const project = await createProject(env);
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_EXIT: '3' }, async () => {
        await env.api.control.runNew(project, 'plan', 'fail');
      });
      const snapshot = sessions(env).find((candidate) => candidate.manifest?.workflowId === 'plan');
      assert.ok(snapshot, 'the session exists');
      const report = path.join(sessionFile(env, snapshot.sessionId, 'executions'), '0001-plan--attempt-01', 'failure.md');
      assert.ok(fs.existsSync(report), 'failure.md was written');
      assert.match(fs.readFileSync(report, 'utf8'), /exit code: 3/);
    },
  },
  {
    name: 'AC3: an exit 2 on Continue of a started session is uncertain and keeps the gate',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project, 'Do it.');
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_EXIT: '1' }, async () => {
        await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
      });
      await waitFor('stopped', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'stopped');
      await withFake({ [RUN_MS]: '100', MIGENT_FAKE_EXIT: '2' }, async () => {
        // Not awaited: the unconfirmed result waits on a prompt that nobody answers here.
        void env.api.control.continueSession(project, snapshotOf(project, prepared.sessionId));
        await sleep(3500);
      });
      assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'stopped', 'state unchanged');
      assert.equal(gateHeld(env, project, prepared.sessionId), true, 'gate retained for an uncertain result');
    },
  },
  {
    name: 'Save & Run refuses a dirty workflow.yaml without dispatching or saving it, and runs once it is saved',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project, 'Do it.');
      const draft = prepared.workflowFile;
      const before = fs.readFileSync(draft, 'utf8');
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(draft));
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), '# unsaved\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(document.isDirty, 'draft has unsaved edits');
      const taskUri = vscode.Uri.file(prepared.taskFile);
      const calls = (): number => argvLog(env).filter((line) => line[1] === 'run').length;
      await withFake({ [RUN_MS]: '100' }, async () => {
        await vscode.commands.executeCommand('migent.session.start', taskUri);
        await sleep(1000);
        assert.equal(calls(), 0, 'no CLI run was dispatched');
        assert.equal(fs.readFileSync(draft, 'utf8'), before, 'the draft was not saved');
        assert.ok(document.isDirty, 'still dirty');
        assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'prepared');
        assert.ok(await document.save());
        await vscode.commands.executeCommand('migent.session.start', taskUri);
        await waitFor('completed after saving', () => project.store.snapshot(prepared.sessionId)?.displayState.state === 'completed');
        assert.equal(calls(), 1);
      });
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    },
  },
  {
    name: 'AC3: a rejection that is not about the draft (empty task.md) also frees the gate',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project);
      await env.api.control.runPrepared(project, snapshotOf(project, prepared.sessionId), 'plan');
      assert.equal(gateHeld(env, project, prepared.sessionId), false, 'gate released');
      assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'prepared');
    },
  },
);

/** Stub the warning and error boxes, answering warnings from `answer`; restores them afterwards. */
async function withMessages(
  answer: (message: string) => string | undefined,
  body: (shown: string[]) => Promise<void>,
): Promise<void> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const saved = { warning: window.showWarningMessage, error: window.showErrorMessage };
  const shown: string[] = [];
  window.showWarningMessage = (message: string): Promise<string | undefined> => {
    shown.push(`warning:${message}`);
    return Promise.resolve(answer(message));
  };
  window.showErrorMessage = (message: string): Promise<undefined> => {
    shown.push(`error:${message}`);
    return Promise.resolve(undefined);
  };
  try {
    await body(shown);
  } finally {
    window.showWarningMessage = saved.warning;
    window.showErrorMessage = saved.error;
  }
}

const confirmComplete = (message: string): string | undefined => (message.startsWith('Complete ') ? 'Complete' : undefined);

/** Run a long session and stop it, leaving a cancelled session that `session complete` accepts. */
async function stoppedSession(env: Env, project: ProjectContext): Promise<SessionSnapshot> {
  await withFake({ [RUN_MS]: '30000' }, async () => {
    const run = env.api.control.runNew(project, 'plan', 'long task');
    await waitFor('session running', () => stateOf(env, 'running') !== undefined);
    const running = stateOf(env, 'running');
    assert.ok(running);
    await env.api.control.cancel(project, running);
    await run;
  });
  await waitFor('session cancelled', () => stateOf(env, 'cancelled') !== undefined);
  const cancelled = stateOf(env, 'cancelled');
  assert.ok(cancelled);
  return cancelled;
}

scenarios.push(
  {
    name: 'Complete: the command confirms, completes a stopped session and releases the gate',
    async run(env) {
      const project = await createProject(env);
      const stopped = await stoppedSession(env, project);
      await withMessages(confirmComplete, async (shown) => {
        await vscode.commands.executeCommand('migent.session.complete', { project: project.key, sessionId: stopped.sessionId });
        await waitFor('session completed', () => project.store.snapshot(stopped.sessionId)?.displayState.state === 'completed');
        assert.ok(shown.some((line) => line.startsWith('warning:Complete ')), 'asked to confirm first');
      });
      assert.equal(gateHeld(env, project, stopped.sessionId), false, 'gate released');
      assert.deepEqual(argvLog(env).at(-1), ['session', 'complete', stopped.sessionId]);
    },
  },
  {
    name: 'Complete: declining the confirmation runs nothing',
    async run(env) {
      const project = await createProject(env);
      const stopped = await stoppedSession(env, project);
      await withMessages(() => undefined, async () => {
        await vscode.commands.executeCommand('migent.session.complete', { project: project.key, sessionId: stopped.sessionId });
      });
      assert.equal(argvLog(env).some((argv) => argv[1] === 'complete'), false, 'no CLI call');
      assert.equal(snapshotOf(project, stopped.sessionId).displayState.state, 'cancelled');
    },
  },
  {
    name: 'Complete: a prepared session is not offered and the CLI refusal frees the gate with an error',
    async run(env) {
      const project = await createProject(env);
      const prepared = await prepareReady(env, project);
      await withMessages(confirmComplete, async (shown) => {
        await vscode.commands.executeCommand('migent.session.complete', { project: project.key, sessionId: prepared.sessionId });
        assert.equal(argvLog(env).some((argv) => argv[1] === 'complete'), false, 'ineligible: no CLI call');
        await env.api.control.complete(project, snapshotOf(project, prepared.sessionId));
        assert.ok(shown.some((line) => line.startsWith('error:Could not complete the session')), 'refusal reported');
      });
      assert.equal(gateHeld(env, project, prepared.sessionId), false, 'gate released');
      assert.equal(snapshotOf(project, prepared.sessionId).displayState.state, 'prepared');
    },
  },
  {
    name: 'Complete: a role session is not offered',
    async run(env) {
      const project = await createProject(env);
      const stopped = await stoppedSession(env, project);
      fs.appendFileSync(sessionFile(env, stopped.sessionId, 'manifest.yaml'), 'role: planner\n');
      await waitFor('manifest shows the role', () => project.store.snapshot(stopped.sessionId)?.manifest?.role === 'planner');
      await withMessages(confirmComplete, async (shown) => {
        await vscode.commands.executeCommand('migent.session.complete', { project: project.key, sessionId: stopped.sessionId });
        assert.equal(shown.some((line) => line.startsWith('warning:Complete ')), false, 'no confirmation');
      });
      assert.equal(argvLog(env).some((argv) => argv[1] === 'complete'), false, 'no CLI call');
    },
  },
  {
    name: 'Complete: the CLI warning about a missing artifact is shown with the success',
    async run(env) {
      const project = await createProject(env);
      const stopped = await stoppedSession(env, project);
      await withFake({ MIGENT_FAKE_COMPLETE_WARN: '1' }, async () => {
        await withMessages(confirmComplete, async (shown) => {
          await env.api.control.complete(project, stopped);
          await waitFor('session completed', () => project.store.snapshot(stopped.sessionId)?.displayState.state === 'completed');
          assert.ok(
            shown.some((line) => line.startsWith('warning:Completed ') && line.includes('required artifact "plan"')),
            'warning shown',
          );
        });
      });
      assert.equal(gateHeld(env, project, stopped.sessionId), false, 'gate released');
    },
  },
);

export function runControlScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
