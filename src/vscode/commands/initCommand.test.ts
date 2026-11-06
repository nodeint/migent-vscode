import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityState } from '../../cli/version';
import { OperationGate } from '../../core/operationGate';
import type { CapabilityService } from '../capability';

const hoisted = vi.hoisted(() => {
  const state = { root: '', cancel: undefined as undefined | (() => void), warnings: [] as string[][] };
  const vscodeMock = {
    ProgressLocation: { Notification: 15, Window: 10 },
    QuickPickItemKind: { Separator: -1 },
    ThemeIcon: class {},
    workspace: {
      get workspaceFolders(): unknown {
        return [{ name: 'f', uri: { scheme: 'file', fsPath: state.root, toString: () => 'file://f' } }];
      },
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    },
    commands: { executeCommand: vi.fn() },
    window: {
      setStatusBarMessage: vi.fn(),
      createQuickPick: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn((...args: string[]) => {
        state.warnings.push(args);
        return Promise.resolve(undefined);
      }),
      withProgress: vi.fn((_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => {
        const listeners: (() => void)[] = [];
        state.cancel = () => {
          for (const listener of listeners) listener();
        };
        const token = {
          onCancellationRequested: (listener: () => void) => {
            listeners.push(listener);
            return { dispose: () => {} };
          },
        };
        return task({}, token);
      }),
    },
  };
  return { state, vscodeMock };
});
vi.mock('vscode', () => hoisted.vscodeMock);

const { initializeProject } = await import('./initCommand');
const { state, vscodeMock } = hoisted;

const required = '0.3.6';
const launchKey = { kind: 'launch', project: 'file://f', workflowId: '<init>' } as const;

function capabilityWith(windowReady: () => Promise<CapabilityState>): CapabilityService {
  return { windowReady } as unknown as CapabilityService;
}

describe('initializeProject', () => {
  beforeEach(() => {
    state.root = mkdtempSync(join(tmpdir(), 'migent-init-'));
    state.warnings.length = 0;
    state.cancel = undefined;
    vi.clearAllMocks();
  });
  afterEach(() => rmSync(state.root, { recursive: true, force: true }));

  it('holds the gate while loading, then releases it and opens no picker when progress is cancelled', async () => {
    const gate = new OperationGate();
    const running = initializeProject(gate, capabilityWith(() => new Promise(() => {})));
    await vi.waitFor(() => expect(state.cancel).toBeDefined());
    expect(gate.tryAcquire(launchKey)).toBeNull();
    state.cancel?.();
    await running;
    expect(vscodeMock.window.createQuickPick).not.toHaveBeenCalled();
    const again = gate.tryAcquire(launchKey);
    expect(again).not.toBeNull();
    again?.release();
  });

  it('offers Install when the CLI is missing, opens no picker and releases the gate', async () => {
    const gate = new OperationGate();
    await initializeProject(gate, capabilityWith(async () => ({ kind: 'missing', required })));
    await vi.waitFor(() => expect(state.warnings).toHaveLength(1));
    expect(state.warnings[0]).toContain('Install Migent CLI');
    expect(vscodeMock.window.createQuickPick).not.toHaveBeenCalled();
    expect(gate.tryAcquire(launchKey)).not.toBeNull();
  });
});
