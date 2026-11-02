/**
 * S8 timeline document and log channel scenarios (plans/02-monitoring.md §8: AC12, and the §6.4/§6.5 tail lifecycle).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import * as vscode from 'vscode';

import { timelineUri } from '../vscode/content/sessionDocs';
import {
  createProject,
  type Env,
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
} from './harness';

const eventLine = (seq: number, event: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    v: 1,
    seq,
    event,
    timestamp: '2026-11-01T10:15:30.000+00:00',
    execution_id: '0001-plan--attempt-01',
    ...extra,
  })}\n`;

function addSession(env: Env, id: string, state: string, isRunning = false): void {
  write(migentPath(env.root, 'sessions', id, 'manifest.yaml'), manifest(id));
  write(migentPath(env.root, 'sessions', id, 'status.json'), status(state, { workflow_id: 'plan' }));
  if (isRunning) write(migentPath(env.root, 'sessions', id, 'session.lock'), freshLock());
}

async function openTimeline(env: Env, id: string): Promise<vscode.TextDocument> {
  const project = await createProject(env);
  return vscode.workspace.openTextDocument(timelineUri(project.key, id));
}

/** Close every editor and wait until the timeline tabs have released their tails. */
const closeEditors = async (env: Env): Promise<void> => {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('tails released', () => env.api.tails.activeCount === 0);
};

