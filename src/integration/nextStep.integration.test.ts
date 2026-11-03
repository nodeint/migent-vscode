/**
 * Phase 3b downstream handoff scenarios (plans/03b-downstream-handoff.md §11). The fixture CLI writes the
 * session files and logs its argv, so these drive the Next step host through the real runner, gate, watcher and
 * store. The page script is not run: the host's last posted model and its message handler are.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { createProject, type Env, migentPath, repoRoot, runScenarios, type Scenario, waitFor, write } from './harness';

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

const scenarios: Scenario[] = [
  {
    name: 'S3b: Run creates one child with --prior, no --task for the default, and the source stays Completed',
    async run(env) {
      const identity = await sourceProject(env);
      env.api.nextStep.open(identity);
      await waitFor('model posted', () => env.api.nextStep.lastModel(identity) !== null);
      const model = env.api.nextStep.lastModel(identity);
      assert.equal(model?.launchBlock, null);
      assert.equal(model.task, 'Acknowledge the note.');
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
      await waitFor('child listed on the page', () => env.api.nextStep.lastModel(identity)?.children.length === 1);
    },
  },
  {
    name: 'S3b: Prepare records the prior, writes the chosen task to task.md and does not run; hostile intents are ignored',
    async run(env) {
      const identity = await sourceProject(env);
      env.api.nextStep.open(identity);
      await waitFor('model posted', () => env.api.nextStep.lastModel(identity) !== null);
      await env.api.nextStep.handle(identity, { type: 'intent', intent: 'exec', command: 'rm -rf /' });
      await env.api.nextStep.handle(identity, { type: 'intent', intent: 'prepare', task: '   ' });
      assert.ok(!fs.existsSync(path.join(env.root, 'fake-argv.log')), 'no CLI call for a hostile or whitespace-only request');
      await env.api.nextStep.handle(identity, { type: 'intent', intent: 'prepare', task: 'My "own" task — ok' });
      await waitFor('prepared child observed', () => childrenOfSource(env).length === 1);
      const [childId] = childrenOfSource(env);
      assert.ok(childId);
      const snapshot = env.project()?.store.snapshot(childId);
      assert.equal(snapshot?.displayState.state, 'prepared');
      assert.equal(fs.readFileSync(migentPath(env.root, 'sessions', childId, 'task.md'), 'utf8'), 'My "own" task — ok');
      const prepare = argvLog(env).find((argv) => argv[1] === 'prepare');
      assert.deepEqual(prepare?.slice(-2), ['--prior', SOURCE]);
    },
  },
];

/** Run the phase 3b scenarios; returns the number of failed ones. */
export function runNextStepScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
