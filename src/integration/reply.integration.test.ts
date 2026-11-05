/**
 * Phase 3c Reply scenarios (plans/03c-reply-notifications.md §6). The fixture CLI turns `session continue --stage
 * --reply-file` for an ordinary blocker into the stage's next attempt (`MIGENT_FAKE_REPLY` selects consume, ignore
 * or reject). `ReplyService` is driven directly; the editor and notifications are not clicked.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { blockedTargets } from '../core/replyFlow';
import { ReplyService } from '../vscode/reply';
import { createProject, type Env, manifest, migentPath, runScenarios, type Scenario, sleep, status, waitFor, write } from './harness';

const EXECUTION = '0001-plan--attempt-01';

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
  await env.api.replies.open(project, snapshot, target);
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
      process.env.MIGENT_FAKE_ANSWER_DELAY_MS = '800';
      try {
        const sending = env.api.replies.send(meta);
        await sleep(300);
        fs.appendFileSync(file, 'One more thing.\n');
        const result = await sending;
        assert.deepEqual(result, { kind: 'sent', hasKeptEdits: true });
      } finally {
        delete process.env.MIGENT_FAKE_ANSWER_DELAY_MS;
      }
      assert.match(fs.readFileSync(file, 'utf8'), /One more thing/);
    },
  },
  {
    name: 'Reply: unsaved edits in the open editor are preserved, with the draft identity',
    async run(env) {
      const { file, meta } = await openDraft(env, 'r7');
      fs.appendFileSync(file, 'Use Postgres.'+String.fromCharCode(10));
      process.env.MIGENT_FAKE_ANSWER_DELAY_MS = '800';
      try {
        const sending = env.api.replies.send(meta);
        await sleep(300);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, document.positionAt(document.getText().length), 'Unsaved thought.'+String.fromCharCode(10));
        await vscode.workspace.applyEdit(edit);
        assert.equal(document.isDirty, true);
        assert.deepEqual(await sending, { kind: 'sent', hasKeptEdits: true });
      } finally {
        delete process.env.MIGENT_FAKE_ANSWER_DELAY_MS;
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
