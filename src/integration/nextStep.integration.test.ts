/**
 * Phase 3b downstream handoff scenarios (plans/03b-downstream-handoff.md §11). The fixture CLI writes the
 * session files and logs its argv, so these drive the Next step flow through the real runner, gate, watcher and
 * store. The pickers are not driven: the flow's launch step is.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { TaskInput } from '../vscode/launchPrompts';
import type { NextStepUi } from '../vscode/nextStep/flow';
import { createProject, type Env, migentPath, repoRoot, runScenarios, type Scenario, sleep, waitFor, write } from './harness';

const SOURCE = '00000000-0000-4000-8000-0000000000b1';
const RUN_MS = 'MIGENT_FAKE_RUN_MS';

async function sourceProject(env: Env): Promise<{ project: string; sessionId: string; workflow: string }> {
  const { root } = env;
  fs.mkdirSync(migentPath(root, 'sessions'), { recursive: true });
  fs.cpSync(
    path.join(repoRoot(), 'src', 'core', 'fixtures', 'captured', 'handoff-source'),
    migentPath(root, 'sessions', SOURCE),
    { recursive: true },
  );
  // Earlier suites share this workspace and its argv log.
  fs.rmSync(path.join(root, 'fake-argv.log'), { force: true });
  write(migentPath(root, 'sessions', SOURCE, 'outputs', 'note.md'), 'a note\n');
  write(migentPath(root, 'workflows', 'probe-target.yaml'), 'id: probe-target\nstages: []\n');
  const project = await createProject(env);
  await waitFor('source and workflow loaded', () => {
    return project.store.snapshot(SOURCE) !== undefined && project.catalog.workflows().entries.length === 1;
  });
  return { project: project.key, sessionId: SOURCE, workflow: 'probe-target' };
}

const argvLog = (env: Env): string[][] =>
  fs
    .readFileSync(path.join(env.root, 'fake-argv.log'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);

const childrenOfSource = (env: Env): string[] =>
  (env.project()?.store.all() ?? [])
    .filter((snapshot) => snapshot.manifest?.priorSessionId === SOURCE)
    .map((snapshot) => snapshot.sessionId);

interface Shown {
  value?: string;
  labels: string[];
}

/** Answer the flow's prompts from a script; records each prompt shown. */
function scriptedUi(
  answers: { action: string; task?: TaskInput; title?: string },
  shown: Shown = { labels: [] },
): NextStepUi {
  return {
    pick: (items) => {
      shown.labels = items.map((item) => item.label);
      return Promise.resolve(items.find((item) => item.label.includes(answers.action)));
    },
    askTask: (_title, value) => {
      shown.value = value;
      return Promise.resolve(answers.task);
    },
    askTitle: (_title, value) => {
      shown.value = value;
      return Promise.resolve(answers.title);
    },
  };
}

const PROMPT_MS = 700;

/** Press a key command on the real prompt that is showing, after it had time to open. */
async function key(command: string): Promise<void> {
  await sleep(PROMPT_MS);
  await vscode.commands.executeCommand(command);
}

