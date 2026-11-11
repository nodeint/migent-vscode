import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import { parseManifest } from './manifest';
import type { ExecutionSnapshot, SessionSnapshot } from './model';
import {
  blockedTargets,
  blockKind,
  describeQuotaReset,
  quotaFailure,
  replyConsumed,
  replyHeader,
  replyNeedsExecutions,
  replyPrompt,
  replyResumed,
  replyTargets,
  replyText,
} from './replyFlow';
import { parseStatus } from './statusReader';
import { snapshotFromDir, syntheticDir } from './testHelpers';

function snapshot(raw: Record<string, unknown>): SessionSnapshot {
  const status = parseStatus(JSON.stringify(raw));
  return {
    sessionId: 's1',
    manifest: null,
    status,
    statusError: false,
    lock: { kind: 'none' },
    displayState: deriveDisplayState({ status, statusError: null, manifest: 'ok' }, { kind: 'none' }),
    titleOverride: null,
    replyTargets: [],
  };
}

const quotaEvent = (retryAt: unknown) => ({
  event: 'provider.quota',
  execution_id: '0001-plan--attempt-01',
  details: { retry_at: retryAt },
});

describe('blockKind', () => {
  it('tells an ordinary blocker and a pending question apart, and never reads quota as an obstacle', () => {
    const blocker = snapshot({ status: 'blocked', blocked_by_execution_ids: ['0001-plan--attempt-01'] });
    const quota = snapshot({ status: 'active', latest_provider_event: quotaEvent('2026-11-03T12:00:00Z') });
    expect(blockKind(blocker)).toBe('blocker');
    expect(blockKind(quota)).toBeNull();
    expect(blockKind(snapshot({ status: 'question' }))).toBe('question');
    expect(blockKind(snapshotFromDir(syntheticDir('blocked-questions')))).toBe('question');
  });

  it('shows no obstacle for a stopped session whose latest event is not a quota event', () => {
    const stopped = snapshot({ status: 'active', latest_provider_event: { event: 'provider.turn_completed' } });
    expect(blockKind(stopped)).toBeNull();
  });
});

describe('blockedTargets', () => {
  it('lists every blocked execution of an ordinary blocker, with stage names that contain hyphens', () => {
    const targets = blockedTargets(
      snapshot({
        status: 'blocked',
        blocked_by_execution_ids: ['0003-code-review--attempt-02', '0001-plan--attempt-01'],
      }),
    );
    expect(targets.map((target) => [target.stageId, target.attempt])).toEqual([
      ['plan', 1],
      ['code-review', 2],
    ]);
  });

  it('offers nothing for a pending question, so Reply cannot answer it', () => {
    expect(blockedTargets(snapshotFromDir(syntheticDir('blocked-questions')))).toEqual([]);
  });
});

describe('quotaFailure', () => {
  const failedWith = (retryAt: unknown, eventExecution = '0002-plan--attempt-02') =>
    snapshot({
      status: 'active',
      latest_execution_id: '0002-plan--attempt-02',
      latest_execution_status: 'failed',
      latest_provider_event: { event: 'provider.quota', execution_id: eventExecution, details: { retry_at: retryAt } },
    });

  it('reads a failed latest execution with a quota event as a quota failure, never as an obstacle', () => {
    const failed = failedWith('2026-11-03T12:00:00Z');
    expect(quotaFailure(failed)).toEqual({ retryAt: Date.parse('2026-11-03T12:00:00Z') });
    expect(blockKind(failed)).toBeNull();
  });

  it('does not invent a reset time when none or an unparsable one is recorded', () => {
    for (const retryAt of ['', 'soon', null]) {
      const failure = quotaFailure(failedWith(retryAt));
      expect(failure).toEqual({ retryAt: null });
      expect(failure === null ? '' : describeQuotaReset(failure)).toBe('no reset time was recorded');
    }
  });

  it('ignores an unrelated later failure and sessions that are not failed', () => {
    expect(quotaFailure(failedWith('', '0001-plan--attempt-01'))).toBeNull();
    expect(quotaFailure(snapshot({ status: 'active' }))).toBeNull();
    expect(quotaFailure(snapshot({ status: 'active', latest_provider_event: quotaEvent('2026-11-03T12:00:00Z') }))).toBeNull();
  });

  it('describes the absolute reset time with a time zone', () => {
    const text = describeQuotaReset({ retryAt: Date.parse('2026-11-03T12:00:00Z') }, 'en-US');
    expect(text).toMatch(/^resets /);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/GMT|UTC|[A-Z]{3,4}/);
  });
});

