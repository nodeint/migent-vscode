import { describe, expect, it } from 'vitest';

import type { SessionSnapshot } from './model';
import { checkWrite, describeBlock } from './writeEligibility';

function snapshotWith(lock: SessionSnapshot['lock']): SessionSnapshot {
  return {
    sessionId: 's1',
    manifest: null,
    status: null,
    statusError: false,
    lock,
    displayState: { state: 'running', icon: 'x', writable: true },
  };
}

describe('checkWrite', () => {
  it('blocks every write while the CLI is not ok, with a recovery that matches the cause', () => {
    expect(checkWrite({ capability: 'missing' })).toMatchObject({ ok: false, reason: 'cli', recovery: 'settings' });
    expect(checkWrite({ capability: 'old' })).toMatchObject({ recovery: 'settings' });
    expect(checkWrite({ capability: 'error' })).toMatchObject({ recovery: 'recheck' });
    expect(checkWrite({ capability: 'checking' })).toMatchObject({ ok: false, recovery: 'recheck' });
  });

  it('allows a session that this host is running, and a new session with no snapshot', () => {
    const own = snapshotWith({ kind: 'alive', pid: 1, host: 'me', heartbeatAt: null, foreignHost: false });
    expect(checkWrite({ capability: 'ok', snapshot: own })).toEqual({ ok: true });
    expect(checkWrite({ capability: 'ok' })).toEqual({ ok: true });
  });

  it('blocks only the session whose live lock belongs to another host', () => {
    const foreign = snapshotWith({ kind: 'alive', pid: 9, host: 'other', heartbeatAt: 't', foreignHost: true });
    const check = checkWrite({ capability: 'ok', snapshot: foreign });
    expect(check).toMatchObject({ ok: false, reason: 'foreign-lock', host: 'other', pid: 9 });
    expect(checkWrite({ capability: 'ok', snapshot: snapshotWith({ kind: 'none' }) })).toEqual({ ok: true });
  });

  it('blocks a duplicate while an operation is pending', () => {
    expect(checkWrite({ capability: 'ok', pendingPhase: 'Starting' })).toMatchObject({ ok: false, reason: 'busy' });
  });
});

describe('describeBlock', () => {
  it('names the owner of a foreign lock', () => {
    const check = checkWrite({
      capability: 'ok',
      snapshot: snapshotWith({ kind: 'alive', pid: 9, host: 'other', heartbeatAt: 't', foreignHost: true }),
    });
    if (check.ok) throw new Error('expected a block');
    expect(describeBlock(check)).toContain('other pid 9');
  });
});
