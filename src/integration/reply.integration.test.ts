/**
 * Phase 3c Reply scenarios (plans/03c-reply-notifications.md §6). The fixture CLI turns `session continue --stage
 * --reply-file` for an ordinary blocker into the stage's next attempt (`MIGENT_FAKE_REPLY` selects consume, ignore
 * or reject). `ReplyService` is driven directly; the editor and notifications are not clicked.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { groupOf, summarize } from '../core/attention';
import type { SessionSnapshot } from '../core/model';
import { blockedTargets } from '../core/replyFlow';
import { ReplyService } from '../vscode/reply';
import { createProject, type Env, manifest, migentPath, runScenarios, type Scenario, status, waitFor, write } from './harness';

const EXECUTION = '0001-plan--attempt-01';
const ROLE_EXECUTION = '0001-reviewer--attempt-01';

function seedBlocked(env: Env, sessionId: string): void {
  write(migentPath(env.root, 'sessions', sessionId, 'manifest.yaml'), manifest(sessionId, 'workflow_id: plan\n'));
  write(
    migentPath(env.root, 'sessions', sessionId, 'status.json'),
    status('blocked', { latest_execution_id: EXECUTION, blocked_by_execution_ids: [EXECUTION] }),
  );
  write(
    migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'execution.json'),
    JSON.stringify({ execution_id: EXECUTION, stage_id: 'plan', status: 'blocked', outcome: { blocker: 'needs a decision' } }),
  );
  write(migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'response.md'), 'Which database?');
  // The baseline the CLI keeps for the blocked execution; without readable history nothing is confirmed.
  const history = [{ role: 'user', content: 'Read the task.' }];
  write(migentPath(env.root, 'sessions', sessionId, 'executions', EXECUTION, 'conversation.json'), JSON.stringify({ history }));
}

type Seed = 'cancelled' | 'role-stopped' | 'role-completed' | 'role-cancelled';

const SESSION_STATUS: Record<Seed, string> = {
  cancelled: 'cancelled',
  'role-stopped': 'active',
  'role-completed': 'completed',
  'role-cancelled': 'cancelled',
};

/** A session the CLI 0.5.2 takes a reply for beyond an ordinary blocker: an interrupted stage or a role session. */
function seedOther(env: Env, sessionId: string, kind: Seed): string {
  const isRole = kind !== 'cancelled';
  const executionId = isRole ? ROLE_EXECUTION : EXECUTION;
  const stage = isRole ? 'reviewer' : 'plan';
  const executionStatus = kind === 'role-cancelled' || kind === 'cancelled' ? 'cancelled' : 'completed';
  write(migentPath(env.root, 'sessions', sessionId, 'manifest.yaml'), manifest(sessionId, isRole ? 'role: reviewer\n' : 'workflow_id: plan\n'));
  write(migentPath(env.root, 'sessions', sessionId, 'status.json'), status(SESSION_STATUS[kind], { latest_execution_id: executionId }));
  const dir = ['sessions', sessionId, 'executions', executionId] as const;
  write(migentPath(env.root, ...dir, 'execution.json'), JSON.stringify({ execution_id: executionId, stage_id: stage, status: executionStatus }));
  write(migentPath(env.root, ...dir, 'response.md'), 'Working on it.');
  write(migentPath(env.root, ...dir, 'conversation.json'), JSON.stringify({ history: [{ role: 'user', content: 'Read the task.' }] }));
  return executionId;
}

async function openOther(env: Env, sessionId: string, kind: Seed): Promise<{ file: string; meta: NonNullable<ReturnType<ReplyService['identityOf']>> }> {
  fs.rmSync(path.join(env.root, 'fake-argv.log'), { force: true });
  const project = await createProject(env);
  const executionId = seedOther(env, sessionId, kind);
  await waitFor('reply targets', () => (project.store.snapshot(sessionId)?.replyTargets.length ?? 0) > 0);
  const snapshot = project.store.snapshot(sessionId);
  assert.ok(snapshot);
  const [target] = snapshot.replyTargets;
  assert.equal(target.executionId, executionId);
  await env.api.replies.open({ context: project, snapshot, target });
  const file = env.api.replies.draftPath({ project: project.key, sessionId, executionId });
  const meta = env.api.replies.identityOf(vscode.Uri.file(file));
  assert.ok(meta, 'the draft names its execution');
  return { file, meta };
}