describe('reply editor text', () => {
  const header = replyHeader({
    target: { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, kind: 'blocker' as const },
    blocker: 'needs a --decision\nsecond line',
    responsePath: 'executions/0001-plan--attempt-01/response.md',
  });

  it('keeps the blocker in the editor and strips it before sending', () => {
    expect(header).toContain('needs a - -decision second line');
    expect(replyText(`${header}Use option B.\n`)).toBe('Use option B.');
    expect(replyText(header)).toBe('');
  });

  it('treats text without the context block as the whole reply', () => {
    expect(replyText('  just text \r\n')).toBe('just text');
  });
});

type Turn = [role: string, content: string];
/** Each execution: the user/assistant turns of its conversation.json and the execution it resumes. */
function sessionWith(executions: Record<string, [history: Turn[], resumes: string | null]>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-reply-'));
  for (const [id, [history, resumes]] of Object.entries(executions)) {
    const root = path.join(dir, 'executions', id);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'execution.json'), JSON.stringify({ resumes_execution_id: resumes }));
    writeFileSync(
      path.join(root, 'conversation.json'),
      JSON.stringify({ history: history.map(([role, content]) => ({ role, content })) }),
    );
  }
  return dir;
}

describe('replyResumed', () => {
  const blocked = { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, kind: 'blocker' as const };
  const first: Turn[] = [['user', 'Read the task.']];
  const resumes = '0001-plan--attempt-01';

  it('holds for a resuming execution of the same stage whatever text its prompt carries', () => {
    const dir = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', 'a wording no client knows']], resumes],
    });
    expect(replyResumed(dir, blocked)).toBe(true);
  });

  it('does not hold before anything resumed it, for another stage, or for another execution', () => {
    expect(replyResumed(sessionWith({ '0001-plan--attempt-01': [first, null] }), blocked)).toBe(false);
    expect(
      replyResumed(
        sessionWith({ '0001-plan--attempt-01': [first, null], '0002-review--attempt-01': [first, resumes] }),
        blocked,
      ),
    ).toBe(false);
    expect(
      replyResumed(
        sessionWith({ '0001-plan--attempt-01': [first, null], '0002-plan--attempt-02': [first, '0000-plan--attempt-00'] }),
        blocked,
      ),
    ).toBe(false);
  });
});

