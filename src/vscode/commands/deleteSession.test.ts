import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationGate } from '../../core/operationGate';

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  window: {},
  workspace: { fs: { delete: vi.fn() } },
}));

const { deleteSession } = await import('./deleteSession');
type Ui = NonNullable<Parameters<typeof deleteSession>[2]>;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(running = false) {
  const root = mkdtempSync(join(tmpdir(), 'migent-del-'));
  dirs.push(root);
  mkdirSync(join(root, '.migent', 'sessions', 's1'), { recursive: true });
  const snapshot = {
    sessionId: 's1',
    manifest: null,
    status: null,
    lock: { kind: running ? 'alive' : 'none' },
    displayState: { state: 'completed' },
    titleOverride: 'Mine',
  };
  const store = { snapshot: () => snapshot, refreshSession: vi.fn(), load: vi.fn() };
  const context = { key: 'p', root, store };
  const registry = { project: () => context };
  const gate = new OperationGate();
  const node = { kind: 'session', id: 'n', project: 'p', sessionId: 's1' };
  return { registry, gate, node, context };
}

function ui(over: Partial<Ui> = {}) {
  const calls = { confirm: [] as string[], error: [] as unknown[], remove: 0 };
  const value: Ui = {
    confirm: (label) => {
      calls.confirm.push(label);
      return Promise.resolve(true);
    },
    remove: () => {
      calls.remove += 1;
      return Promise.resolve();
    },
    error: (error) => {
      calls.error.push(error);
    },
    ...over,
  };
  return { value, calls };
}

describe('deleteSession', () => {
  it('confirms with the session label and removes on yes', async () => {
    const { registry, gate, node } = setup();
    const { value, calls } = ui();
    await deleteSession({ registry, gate } as never, node, value);
    expect(calls.confirm).toHaveLength(1);
    expect(calls.remove).toBe(1);
    expect(calls.error).toEqual([]);
  });

  it('does nothing when the confirmation is declined', async () => {
    const { registry, gate, node } = setup();
    const { value, calls } = ui({ confirm: () => Promise.resolve(false) });
    await deleteSession({ registry, gate } as never, node, value);
    expect(calls.remove).toBe(0);
    expect(calls.error).toEqual([]);
  });

  it('reports busy by id while an operation holds the session', async () => {
    const { registry, gate, node } = setup();
    const held = gate.tryAcquire({ kind: 'session', project: 'p', sessionId: 's1' });
    const { value, calls } = ui();
    await deleteSession({ registry, gate } as never, node, value);
    held?.release();
    expect(calls.error).toEqual([{ id: 'deleteSession.busy' }]);
    expect(calls.remove).toBe(0);
  });

  it('reports running by id for a live session', async () => {
    const { registry, gate, node } = setup(true);
    const { value, calls } = ui();
    await deleteSession({ registry, gate } as never, node, value);
    expect(calls.error).toEqual([{ id: 'deleteSession.running' }]);
    expect(calls.remove).toBe(0);
  });

  it('reports a failed removal with its detail', async () => {
    const { registry, gate, node } = setup();
    const { value, calls } = ui({ remove: () => Promise.reject(new Error('trash unavailable')) });
    await deleteSession({ registry, gate } as never, node, value);
    expect(calls.error).toEqual([{ id: 'deleteSession.failed', params: { detail: 'trash unavailable' } }]);
  });
});
