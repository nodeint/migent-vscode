/**
 * Phase 3a human-input scenarios (plans/03a-human-input.md §8, §10). The fixture CLI normalizes
 * `session continue --reply-file` into the question records like the real one, with failure modes chosen by
 * `MIGENT_FAKE_ANSWER`. Panels are driven through their message handler; the page script itself is not run.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import * as vscode from 'vscode';

import type { AnswerModel } from '../core/answerModel';
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
  write(migentPath(env.root, 'sessions', sessionId, 'status.json'), status('question', { questions: summary, latest_execution_id: EXECUTION }));
  write(
    migentPath(env.root, 'sessions', sessionId, 'questions.json'),
    JSON.stringify({ schema_version: seed.schemaVersion ?? 1, questions: records }),
  );
  write(migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'execution.json'), JSON.stringify({ execution_id: EXECUTION, stage_id: 'plan', status: 'completed' }));
  if (seed.twoStages === true) {
    write(migentPath(env.root, 'sessions', sessionId, 'executions', '0001-test--attempt-01', 'execution.json'), JSON.stringify({ execution_id: '0001-test--attempt-01', stage_id: 'test', status: 'completed' }));
  }
  if (seed.lock === true) write(migentPath(env.root, 'sessions', sessionId, 'session.lock'), freshLock());
  return { project: env.project()?.key ?? '', sessionId, stageId: 'plan', executionId: EXECUTION };
}

async function withAnswerMode(mode: string, body: () => Promise<void>): Promise<void> {
  const previous = process.env.MIGENT_FAKE_ANSWER;
  process.env.MIGENT_FAKE_ANSWER = mode;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env.MIGENT_FAKE_ANSWER;
    else process.env.MIGENT_FAKE_ANSWER = previous;
  }
}

/** Open the session's panel on the Questions tab, selecting the batch the identity names. */
const openBatch = (env: Env, batch: BatchIdentity): void => {
  env.api.session.open(batch, { tab: 'questions', batch: { stageId: batch.stageId, executionId: batch.executionId } });
};

/** Open the panel and return helpers bound to its exact batch. */
async function openPanel(env: Env, sessionId: string, seed: Seed = {}) {
  const project = await createProject(env);
  await waitFor('cli usable', () => env.api.capability.state(project.key).kind === 'ok');
  const base = seedSession(env, sessionId, seed);
  await waitFor('session loaded', () => (project.store.snapshot(sessionId)?.status?.questions.length ?? 0) >= 2);
  const identity: BatchIdentity = { ...base, project: project.key };
  openBatch(env, identity);
  await waitFor('panel model', () => env.api.session.lastAnswerModel(identity) !== null);
  const model = (): AnswerModel => {
    const current = env.api.session.lastAnswerModel(identity);
    assert.ok(current, 'panel has a model');
    return current;
  };
  const send = (message: unknown): Promise<void> => env.api.session.handle(identity, message);
  const edit = (questionId: string, draft: unknown): Promise<void> =>
    send({ type: 'edit', generation: model().generation, fingerprint: model().fingerprint, questionId, draft });
  const answerAll = async (): Promise<void> => {
    await edit('1', { mode: 'choice', selected: ['B'], text: '' });
    await edit('2', { mode: 'choice', selected: ['A', 'C'], text: '' });
  };
  const submit = (): Promise<void> => send({ type: 'submit', revision: model().revision, fingerprint: model().fingerprint });
  return { project, identity, model, send, edit, answerAll, submit };
}

/** The argv of every `session continue --reply-file` the fixture CLI received, in order. */
const argvLog = (env: Env): string[][] =>
  fs
    .readFileSync(`${env.root}/fake-argv.log`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);

const storedAnswers = (env: Env, sessionId: string): { id: string; status: string; answer: unknown }[] =>
  (JSON.parse(fs.readFileSync(migentPath(env.root, 'sessions', sessionId, 'questions.json'), 'utf8')) as {
    questions: { id: string; status: string; answer: unknown }[];
  }).questions;