describe('replyConsumed', () => {
  const blocked = { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, kind: 'blocker' as const };
  const first: Turn[] = [
    ['user', 'Read the task.'],
    ['assistant', 'status: blocked'],
  ];
  const resumes = '0001-plan--attempt-01';

  it('is acknowledged by a resuming execution that recorded the reply as its own user turn (native session)', () => {
    const dir = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', 'Reply:\nUse option B.']], resumes],
    });
    expect(replyConsumed(dir, blocked, 'Use option B.')).toBe(true);
    expect(replyConsumed(dir, blocked, '  Use option B.\r\n')).toBe(true);
  });

  it('is acknowledged by the `## Human reply` turn that current CLIs record', () => {
    const dir = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', '## Human reply\n\nhỏi thêm đi']], resumes],
    });
    expect(replyConsumed(dir, blocked, 'hỏi thêm đi')).toBe(true);
    expect(replyConsumed(dir, blocked, 'hỏi')).toBe(false);
  });

  it('is acknowledged when the provider history is replayed, because the turn is its own history entry', () => {
    // Replay sends the whole history flattened, but conversation.json still keeps each turn separately.
    const dir = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', 'Reply:\nUse Postgres.'], ['assistant', 'status: complete']], resumes],
    });
    expect(replyConsumed(dir, blocked, 'Use Postgres.')).toBe(true);
  });

  it('is not acknowledged by a superseding execution that lacks the reply or belongs to another stage', () => {
    const dir = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', 'Continue.']], resumes],
      '0003-review--attempt-01': [[['user', 'Reply:\nUse option B.']], resumes],
    });
    expect(replyConsumed(dir, blocked, 'Use option B.')).toBe(false);
    expect(replyConsumed(dir, blocked, '  ')).toBe(false);
  });

  it('is not fooled by other text, a longer reply, quoted markers or another resumed execution', () => {
    const turn = (content: string): string =>
      sessionWith({
        '0001-plan--attempt-01': [first, null],
        '0002-plan--attempt-02': [[...first, ['user', content]], resumes],
      });
    expect(replyConsumed(turn('Please choose Yes or No.'), blocked, 'Yes')).toBe(false);
    expect(replyConsumed(turn('Reply:\nYes or No?'), blocked, 'Yes')).toBe(false);
    expect(replyConsumed(turn('Reply:\nYes\n\nBut only after approval.'), blocked, 'Yes')).toBe(false);
    expect(replyConsumed(turn('Example response:\nReply:\nYes'), blocked, 'Yes')).toBe(false);
    expect(replyConsumed(turn('Reply:\nYes\n\nBut only after approval.'), blocked, 'Yes\n\nBut only after approval.')).toBe(
      true,
    );
    const elsewhere = sessionWith({
      '0001-plan--attempt-01': [first, null],
      '0002-plan--attempt-02': [[...first, ['user', 'Reply:\nYes']], '0000-other--attempt-01'],
    });
    expect(replyConsumed(elsewhere, blocked, 'Yes')).toBe(false);
  });

  it('confirms nothing when the baseline history is missing, malformed or unreadable', () => {
    const earlier: Turn[] = [...first, ['user', 'Reply:\nYes']];
    const resumed: [Turn[], string] = [[...earlier, ['user', 'Reply:\nYes']], resumes];
    for (const baseline of [undefined, '{ not json', JSON.stringify({ history: 'nope' })]) {
      const dir = sessionWith({ '0001-plan--attempt-01': [first, null], '0002-plan--attempt-02': resumed });
      const file = path.join(dir, 'executions', '0001-plan--attempt-01', 'conversation.json');
      if (baseline === undefined) rmSync(file);
      else writeFileSync(file, baseline);
      expect(replyConsumed(dir, blocked, 'Yes')).toBe(false);
    }
    // An unreadable history in the resuming execution does not confirm either.
    const unreadable = sessionWith({ '0001-plan--attempt-01': [first, null], '0002-plan--attempt-02': resumed });
    writeFileSync(path.join(unreadable, 'executions', '0002-plan--attempt-02', 'conversation.json'), '{ not json');
    expect(replyConsumed(unreadable, blocked, 'Yes')).toBe(false);
  });

  it('does not count an identical reply that the blocked execution already held', () => {
    const earlier: Turn[] = [...first, ['user', 'Reply:\nYes'], ['assistant', 'status: blocked']];
    const stale = sessionWith({
      '0001-plan--attempt-01': [earlier, null],
      '0002-plan--attempt-02': [earlier, resumes],
    });
    expect(replyConsumed(stale, blocked, 'Yes')).toBe(false);
    const again = sessionWith({
      '0001-plan--attempt-01': [earlier, null],
      '0002-plan--attempt-02': [[...earlier, ['user', 'Reply:\nYes']], resumes],
    });
    expect(replyConsumed(again, blocked, 'Yes')).toBe(true);
  });
});