const scenarios: Scenario[] = [
  {
    name: 'AC12: the timeline renders events, appends live, shows unknown versions raw, and releases the tail on close',
    async run(env) {
      addSession(env, 's1', 'completed');
      const events = migentPath(env.root, 'sessions', 's1', 'events.jsonl');
      write(events, eventLine(1, 'execution.started', { summary: 'claude/sonnet' }));
      const document = await openTimeline(env, 's1');
      await vscode.window.showTextDocument(document);
      assert.match(document.getText(), /plan#1 started · claude\/sonnet/);
      assert.equal(env.api.tails.activeCount, 1);

      fs.appendFileSync(events, eventLine(2, 'execution.completed'));
      fs.appendFileSync(events, `${JSON.stringify({ v: 99, seq: 3, event: 'future' })}\n`);
      await waitFor('live append', () => /plan#1 completed/.test(document.getText()));
      assert.match(document.getText(), /\[unrecognized\] .*"future"/);

      await closeEditors(env);
      await waitFor('tail released', () => env.api.tails.activeCount === 0);
      assert.equal(env.api.sessionDocs.openCount, 0);
    },
  },
  {
    name: 'AC12: a truncated events.jsonl re-renders the timeline from the start',
    async run(env) {
      addSession(env, 's2', 'completed');
      const events = migentPath(env.root, 'sessions', 's2', 'events.jsonl');
      write(events, eventLine(1, 'execution.started') + eventLine(2, 'execution.progress') + eventLine(3, 'execution.completed'));
      const document = await openTimeline(env, 's2');
      await vscode.window.showTextDocument(document);
      assert.match(document.getText(), /completed/);
      fs.writeFileSync(events, eventLine(1, 'execution.restarted'));
      await waitFor('rewritten', () => /restarted/.test(document.getText()) && !/progress/.test(document.getText()));
      await closeEditors(env);
    },
  },
  {
    name: 'a session without events.jsonl shows an empty timeline',
    async run(env) {
      addSession(env, 's3', 'completed');
      const document = await openTimeline(env, 's3');
      await vscode.window.showTextDocument(document);
      assert.equal(document.getText(), 'No events yet.');
      await closeEditors(env);
    },
  },
  {
    name: 'showLog streams a running session, stops tailing when it stops, and keeps at most 5 channels',
    async run(env) {
      const project = await createProject(env);
      addSession(env, 'run1', 'active', true);
      const events = migentPath(env.root, 'sessions', 'run1', 'events.jsonl');
      write(events, eventLine(1, 'execution.started'));
      await waitFor('session loaded', () => project.store.snapshot('run1')?.displayState.state === 'running');
      const snapshot = project.store.snapshot('run1');
      assert.ok(snapshot);
      env.api.logs.show(project.key, snapshot);
      assert.equal(env.api.logs.tailingCount, 1);
      assert.equal(env.api.tails.activeCount, 1);

      // The session stops: a final read, then no tail.
      fs.appendFileSync(events, eventLine(2, 'execution.completed'));
      fs.rmSync(migentPath(env.root, 'sessions', 'run1', 'session.lock'));
      write(migentPath(env.root, 'sessions', 'run1', 'status.json'), status('completed', { workflow_id: 'plan' }));
      await waitFor('tail released', () => env.api.tails.activeCount === 0);
      assert.equal(env.api.logs.tailingCount, 0);
      await sleep(SETTLE_MS);

      for (let index = 0; index < 6; index += 1) {
        const id = `many${index}`;
        addSession(env, id, 'completed');
        await waitFor(`${id} loaded`, () => project.store.snapshot(id) !== undefined);
        const many = project.store.snapshot(id);
        assert.ok(many);
        env.api.logs.show(project.key, many);
      }
      assert.equal(env.api.logs.names.length, 5);
      assert.ok(!env.api.logs.names.some((name) => name.includes('run1')), 'least recently shown channel was disposed');
      assert.equal(env.api.tails.activeCount, 0, 'channels of stopped sessions hold no tail');
    },
  },
  {
    name: 'a log channel resumes following the tail when its session starts running again',
    async run(env) {
      const project = await createProject(env);
      addSession(env, 'again', 'completed');
      const events = migentPath(env.root, 'sessions', 'again', 'events.jsonl');
      write(events, eventLine(1, 'execution.started'));
      await waitFor('session loaded', () => project.store.snapshot('again') !== undefined);
      const snapshot = project.store.snapshot('again');
      assert.ok(snapshot);
      env.api.logs.show(project.key, snapshot);
      assert.equal(env.api.logs.tailingCount, 0);
      assert.equal(env.api.tails.activeCount, 0);

      addSession(env, 'again', 'active', true);
      await waitFor('following again', () => env.api.logs.tailingCount === 1);
      assert.equal(env.api.tails.activeCount, 1);

      fs.rmSync(migentPath(env.root, 'sessions', 'again', 'session.lock'));
      write(migentPath(env.root, 'sessions', 'again', 'status.json'), status('completed', { workflow_id: 'plan' }));
      await waitFor('released again', () => env.api.logs.tailingCount === 0 && env.api.tails.activeCount === 0);
    },
  },
  {
    name: 'a shared tail is caught up by poll() for a second holder',
    async run(env) {
      const project = await createProject(env);
      addSession(env, 'shared', 'completed');
      const events = migentPath(env.root, 'sessions', 'shared', 'events.jsonl');
      write(events, eventLine(1, 'execution.started'));
      const first = env.api.tails.acquire(project.key, 'shared');
      const second = env.api.tails.acquire(project.key, 'shared');
      assert.ok(first && second);
      fs.appendFileSync(events, eventLine(2, 'execution.completed'));
      second.poll();
      assert.equal(second.history.length, 2);
      assert.equal(first.history.length, 2, 'holders share one tail');
      first.dispose();
      second.dispose();
      assert.equal(env.api.tails.activeCount, 0);
    },
  },
  {
    name: 'an open timeline survives removing and recreating the project',
    async run(env) {
      addSession(env, 'again', 'completed');
      write(migentPath(env.root, 'sessions', 'again', 'events.jsonl'), eventLine(1, 'execution.started'));
      const document = await openTimeline(env, 'again');
      await vscode.window.showTextDocument(document);
      assert.match(document.getText(), /started/);

      removeMigent(env.root);
      await waitFor('project gone', () => env.project() === undefined);
      addSession(env, 'again', 'completed');
      write(
        migentPath(env.root, 'sessions', 'again', 'events.jsonl'),
        eventLine(1, 'execution.restarted') + eventLine(2, 'execution.completed'),
      );
      await createProject(env);
      await waitFor('re-rendered', () => /restarted/.test(document.getText()) && /completed/.test(document.getText()));
      assert.doesNotMatch(document.getText(), /plan#1 started/);
      await closeEditors(env);
      await waitFor('tail released', () => env.api.tails.activeCount === 0);
    },
  },
];

/** Run the S8 scenarios; returns the number of failed ones. */
export function runTimelineScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