function recoveryRecords(env: Env): string[] {
  const dir = env.api.submitter.storageDir;
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith('uncertain-') && name.endsWith('.json')) : [];
}

const scenarios: Scenario[] = [
  {
    name: 'the recovery record exists while the CLI runs, before any outcome, and is removed once the answers are recorded',
    async run(env) {
      const panel = await openPanel(env, 'q15');
      await panel.answerAll();
      process.env.MIGENT_FAKE_ANSWER_DELAY_MS = '1500';
      try {
        const sending = panel.submit();
        await waitFor('recovery record written before the CLI finishes', () => recoveryRecords(env).length === 1);
        assert.equal(panel.model().state, 'sending');
        assert.ok(env.api.control.gate.current(panel.project.key, 'q15'), 'session is held while sending');
        await sending;
      } finally {
        delete process.env.MIGENT_FAKE_ANSWER_DELAY_MS;
      }
      assert.deepEqual(recoveryRecords(env), [], 'the record is removed once the records decide the outcome');
      assert.equal(env.api.control.gate.current(panel.project.key, 'q15'), undefined);
    },
  },
  {
    name: 'a complete batch is recorded through the CLI with normalized answers and then continues the stage',
    async run(env) {
      const panel = await openPanel(env, 'q2');
      await panel.answerAll();
      assert.equal(panel.model().canSubmit, true);
      await withAnswerMode('record', async () => {
        await panel.submit();
      });
      assert.ok(['recorded', 'recorded-waiting', 'continuing'].includes(panel.model().state), panel.model().state);
      const stored = storedAnswers(env, 'q2');
      assert.deepEqual(stored.map((item) => item.status), ['answered', 'answered']);
      assert.deepEqual(stored[0]?.answer, { selected: ['B'] });
      assert.deepEqual(stored[1]?.answer, { selected: ['A', 'C'] });
      await waitFor('stage continues', () => panel.model().state === 'continuing' || panel.model().state === 'recorded');
    },
  },
  {
    name: 'free text is serialized as text, and text equal to an option letter is flagged',
    async run(env) {
      const panel = await openPanel(env, 'q3');
      await panel.edit('1', { mode: 'text', selected: [], text: 'A' });
      assert.deepEqual(panel.model().ambiguous, ['1']);
      await panel.edit('1', { mode: 'text', selected: ['B'], text: 'Keep the files,\nand explain.' });
      await panel.edit('2', { mode: 'text', selected: ['A'], text: 'Other' });
      await withAnswerMode('record', async () => {
        await panel.submit();
      });
      const stored = storedAnswers(env, 'q3');
      assert.deepEqual(stored[0]?.answer, { selected: [], text: 'Keep the files,\nand explain.' });
    },
  },
  {
    name: 'a rejected reply keeps the form and draft and allows an explicit retry',
    async run(env) {
      const panel = await openPanel(env, 'q4');
      await panel.answerAll();
      await withAnswerMode('reject', async () => {
        await panel.submit();
      });
      assert.equal(panel.model().state, 'rejected');
      assert.equal(panel.model().canSubmit, true, 'retry is possible');
      assert.deepEqual(panel.model().draft['1']?.selected, ['B']);
      await withAnswerMode('record', async () => {
        await panel.submit();
      });
      assert.ok(['recorded', 'recorded-waiting', 'continuing'].includes(panel.model().state));
    },
  },
  {
    name: 'an unconfirmed submission survives closing the panel and blocks a blind retry until Recheck',
    async run(env) {
      const panel = await openPanel(env, 'q5');
      await panel.answerAll();
      await withAnswerMode('garble', async () => {
        await panel.submit();
      });
      assert.equal(panel.model().state, 'unconfirmed');
      assert.ok(env.api.control.gate.current(panel.project.key, 'q5'), 'gate stays held');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitFor('panel closed', () => !env.api.session.has(panel.identity));
      openBatch(env, panel.identity);
      await waitFor('reopened panel', () => env.api.session.lastAnswerModel(panel.identity) !== null);
      assert.equal(panel.model().state, 'unconfirmed', 'restored from the persisted record');
      assert.equal(panel.model().canSubmit, false, 'no blind resend');
      // Repair the file the way a finished CLI would, then Recheck resolves it.
      write(
        migentPath(env.root, 'sessions', 'q5', 'questions.json'),
        JSON.stringify({
          schema_version: 1,
          questions: [
            { ...record('1', 'single', {}), status: 'answered', answer: { selected: ['B'] } },
            { ...record('2', 'multiple', {}), status: 'answered', answer: { selected: ['A', 'C'] } },
          ],
        }),
      );
      await panel.send({ type: 'recheck' });
      assert.ok(['recorded', 'recorded-waiting', 'continuing'].includes(panel.model().state), panel.model().state);
      assert.equal(env.api.control.gate.current(panel.project.key, 'q5'), undefined, 'gate released');
    },
  },
  {
    name: 'changed questions mark the draft stale and Load current questions archives the old draft',
    async run(env) {
      const panel = await openPanel(env, 'q6');
      await panel.answerAll();
      const changed = { ...record('1', 'single', {}), question: 'A different question?' };
      const rest = record('2', 'multiple', {});
      const summary1 = summaryOf(changed);
      const summary2 = summaryOf(rest);
      write(migentPath(env.root, 'sessions', 'q6', 'status.json'), status('question', { questions: [summary1, summary2] }));
      write(migentPath(env.root, 'sessions', 'q6', 'questions.json'), JSON.stringify({ schema_version: 1, questions: [changed, rest] }));
      await waitFor('stale', () => panel.model().state === 'stale');
      assert.equal(panel.model().canSubmit, false);
      await panel.send({ type: 'reload' });
      assert.equal(panel.model().state, 'editing');
      assert.equal(panel.model().answered, 0, 'answers are not carried to the new batch');
      assert.ok(panel.model().archived?.some((item) => item.answer.includes('Replace')), 'old draft kept as reference');
    },
  },
  {
    name: 'an edit from before a discard or reload is dropped by generation',
    async run(env) {
      const panel = await openPanel(env, 'q7');
      const {generation} = panel.model();
      await panel.send({ type: 'edit', generation, fingerprint: panel.model().fingerprint, questionId: '1', draft: { mode: 'choice', selected: ['A'], text: '' } });
      assert.deepEqual(panel.model().draft['1']?.selected, ['A']);
      await panel.send({ type: 'edit', generation: generation + 5, fingerprint: panel.model().fingerprint, questionId: '1', draft: { mode: 'choice', selected: ['C'], text: '' } });
      assert.deepEqual(panel.model().draft['1']?.selected, ['A'], 'a mismatched generation is ignored');
      await panel.send({ type: 'edit', generation, fingerprint: 'other', questionId: '1', draft: { mode: 'choice', selected: ['C'], text: '' } });
      assert.deepEqual(panel.model().draft['1']?.selected, ['A'], 'another batch fingerprint is ignored');
    },
  },
  {
    name: 'a live lock, a non-human recipient and an unsupported question file each block Send but not drafting',
    async run(env) {
      const locked = await openPanel(env, 'q8', { lock: true });
      await locked.answerAll();
      assert.equal(locked.model().canSubmit, false);
      assert.match(locked.model().blockReason ?? '', /running/i);
      assert.equal(locked.model().answered, 2, 'drafting works while the runner holds the lock');
      await locked.send({ type: 'later' });
      const agent = seedSession(env, 'q9', { recipient: 'agent' });
      const project = env.project();
      assert.ok(project);
      await waitFor('agent session', () => project.store.snapshot('q9') !== undefined);
      openBatch(env, { ...agent, project: project.key });
      await waitFor('agent panel', () => env.api.session.lastAnswerModel({ ...agent, project: project.key }) !== null);
      assert.match(env.api.session.lastAnswerModel({ ...agent, project: project.key })?.blockReason ?? '', /person/);
      const future = seedSession(env, 'q10', { schemaVersion: 9 });
      await waitFor('future session', () => project.store.snapshot('q10') !== undefined);
      openBatch(env, { ...future, project: project.key });
      await waitFor('future panel', () => env.api.session.lastAnswerModel({ ...future, project: project.key }) !== null);
      assert.match(env.api.session.lastAnswerModel({ ...future, project: project.key })?.blockReason ?? '', /schema/);
    },
  },
  {
    name: 'a standalone role session is answered without a stage argument',
    async run(env) {
      const panel = await openPanel(env, 'q11', { role: true });
      await panel.answerAll();
      await withAnswerMode('record', async () => {
        await panel.submit();
      });
      assert.deepEqual(storedAnswers(env, 'q11').map((item) => item.status), ['answered', 'answered']);
      const argv = argvLog(env).at(-1) ?? [];
      assert.ok(argv.includes('--reply-file'), 'the reply file is passed');
      assert.ok(!argv.includes('--stage'), `a role session passes no --stage: ${argv.join(' ')}`);
    },
  },
  {
    name: 'two waiting stages that both use question 1: answering one sends --stage and leaves the other pending',
    async run(env) {
      const panel = await openPanel(env, 'q14', { twoStages: true });
      await panel.answerAll();
      await withAnswerMode('record', async () => {
        await panel.submit();
      });
      const argv = argvLog(env).at(-1) ?? [];
      assert.deepEqual(argv.slice(argv.indexOf('--stage'), argv.indexOf('--stage') + 2), ['--stage', 'plan']);
      const records = JSON.parse(fs.readFileSync(migentPath(env.root, 'sessions', 'q14', 'questions.json'), 'utf8')) as {
        questions: { stage_id: string; status: string }[];
      };
      assert.deepEqual(records.questions.filter((item) => item.stage_id === 'plan').map((item) => item.status), ['answered', 'answered']);
      assert.deepEqual(records.questions.filter((item) => item.stage_id === 'test').map((item) => item.status), ['pending', 'pending']);
      // The other stage's own batch is untouched and still answerable.
      const other: BatchIdentity = { ...panel.identity, stageId: 'test', executionId: '0001-test--attempt-01' };
      // The session has one panel, so the other batch is selected in place rather than opened separately.
      openBatch(env, other);
      await waitFor('other stage batch selected', () => {
        const page = env.api.session.lastModel(other);
        return page?.tab === 'questions' && page.questions.selected?.executionId === other.executionId;
      });
      assert.equal(env.api.session.count, 1, 'the batch switched inside the same panel');
      assert.equal(env.api.session.lastAnswerModel(other)?.editable, true);
      assert.equal(env.api.session.lastAnswerModel(other)?.answered, 0, 'no answers leaked across stages');
    },
  },
  {
    name: 'exit 1 after recording keeps the answers and offers Continue without resubmitting',
    async run(env) {
      const panel = await openPanel(env, 'q12');
      await panel.answerAll();
      await withAnswerMode('fail-after-record', async () => {
        await panel.submit();
      });
      await waitFor('recorded-waiting', () => panel.model().state === 'recorded-waiting');
      assert.equal(panel.model().canSubmit, false, 'recorded answers are never resubmitted');
      assert.equal(panel.model().editable, false);
    },
  },
  {
    name: 'exit 9 after answering preserves the old answers and opens the follow-up batch as a new one',
    async run(env) {
      const panel = await openPanel(env, 'q13');
      await panel.answerAll();
      await withAnswerMode('followup', async () => {
        await panel.submit();
      });
      assert.ok(['recorded', 'recorded-waiting', 'continuing'].includes(panel.model().state), panel.model().state);
      const stored = storedAnswers(env, 'q13');
      assert.equal(stored.filter((item) => item.status === 'answered').length, 2);
      assert.equal(stored.filter((item) => item.status === 'pending').length, 2, 'a new pending batch exists');
    },
  },
];

export function runQuestionScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