describe('replyTargets', () => {
  const role = parseManifest('session_id: s1\nrole: reviewer\n');
  const withRole = (raw: Record<string, unknown>): SessionSnapshot => ({ ...snapshot(raw), manifest: role });
  const execution = (id: string, stage: string, status: string, kind: string | null = null): ExecutionSnapshot => {
    const order = Number(id.slice(0, 4));
    return {
      id,
      order,
      stage,
      attempt: 1,
      status,
      decision: null,
      client: null,
      model: null,
      hasFailureReport: false,
      blocker: null,
      kind,
    };
  };

  it('answers each blocked execution of a workflow with kind blocker, exactly as blockedTargets does', () => {
    const blocked = snapshot({ status: 'blocked', blocked_by_execution_ids: ['0001-plan--attempt-01'] });
    expect(replyTargets(blocked)).toEqual(blockedTargets(blocked));
    expect(replyTargets(blocked).map((target) => target.kind)).toEqual(['blocker']);
  });

  it('answers a cancelled stage of a cancelled workflow, not a verify-only or a resumed one', () => {
    const cancelled = snapshot({ status: 'cancelled' });
    expect(replyNeedsExecutions(cancelled)).toBe(true);
    const targets = replyTargets(cancelled, [
      execution('0001-plan--attempt-01', 'plan', 'completed'),
      execution('0002-code--attempt-01', 'code', 'cancelled'),
      execution('0003-test--attempt-01', 'test', 'cancelled', 'verify'),
      execution('0004-lint--attempt-01', 'lint', 'cancelled'),
      execution('0005-lint--attempt-02', 'lint', 'completed'),
    ]);
    expect(targets).toEqual([{ executionId: '0002-code--attempt-01', stageId: 'code', attempt: 1, kind: 'cancelled' }]);
  });

  it('ignores a skipped execution when it picks the latest one of a stage', () => {
    const targets = replyTargets(snapshot({ status: 'cancelled' }), [
      execution('0001-code--attempt-01', 'code', 'cancelled'),
      execution('0002-code--attempt-02', 'code', 'skipped'),
    ]);
    expect(targets.map((target) => target.executionId)).toEqual(['0001-code--attempt-01']);
  });

  it('offers nothing for failed, stopped, completed, prepared, running or question workflow sessions', () => {
    const failed = snapshot({ status: 'active', latest_execution_status: 'failed' });
    const stopped = snapshot({ status: 'active', latest_execution_status: 'completed' });
    for (const raw of [{ status: 'completed' }, { status: 'prepared' }, { status: 'question' }]) {
      expect(replyTargets(snapshot(raw))).toEqual([]);
    }
    expect(replyTargets(failed)).toEqual([]);
    expect(replyTargets(stopped)).toEqual([]);
    expect(replyNeedsExecutions(failed)).toBe(false);
  });

  it('offers nothing while a question is pending, whatever the display state', () => {
    expect(replyTargets(snapshotFromDir(syntheticDir('blocked-questions')))).toEqual([]);
  });

  it('answers the latest execution of a role session in every state the CLI accepts, with no stage', () => {
    for (const status of ['active', 'blocked', 'cancelled', 'completed']) {
      const targets = replyTargets(withRole({ status, latest_execution_id: '0002-reviewer--attempt-01' }));
      expect(targets).toEqual([{ executionId: '0002-reviewer--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' }]);
    }
    expect(replyNeedsExecutions(withRole({ status: 'cancelled' }))).toBe(false);
  });

  it('offers nothing to a running or prepared role session, a questioning one, or one without an execution', () => {
    expect(replyTargets(withRole({ status: 'prepared', latest_execution_id: '0001-r--attempt-01' }))).toEqual([]);
    expect(replyTargets(withRole({ status: 'question', latest_execution_id: '0001-r--attempt-01' }))).toEqual([]);
    expect(replyTargets(withRole({ status: 'active' }))).toEqual([]);
  });
});

