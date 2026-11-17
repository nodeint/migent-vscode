/**
 * Human-input scenarios for the contract 0.8.0 readers. The contract's `status.json` declares no questions (B6), so
 * a batch is waiting only on file evidence: an execution's own `questions.json` whose execution ended by asking
 * (`outcome.status: question`) with no answer and no later attempt of its stage. The scenarios assert that a status
 * file alone yields no pending batch, and drive selection and submission of a per-execution waiting batch. The rest
 * of the answer flow (stale checks, drafts) is covered by the unit tests.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import type { AnswerModel } from '../core/answerModel';
import type { BatchIdentity } from '../vscode/questions/entry';
import { createProject, type Env, executionRecord, freshLock, manifest, migentPath, runScenarios, type Scenario, status, waitFor, write } from './harness';

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
  /** Only `status.json` lists the questions: no question file is written. */
  statusOnly?: boolean;
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
  const summary = records.map(({ status: _status, answer: _answer, ...rest }) => rest);
  write(migentPath(env.root, 'sessions', sessionId, 'manifest.yaml'), manifest(sessionId, `workflow_id: plan\n${seed.role === true ? 'role: planner\n' : ''}`));
  write(migentPath(env.root, 'sessions', sessionId, 'status.json'), status('question', { ...(seed.perExecution === true ? {} : { questions: summary }), latest_execution_id: EXECUTION }));
  if (seed.statusOnly === true) {
    // No question file: status.json is the only place the questions appear.
  } else if (seed.perExecution === true) {
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
  const asked = seed.perExecution === true ? { outcome: { status: 'question' } } : {};
  write(migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'execution.json'), executionRecord(EXECUTION, 'plan', { status: 'completed', ...asked }));
  if (seed.twoStages === true) {
    write(migentPath(env.root, 'sessions', sessionId, 'executions', '0001-test--attempt-01', 'execution.json'), executionRecord('0001-test--attempt-01', 'test', { status: 'completed', ...asked }));
  }
  if (seed.lock === true) write(migentPath(env.root, 'sessions', sessionId, 'session.lock'), freshLock());
  return { project: env.project()?.key ?? '', sessionId, stageId: 'plan', executionId: EXECUTION };
}

/** Open the Questions tab on the seeded per-execution batch and return helpers bound to its exact batch. */
async function openPanel(env: Env, sessionId: string) {
  const project = await createProject(env);
  await waitFor('cli usable', () => env.api.capability.state(project.key).kind === 'ok');
  const base = seedSession(env, sessionId, { perExecution: true });
  await waitFor('session loaded', () => project.store.snapshot(sessionId)?.status?.status === 'question');
  const identity: BatchIdentity = { ...base, project: project.key };
  env.api.session.open(identity, { tab: 'questions' });
  await waitFor('panel model', () => env.api.session.lastAnswerModel(identity) !== null);
  const model = (): AnswerModel => {
    const current = env.api.session.lastAnswerModel(identity);
    assert.ok(current, 'panel has a model');
    return current;
  };
  const send = (message: unknown): Promise<void> => env.api.session.handle(identity, message);
  const edit = (questionId: string, draft: unknown): Promise<void> =>
    send({ type: 'edit', generation: model().generation, fingerprint: model().fingerprint, questionId, draft });
  return { identity, model, send, edit };
}

const argvLog = (env: Env): string[][] =>
  fs
    .readFileSync(`${env.root}/fake-argv.log`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);

const scenarios: Scenario[] = [
  {
    name: 'a status file that lists questions yields no pending batch (B6)',
    async run(env) {
      const project = await createProject(env);
      await waitFor('cli usable', () => env.api.capability.state(project.key).kind === 'ok');
      const base = seedSession(env, 'q1', { statusOnly: true });
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
    name: 'an execution that ended by asking is a waiting attempt: options are selectable and Send becomes available',
    async run(env) {
      const panel = await openPanel(env, 'q3');
      const page = env.api.session.lastModel(panel.identity);
      assert.equal(page?.tab, 'questions');
      assert.deepEqual(page.questions.attempts.map((attempt) => attempt.status), ['pending']);
      assert.equal(panel.model().state, 'editing');
      assert.equal(panel.model().questions.length, 2);
      assert.equal(panel.model().canSubmit, false, 'nothing answered yet');
      await panel.edit('1', { mode: 'choice', selected: ['B'], text: '' });
      assert.deepEqual(panel.model().draft['1']?.selected, ['B'], 'an option can be selected');
      assert.equal(panel.model().canSubmit, false, 'one question is still open');
      await panel.edit('2', { mode: 'choice', selected: ['A', 'C'], text: '' });
      assert.equal(panel.model().canSubmit, true, 'a complete draft can be sent');
    },
  },
  {
    name: 'a waiting attempt is answered through the CLI, then stops waiting',
    async run(env) {
      const panel = await openPanel(env, 'q4');
      await panel.edit('1', { mode: 'choice', selected: ['B'], text: '' });
      await panel.edit('2', { mode: 'choice', selected: ['A', 'C'], text: '' });
      await panel.send({ type: 'submit', revision: panel.model().revision, fingerprint: panel.model().fingerprint });
      assert.ok(['recorded', 'recorded-waiting', 'continuing'].includes(panel.model().state), panel.model().state);
      assert.equal(argvLog(env).filter((argv) => argv.includes('--reply-file')).length, 1, 'sent once');
      const page = env.api.session.lastModel(panel.identity);
      assert.equal(page?.tab, 'questions');
      assert.deepEqual(page.questions.attempts.map((attempt) => attempt.status), ['answered']);
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
