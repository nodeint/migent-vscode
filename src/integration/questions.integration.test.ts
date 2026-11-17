/**
 * Human-input scenarios for the contract 0.8.0 readers. The contract's `status.json` declares no questions, so the
 * extension has no source of pending questions (B6): these scenarios assert that empty-source behavior. The answer
 * flow itself (drafts, stale checks, submission) is covered by the unit tests, which supply pending questions through
 * the `pendingQuestions` seam.
 */
import assert from 'node:assert/strict';

import type { BatchIdentity } from '../vscode/questions/entry';
import { createProject, type Env, freshLock, manifest, migentPath, runScenarios, type Scenario, status, waitFor, write } from './harness';

const EXECUTION = '0001-plan--attempt-01';
const OPTIONS = [
  { id: 'A', label: 'Keep', description: null },
  { id: 'B', label: 'Replace', description: null },
  { id: 'C', label: 'Both', description: null },
];

interface Seed {
  recipient?: string;
  schemaVersion?: number;
  role?: boolean;
  lock?: boolean;
  /** A second stage waiting at the same time, also using question numbers 1 and 2. */
  twoStages?: boolean;
  /** Migent 0.8.0 layout: `executions/<id>/questions.json` per batch and no session `questions.json`. */
  perExecution?: boolean;
}

function record(id: string, selection: string, seed: Seed, stage = 'plan'): Record<string, unknown> {
  return {
    id,
    question: `Question ${id}?`,
    context: 'Some context',
    selection,
    options: OPTIONS,
    recommended: ['A'],
    execution_id: `0001-${stage}--attempt-01`,
    stage_id: stage,
    recipient: seed.recipient ?? 'human',
    status: 'pending',
    answer: null,
  };
}

/** The `status.json` form of a record: no status or answer. */
const summaryOf = (item: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'status' && key !== 'answer'));

function seedSession(env: Env, sessionId: string, seed: Seed = {}): BatchIdentity {
  const records = [record('1', 'single', seed), record('2', 'multiple', seed)];
  if (seed.twoStages === true) records.push(record('1', 'single', seed, 'test'), record('2', 'multiple', seed, 'test'));
  const summary = records.map(({ status: _status, answer: _answer, ...rest }) =>
    seed.perExecution === true ? { ...rest, file: `executions/${String(rest.execution_id)}/questions.json` } : rest,
  );
  write(migentPath(env.root, 'sessions', sessionId, 'manifest.yaml'), manifest(sessionId, `workflow_id: plan\n${seed.role === true ? 'role: planner\n' : ''}`));
  write(migentPath(env.root, 'sessions', sessionId, 'status.json'), status('question', { questions: summary, latest_execution_id: EXECUTION }));
  if (seed.perExecution === true) {
    for (const stage of new Set(records.map((item) => String(item.stage_id)))) {
      const own = records.filter((item) => item.stage_id === stage);
      write(
        migentPath(env.root, 'sessions', sessionId, 'executions', `0001-${stage}--attempt-01`, 'questions.json'),
        JSON.stringify({
          schema_version: 1,
          stage_id: stage,
          execution_id: `0001-${stage}--attempt-01`,
          recipient: seed.recipient ?? 'human',
          questions: own
            .map((item) => summaryOf(item))
            .map(({ execution_id: _e, stage_id: _s, recipient: _r, ...rest }) => rest),
        }),
      );
    }
  } else {
    write(
      migentPath(env.root, 'sessions', sessionId, 'questions.json'),
      JSON.stringify({ schema_version: seed.schemaVersion ?? 1, questions: records }),
    );
  }
  write(migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'execution.json'), JSON.stringify({ execution_id: EXECUTION, stage_id: 'plan', status: 'completed' }));
  if (seed.twoStages === true) {
    write(migentPath(env.root, 'sessions', sessionId, 'executions', '0001-test--attempt-01', 'execution.json'), JSON.stringify({ execution_id: '0001-test--attempt-01', stage_id: 'test', status: 'completed' }));
  }
  if (seed.lock === true) write(migentPath(env.root, 'sessions', sessionId, 'session.lock'), freshLock());
  return { project: env.project()?.key ?? '', sessionId, stageId: 'plan', executionId: EXECUTION };
}

const scenarios: Scenario[] = [
  {
    name: 'a status file that lists questions yields no pending batch (B6)',
    async run(env) {
      const project = await createProject(env);
      await waitFor('cli usable', () => env.api.capability.state(project.key).kind === 'ok');
      const base = seedSession(env, 'q1');
      await waitFor('session loaded', () => project.store.snapshot('q1')?.status?.status === 'question');
      const snapshot = project.store.snapshot('q1');
      assert.ok(snapshot?.status, 'status read');
      assert.equal('questions' in snapshot.status, false, 'questions are not read from the status');
      const identity: BatchIdentity = { ...base, project: project.key };
      env.api.session.open(identity, { tab: 'questions' });
      await waitFor('questions tab model', () => env.api.session.lastModel(identity) !== null);
      const page = env.api.session.lastModel(identity);
      assert.equal(page?.tab, 'questions');
      assert.equal(page.questions.attempts.some((attempt) => attempt.status === 'pending'), false, 'no attempt is pending');
    },
  },
  {
    name: 'a session whose status is question still displays as Question and has no reply targets (B6)',
    async run(env) {
      const project = await createProject(env);
      await waitFor('cli usable', () => env.api.capability.state(project.key).kind === 'ok');
      seedSession(env, 'q2');
      await waitFor('session loaded', () => project.store.snapshot('q2') !== undefined);
      assert.equal(project.store.snapshot('q2')?.displayState.state, 'question');
      assert.deepEqual(project.store.snapshot('q2')?.replyTargets, []);
    },
  },
];

export function runQuestionScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