const scenarios: Scenario[] = [
  {
    name: 'S3b: the real input box and quick pick cancel, prefill, and dispatch Prepare',
    async run(env) {
      const identity = await sourceProject(env);
      const open = (): Thenable<unknown> => vscode.commands.executeCommand('migent.session.openNextStep', identity);
      // Escape on the action list ends the flow without a CLI call.
      const cancelled = open();
      await key('workbench.action.closeQuickOpen');
      await cancelled;
      assert.ok(!fs.existsSync(path.join(env.root, 'fake-argv.log')), 'Escape on the actions calls no CLI');
      // Run now (first item) opens the task box; Escape there calls no CLI either.
      const second = open();
      await key('workbench.action.acceptSelectedQuickOpenItem');
      await key('workbench.action.closeQuickOpen');
      await second;
      assert.ok(!fs.existsSync(path.join(env.root, 'fake-argv.log')), 'Escape on the task calls no CLI');
      // Prepare (second item), accept the prefilled title: one prepare, with the suggested task.
      const third = open();
      await key('workbench.action.quickOpenSelectNext');
      await key('workbench.action.acceptSelectedQuickOpenItem');
      await key('workbench.action.acceptSelectedQuickOpenItem');
      await third;
      await waitFor('prepared child observed', () => childrenOfSource(env).length === 1);
      const [childId] = childrenOfSource(env);
      assert.ok(childId);
      assert.equal(
        fs.readFileSync(migentPath(env.root, 'sessions', childId, 'task.md'), 'utf8'),
        'Acknowledge the note.',
      );
      assert.equal(argvLog(env).filter((argv) => argv[1] === 'prepare').length, 1);
    },
  },
  {
    name: 'S3b: the pickers cancel without a CLI call, remember an edited task and compose it into a prepared session',
    async run(env) {
      const identity = await sourceProject(env);
      const flow = env.api.nextStep;
      const shown: Shown = { labels: [] };
      flow.ui = scriptedUi({ action: 'Run now' }, shown);
      await flow.start(identity);
      assert.equal(shown.value, 'Acknowledge the note.');
      assert.ok(!fs.existsSync(path.join(env.root, 'fake-argv.log')), 'cancelling the task calls no CLI');
      flow.ui = scriptedUi({ action: 'Run now', task: { kind: 'compose', text: 'Edited task' } }, shown);
      await flow.start(identity);
      assert.deepEqual(shown.labels.map((label) => label.replace(/^\$\([^)]+\) /, '')), [
        'Run now',
        'Prepare',
      ]);
      await waitFor('prepared child observed', () => childrenOfSource(env).length === 1);
      const [childId] = childrenOfSource(env);
      assert.ok(childId);
      assert.equal(fs.readFileSync(migentPath(env.root, 'sessions', childId, 'task.md'), 'utf8'), 'Edited task');
      assert.equal(flow.rememberedTask(identity), 'Edited task');
      // Reopening restores the edited task and offers the prepared child instead of only creating another.
      flow.ui = scriptedUi({ action: 'Run now' }, shown);
      await flow.start(identity);
      assert.equal(shown.value, 'Edited task');
      flow.ui = scriptedUi({ action: 'Open existing session' }, shown);
      await flow.start(identity);
      assert.equal(shown.labels[0]?.replace(/^\$\([^)]+\) /, ''), 'Open existing session');
      assert.equal(childrenOfSource(env).length, 1, 'opening the existing session created none');
      assert.equal(argvLog(env).filter((argv) => argv[1] === 'prepare').length, 1);
    },
  },
  {
    name: 'S3b: Run creates one child with --prior, no --task for the default, and the source stays Completed',
    async run(env) {
      const identity = await sourceProject(env);
      const previous = process.env[RUN_MS];
      process.env[RUN_MS] = '800';
      try {
        // Two entry points press Run in the same instant: the shared launch key lets one through.
        await Promise.all([env.api.nextStep.launch(identity, 'run'), env.api.nextStep.launch(identity, 'run')]);
      } finally {
        if (previous === undefined) delete process.env[RUN_MS];
        else process.env[RUN_MS] = previous;
      }
      await waitFor('child observed', () => childrenOfSource(env).length > 0);
      assert.equal(childrenOfSource(env).length, 1, 'repeated Run created one session');
      const run = argvLog(env).filter((argv) => argv[1] === 'run');
      assert.equal(run.length, 1);
      assert.deepEqual(run[0]?.slice(0, 6), ['session', 'run', '--workflow', 'probe-target', '--prior', SOURCE]);
      assert.ok(!run[0]?.includes('--task'), 'the canonical default is not sent as an override');
      assert.equal(env.project()?.store.snapshot(SOURCE)?.displayState.state, 'completed');
    },
  },
  {
    name: 'S3b: Prepare records the prior, writes the chosen task to task.md and does not run; a blank Run task is refused',
    async run(env) {
      const identity = await sourceProject(env);
      await env.api.nextStep.launch(identity, 'run', { task: '   ' });
      assert.ok(!fs.existsSync(path.join(env.root, 'fake-argv.log')), 'no CLI call for a whitespace-only Run task');
      await env.api.nextStep.launch(identity, 'prepare', { task: 'My "own" task — ok', title: 'Chosen title' });
      await waitFor('prepared child observed', () => childrenOfSource(env).length === 1);
      const [childId] = childrenOfSource(env);
      assert.ok(childId);
      const snapshot = env.project()?.store.snapshot(childId);
      assert.equal(snapshot?.displayState.state, 'prepared');
      assert.equal(fs.readFileSync(migentPath(env.root, 'sessions', childId, 'task.md'), 'utf8'), 'My "own" task — ok');
      const prepare = argvLog(env).find((argv) => argv[1] === 'prepare');
      assert.deepEqual(prepare?.slice(-2), ['--prior', SOURCE]);
      assert.ok(prepare?.includes('Chosen title'), 'Prepare uses the title the user entered');
    },
  },
];

/** Run the phase 3b scenarios; returns the number of failed ones. */
export function runNextStepScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