async function withReplyMode(mode: string, body: () => Promise<void>): Promise<void> {
  const previous = process.env.MIGENT_FAKE_REPLY;
  process.env.MIGENT_FAKE_REPLY = mode;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env.MIGENT_FAKE_REPLY;
    else process.env.MIGENT_FAKE_REPLY = previous;
  }
}

async function openDraft(env: Env, sessionId: string): Promise<{ file: string; meta: NonNullable<ReturnType<ReplyService['identityOf']>> }> {
  fs.rmSync(path.join(env.root, 'fake-argv.log'), { force: true });
  const project = await createProject(env);
  seedBlocked(env, sessionId);
  await waitFor('blocked session', () => project.store.snapshot(sessionId)?.displayState.state === 'blocked');
  const snapshot = project.store.snapshot(sessionId);
  assert.ok(snapshot);
  const [target] = blockedTargets(snapshot);
  await env.api.replies.open({ context: project, snapshot, target });
  const file = env.api.replies.draftPath({ project: project.key, sessionId, executionId: EXECUTION });
  const meta = env.api.replies.identityOf(vscode.Uri.file(file));
  assert.ok(meta, 'the draft names its blocked execution');
  return { file, meta };
}

const argvLog = (env: Env): string[][] =>
  fs
    .readFileSync(path.join(env.root, 'fake-argv.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);

/** Make the fake CLI wait before answering until the returned file is deleted (it creates the file when it waits). */
function holdAnswer(env: Env): string {
  const hold = path.join(env.root, 'answer.hold');
  process.env.MIGENT_FAKE_ANSWER_HOLD = hold;
  return hold;
}

function releaseAnswer(hold: string): void {
  delete process.env.MIGENT_FAKE_ANSWER_HOLD;
  fs.rmSync(hold, { force: true });
}

const scenarios: Scenario[] = [
  {
    name: 'Reply: the draft keeps the blocker, survives a new service (reload), and sends with the exact argv',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r1');
      assert.match(fs.readFileSync(file, 'utf8'), /needs a decision/);
      fs.appendFileSync(file, 'Use Postgres.\n');
      const reloaded = new ReplyService(env.api.registry, env.api.control, path.dirname(path.dirname(file)));
      assert.ok(reloaded.hasDraft(meta), 'a fresh service finds the draft');
      const result = await env.api.replies.send(meta);
      assert.equal(result.kind, 'sent');
      assert.equal(fs.existsSync(file), false, 'the submitted draft is deleted only after the reply is consumed');
      const [call] = argvLog(env);
      assert.deepEqual(call.slice(0, 5), ['session', 'continue', 'r1', '--stage', 'plan']);
      assert.equal(call[5], '--reply-file');
      assert.equal(call.length, 7, 'no run flags are added to a reply');
    },
  },
  {
    name: 'Reply: a rejected submission keeps the draft and releases the session',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r2');
      fs.appendFileSync(file, 'Use Postgres.\n');
      await withReplyMode('reject', async () => {
        const result = await env.api.replies.send(meta);
        assert.equal(result.kind, 'failed');
      });
      assert.match(fs.readFileSync(file, 'utf8'), /Use Postgres/);
      assert.equal(env.api.control.gate.current(meta.project, 'r2'), undefined, 'gate released');
    },
  },
  {
    name: 'Reply: a resuming execution without the reply releases the gate but keeps the draft',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r3');
      fs.appendFileSync(file, 'Use Postgres.\n');
      await withReplyMode('ignore', async () => {
        const result = await env.api.replies.send(meta);
        assert.equal(result.kind, 'sent');
      });
      assert.match(fs.readFileSync(file, 'utf8'), /Use Postgres/, 'the draft is kept');
      assert.equal(env.api.control.gate.current(meta.project, 'r3'), undefined, 'the blocked execution moved on, so the gate is released');
    },
  },
  {
    name: 'Reply: a resume seen after the timeout releases the gate, and the reply turn settles the draft',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r8');
      fs.appendFileSync(file, 'Use Postgres.\n');
      await withReplyMode('ignore', async () => {
        assert.equal((await env.api.replies.send(meta)).kind, 'sent');
      });
      // The ignoring CLI resumed the blocked execution (0002) with a turn that is not this reply.
      assert.equal(env.api.control.gate.current(meta.project, 'r8'), undefined, 'released: the blocked execution moved on');
      assert.match(fs.readFileSync(file, 'utf8'), /Use Postgres/, 'the draft is kept without the reply turn');
      const history = [{ role: 'user', content: '## Human reply\n\nUse Postgres.' }];
      // The reply turn then shows up in that execution's conversation.json.
      write(migentPath(env.root, 'sessions', 'r8', 'executions', '0002-plan--attempt-02', 'conversation.json'), JSON.stringify({ history }));
      await waitFor('draft settled', () => !fs.existsSync(file));
    },
  },
  {
    name: 'Reply: edits made while sending are preserved',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r4');
      fs.appendFileSync(file, 'Use Postgres.\n');
      const hold = holdAnswer(env);
      try {
        const sending = env.api.replies.send(meta);
        await waitFor('the CLI holds the answer', () => fs.existsSync(hold));
        fs.appendFileSync(file, 'One more thing.\n');
        fs.rmSync(hold);
        const result = await sending;
        assert.deepEqual(result, { kind: 'sent', hasKeptEdits: true });
      } finally {
        releaseAnswer(hold);
      }
      assert.match(fs.readFileSync(file, 'utf8'), /One more thing/);
    },
  },
  {
    name: 'Reply: unsaved edits in the open editor are preserved, with the draft identity',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r7');
      fs.appendFileSync(file, 'Use Postgres.'+String.fromCharCode(10));
      const hold = holdAnswer(env);
      try {
        const sending = env.api.replies.send(meta);
        await waitFor('the CLI holds the answer', () => fs.existsSync(hold));
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, document.positionAt(document.getText().length), 'Unsaved thought.'+String.fromCharCode(10));
        await vscode.workspace.applyEdit(edit);
        assert.equal(document.isDirty, true);
        fs.rmSync(hold);
        assert.deepEqual(await sending, { kind: 'sent', hasKeptEdits: true });
      } finally {
        releaseAnswer(hold);
      }
      assert.ok(fs.existsSync(file), 'the draft file is kept');
      assert.ok(env.api.replies.identityOf(vscode.Uri.file(file)), 'and so is its identity');
    },
  },
  {
    name: 'Reply: a session that is no longer blocked on the stage is not sent, and the draft stays',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r5');
      fs.appendFileSync(file, 'Use Postgres.\n');
      write(migentPath(env.root, 'sessions', 'r5', 'status.json'), status('completed', { latest_execution_id: EXECUTION }));
      await waitFor('session completed', () => env.project()?.store.snapshot('r5')?.displayState.state === 'completed');
      const result = await env.api.replies.send(meta);
      assert.equal(result.kind, 'blocked');
      assert.equal(fs.existsSync(file), true);
    },
  },
  {
    name: 'Reply: a cancelled workflow stage takes a reply with the stage, and the interrupted turn settles the draft',
    async run(env) {
      const { file, meta } = await openOther(env, 'c1', 'cancelled');
      assert.equal(meta.kind, 'cancelled');
      assert.match(fs.readFileSync(file, 'utf8'), /Interrupted stage: plan/);
      fs.appendFileSync(file, 'Carry on.\n');
      const result = await env.api.replies.send(meta);
      assert.equal(result.kind, 'sent');
      assert.equal(fs.existsSync(file), false, 'the interrupted-turn wording confirms the reply and deletes the draft');
      const [call] = argvLog(env);
      assert.deepEqual(call.slice(0, 5), ['session', 'continue', 'c1', '--stage', 'plan']);
      assert.equal(call.length, 7, 'no run flags are added to a reply');
    },
  },
  {
    name: 'Reply: a role session takes a reply without --stage, and the role turn settles the draft',
    async run(env) {
      const { file, meta } = await openOther(env, 'ro1', 'role-stopped');
      assert.equal(meta.kind, 'roleTurn');
      assert.equal(meta.stageId, null);
      fs.appendFileSync(file, 'Look again.\n');
      assert.equal((await env.api.replies.send(meta)).kind, 'sent');
      assert.equal(fs.existsSync(file), false, 'the role-prefixed turn confirms the reply and deletes the draft');
      const [call] = argvLog(env);
      assert.deepEqual(call.slice(0, 3), ['session', 'continue', 'ro1']);
      assert.equal(call[3], '--reply-file');
      assert.equal(call.length, 5, 'a role reply passes neither --stage nor run flags');
    },
  },
  {
    name: 'Reply: a cancelled role session takes a reply without --stage',
    async run(env) {
      const { file, meta } = await openOther(env, 'ro2', 'role-cancelled');
      fs.appendFileSync(file, 'Resume.\n');
      assert.equal((await env.api.replies.send(meta)).kind, 'sent');
      assert.equal(fs.existsSync(file), false);
      assert.equal(argvLog(env)[0].includes('--stage'), false);
    },
  },
  {
    name: 'Reply: a completed role session reopens as running, then returns to Recent; the counts follow',
    async run(env) {
      const { file, meta } = await openOther(env, 'ro3', 'role-completed');
      const snapshotOf = (): SessionSnapshot | undefined => env.project()?.store.snapshot('ro3');
      const current = (): SessionSnapshot => {
        const snapshot = snapshotOf();
        assert.ok(snapshot);
        return snapshot;
      };
      assert.equal(groupOf(current()), 'recent');
      fs.appendFileSync(file, 'One more turn.\n');
      assert.equal((await env.api.replies.send(meta)).kind, 'sent');
      await waitFor('reopened as running', () => snapshotOf()?.displayState.state === 'running');
      assert.equal(groupOf(current()), 'running');
      assert.equal(summarize(env.project()?.store.all() ?? []).running, 1);
      await waitFor('completed again', () => snapshotOf()?.displayState.state === 'completed');
      assert.equal(groupOf(current()), 'recent');
      const counts = summarize(env.project()?.store.all() ?? []);
      assert.equal(counts.running, 0);
      assert.equal(counts.needsAttention, 0, 'a reopened and finished role session is not a call for attention');
    },
  },
  {
    name: 'Reply: a role or cancelled session that moved on is not sent, and the draft stays',
    async run(env) {
      const role = await openOther(env, 'st1', 'role-stopped');
      fs.appendFileSync(role.file, 'Late.\n');
      write(migentPath(env.root, 'sessions', 'st1', 'status.json'), status('prepared'));
      await waitFor('role no longer replyable', () => env.project()?.store.snapshot('st1')?.replyTargets.length === 0);
      assert.equal((await env.api.replies.send(role.meta)).kind, 'blocked');
      assert.equal(fs.existsSync(role.file), true);
      const cancelled = await openOther(env, 'st2', 'cancelled');
      fs.appendFileSync(cancelled.file, 'Late.\n');
      write(migentPath(env.root, 'sessions', 'st2', 'executions', EXECUTION, 'execution.json'), JSON.stringify({ execution_id: EXECUTION, stage_id: 'plan', status: 'completed' }));
      write(migentPath(env.root, 'sessions', 'st2', 'status.json'), status('completed', { latest_execution_id: EXECUTION }));
      await waitFor('stage no longer replyable', () => env.project()?.store.snapshot('st2')?.replyTargets.length === 0);
      assert.equal((await env.api.replies.send(cancelled.meta)).kind, 'blocked');
      assert.equal(fs.existsSync(cancelled.file), true);
      assert.equal(fs.existsSync(path.join(env.root, 'fake-argv.log')), false, 'the CLI was not started');
    },
  },
  {
    name: 'Reply: quick text becomes the draft body, an existing draft is never overwritten, and it sends',
    async run(env) {
      fs.rmSync(path.join(env.root, 'fake-argv.log'), { force: true });
      const project = await createProject(env);
      seedOther(env, 'q1', 'role-stopped');
      await waitFor('reply targets', () => (project.store.snapshot('q1')?.replyTargets.length ?? 0) > 0);
      const snapshot = project.store.snapshot('q1');
      assert.ok(snapshot);
      const source = { context: project, snapshot, target: snapshot.replyTargets[0] };
      const meta = await env.api.replies.prepare(source, 'Short answer.');
      assert.ok(meta);
      const file = env.api.replies.draftPath(meta);
      assert.match(fs.readFileSync(file, 'utf8'), /Short answer[.]\n?$/);
      const again = await env.api.replies.prepare(source, 'Different text.');
      assert.ok(again);
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Different text/, 'an existing draft keeps the user text');
      assert.equal((await env.api.replies.send(meta)).kind, 'sent');
      assert.equal(fs.existsSync(file), false);
    },
  },
  {
    name: 'Reply: an empty reply is not sent',
    async run(env) {
      const { meta } = await openDraft(env, 'r6');
      const result = await env.api.replies.send(meta);
      assert.equal(result.kind, 'blocked');
      assert.equal(fs.existsSync(path.join(env.root, 'fake-argv.log')), false, 'the CLI was not started');
    },
  },
];

export function runReplyScenarios(): Promise<number> {
  return runScenarios(scenarios);
}
