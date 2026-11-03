import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import type { SessionSnapshot } from './model';
import {
  blockedTargets,
  blockKind,
  describeQuotaWait,
  quotaWait,
  replyConsumed,
  replyHeader,
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
  };
}

const quotaEvent = (retryAt: unknown) => ({
  event: 'provider.quota',
  execution_id: '0001-plan--attempt-01',
  details: { retry_at: retryAt },
});

describe('blockKind', () => {
  it('tells an ordinary blocker, a quota wait and a pending question apart', () => {
    const blocker = snapshot({ status: 'blocked', blocked_by_execution_ids: ['0001-plan--attempt-01'] });
    const quota = snapshot({ status: 'active', latest_provider_event: quotaEvent('2026-11-03T12:00:00Z') });
    expect(blockKind(blocker)).toBe('blocker');
    expect(blockKind(quota)).toBe('quota');
    expect(blockKind(snapshot({ status: 'question' }))).toBe('question');
    expect(blockKind(snapshotFromDir(syntheticDir('blocked-questions')))).toBe('question');
  });

  it('shows no obstacle for a stopped session whose latest event is not a quota wait', () => {
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

describe('quotaWait', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  const waitFor = (retryAt: unknown) =>
    quotaWait(snapshot({ status: 'active', latest_provider_event: quotaEvent(retryAt) }), now);

  it('is not ready before retry_at and ready at it', () => {
    expect(waitFor('2026-11-03T10:00:01Z')?.isReady).toBe(false);
    expect(waitFor('2026-11-03T10:00:00Z')?.isReady).toBe(true);
  });

  it('does not invent a retry time when none or an unparsable one is recorded', () => {
    for (const retryAt of ['', 'soon', null]) {
      const wait = waitFor(retryAt);
      expect(wait).toEqual({ retryAt: null, isReady: false });
      expect(wait === null ? '' : describeQuotaWait(wait, now)).toBe('No retry time was recorded.');
    }
  });

  it('also recognizes the persisted failed shape of an exhausted quota, but not an unrelated later failure', () => {
    const failed = (eventExecution: string) =>
      snapshot({
        status: 'active',
        latest_execution_id: '0002-plan--attempt-02',
        latest_execution_status: 'failed',
        latest_provider_event: { event: 'provider.quota', execution_id: eventExecution, details: { retry_at: '' } },
      });
    expect(blockKind(failed('0002-plan--attempt-02'))).toBe('quota');
    expect(blockKind(failed('0001-plan--attempt-01'))).toBeNull();
  });

  it('is absent for a session that is not in a quota wait', () => {
    expect(quotaWait(snapshot({ status: 'active' }), now)).toBeNull();
  });

  it('describes the absolute time with a time zone and a countdown', () => {
    const text = describeQuotaWait({ retryAt: now + 125_000, isReady: false }, now, 'en-US');
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/GMT|UTC|[A-Z]{3,4}/);
    expect(text).toContain('in 2m 5s');
  });
});

describe('reply editor text', () => {
  const header = replyHeader({
    target: { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1 },
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

describe('replyConsumed', () => {
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
  const blocked = { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1 };
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