describe('replyPrompt and the interrupted header', () => {
  it('says the workflow keeps running for an interrupted stage and names the role for a role turn', () => {
    const cancelled = { executionId: '0002-code--attempt-01', stageId: 'code', attempt: 1, kind: 'cancelled' as const };
    expect(replyPrompt(cancelled, null)).toContain('keeps running');
    expect(replyHeader({ target: cancelled, blocker: null, responsePath: null })).toContain('Interrupted stage: code');
    const turn = { executionId: '0002-reviewer--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' as const };
    expect(replyPrompt(turn, 'reviewer')).toContain('role reviewer');
    expect(replyHeader({ target: turn, blocker: null, responsePath: null, role: 'reviewer' })).toContain('Role: reviewer');
  });

  it('falls back to the word role when neither a stage nor a role name is known', () => {
    const turn = { executionId: '0002-x--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' as const };
    expect(replyHeader({ target: turn, blocker: null, responsePath: null })).toContain(
      '<!-- Role: role (execution 0002-x- -attempt-01) -->',
    );
    expect(replyPrompt(turn, null)).toBe('Reply to the role (execution 0002-x--attempt-01). It starts a new turn.');
  });
});

describe('a role turn reply', () => {
  it('is resumed and consumed by a later execution of the same role that resumes it', () => {
    const first: Turn[] = [['user', 'Review.']];
    const dir = sessionWith({
      '0001-reviewer--attempt-01': [first, null],
      '0002-reviewer--attempt-01': [[...first, ['user', '## Human reply\n\nGo on']], '0001-reviewer--attempt-01'],
    });
    const turn = { executionId: '0001-reviewer--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' as const };
    expect(replyResumed(dir, turn)).toBe(true);
    expect(replyConsumed(dir, turn, 'Go on')).toBe(true);
  });
});

describe('reply turns as the CLI 0.5.2 renderer writes them', () => {
  // Rendered with `buildStageReplyPrompt` and `prependRoleInstructions` of @nodeint/migent-prompts 0.5.2.
  const interrupted =
    '## Human reply\n\nYour previous turn was stopped by the human before it finished. Their message:\n\nGo on';
  const withRole = `## Role\n\n- Be terse.\n- Cite files.\n\n${interrupted}`;
  const first: Turn[] = [['user', 'Read the task.']];
  const stage = { executionId: '0001-code--attempt-01', stageId: 'code', attempt: 1, kind: 'cancelled' as const };
  const role = { executionId: '0001-reviewer--attempt-01', stageId: null, attempt: 1, kind: 'roleTurn' as const };
  const consumed = (target: typeof stage | typeof role, turn: string, reply = 'Go on'): boolean => {
    const name = target.stageId ?? 'reviewer';
    const dir = sessionWith({
      [target.executionId]: [first, null],
      [`0002-${name}--attempt-02`]: [[...first, ['user', turn]], target.executionId],
    });
    return replyConsumed(dir, target, reply);
  };

  it('confirms the interrupted-turn wording of a cancelled workflow stage', () => {
    expect(consumed(stage, interrupted)).toBe(true);
  });

  it('confirms a role reply that carries the role responsibilities, plain or interrupted', () => {
    expect(consumed(role, withRole)).toBe(true);
    expect(consumed(role, '## Role\n\n- Be terse.\n\n## Human reply\n\nGo on')).toBe(true);
  });

  it('keeps the exact-turn rule: other text, another reply or a role prefix on a stage do not confirm', () => {
    expect(consumed(stage, `${interrupted} and more`)).toBe(false);
    expect(consumed(stage, withRole)).toBe(false);
    expect(consumed(role, withRole, 'Something else')).toBe(false);
    expect(consumed(role, `Please repeat: ${interrupted}`)).toBe(false);
  });

  it('does not count an identical earlier reply again', () => {
    const dir = sessionWith({
      '0001-reviewer--attempt-01': [[...first, ['user', withRole]], null],
      '0002-reviewer--attempt-02': [[...first, ['user', withRole]], '0001-reviewer--attempt-01'],
    });
    expect(replyConsumed(dir, role, 'Go on')).toBe(false);
  });
});
