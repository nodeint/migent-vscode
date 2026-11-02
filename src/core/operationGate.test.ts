import { describe, expect, it } from 'vitest';

import { type LaunchKey, OperationGate, type SessionKey } from './operationGate';

const session = (project: string, sessionId: string): SessionKey => ({ kind: 'session', project, sessionId });
const launch: LaunchKey = { kind: 'launch', project: 'p', workflowId: 'plan' };

describe('OperationGate', () => {
  it('refuses a second operation on the same session, but not on another session or project', () => {
    const gate = new OperationGate();
    const first = gate.tryAcquire(session('p', 's1'));
    expect(first).not.toBeNull();
    expect(gate.tryAcquire(session('p', 's1'))).toBeNull();
    expect(gate.tryAcquire(session('p', 's2'))).not.toBeNull();
    expect(gate.tryAcquire(session('q', 's1'))).not.toBeNull();
    first?.release();
    expect(gate.tryAcquire(session('p', 's1'))).not.toBeNull();
  });

  it('release is idempotent and does not free a newer holder', () => {
    const gate = new OperationGate();
    const first = gate.tryAcquire(session('p', 's1'));
    first?.release();
    const second = gate.tryAcquire(session('p', 's1'));
    first?.release();
    expect(gate.current('p', 's1')).toBeDefined();
    second?.release();
    expect(gate.current('p', 's1')).toBeUndefined();
  });

  it('keeps the launch key apart from the prior source', () => {
    const gate = new OperationGate();
    expect(gate.tryAcquire(launch)).not.toBeNull();
    expect(gate.tryAcquire(launch)).toBeNull();
    expect(gate.tryAcquire({ ...launch, priorSessionId: 'src' })).not.toBeNull();
    expect(gate.isLaunchBusy(launch)).toBe(true);
  });

  it('promotes a launch to the created session and then frees the launch key', () => {
    const gate = new OperationGate();
    const handle = gate.tryAcquire(launch, 'Starting');
    const promoted = handle?.promote('new-id');
    expect(promoted?.key).toEqual(session('p', 'new-id'));
    expect(gate.isLaunchBusy(launch)).toBe(false);
    expect(gate.current('p', 'new-id')?.phase).toBe('Starting');
  });

  it('keeps the launch held when the created session is already busy', () => {
    const gate = new OperationGate();
    gate.tryAcquire(session('p', 'new-id'));
    const handle = gate.tryAcquire(launch);
    expect(handle?.promote('new-id')).toBeNull();
    expect(gate.isLaunchBusy(launch)).toBe(true);
  });

  it('announces phase changes and releases once', () => {
    const gate = new OperationGate();
    let changes = 0;
    gate.onDidChange(() => {
      changes += 1;
    });
    const handle = gate.tryAcquire(session('p', 's1'));
    handle?.setPhase('Running');
    handle?.setPhase('Running');
    handle?.release();
    handle?.release();
    expect(changes).toBe(3);
    expect(gate.current('p', 's1')).toBeUndefined();
  });
});
