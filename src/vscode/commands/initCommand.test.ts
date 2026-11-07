import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityState } from '../../cli/version';
import { OperationGate } from '../../core/operationGate';
import type { CapabilityService } from '../capability';

const invoke = vi.hoisted(() => ({ json: vi.fn(), text: vi.fn() }));
vi.mock('../../cli/invoke', () => ({ invokeJson: invoke.json, invokeText: invoke.text }));

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

const required = '0.4.1';
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

  describe('discovery', () => {
    const launch = { command: 'migent', args: [] };
    const ok = { kind: 'ok', launch, required, detected: required } as unknown as CapabilityState;
    const providerRows = [
      { name: 'claude', default_client: 'claude-code', requires_client: false },
      { name: 'codex', default_client: 'codex', requires_client: false },
      { name: 'byteplus', default_client: null, requires_client: true },
    ];
    const modelRows = [
      { name: 'sonnet', client: 'claude-code', default: false },
      { name: 'opus', client: 'claude-code', default: true },
      { name: 'ark', client: 'byteplus', default: true },
    ];

    /** Answers `get providers` and `get models`; `undefined` makes that command fail. */
    function discovery(providers: unknown, models: unknown): void {
      invoke.json.mockImplementation((_launch: unknown, args: string[]) => {
        const value = args[1] === 'providers' ? providers : models;
        return Promise.resolve(
          value === undefined
            ? { kind: 'error', error: { kind: 'exit', detail: 'exit 1', stderr: '' } }
            : { kind: 'ok', value },
        );
      });
    }

    /** A Quick Pick whose first accept takes the highlighted item with the "for all roles" button. */
    function pickAllWithFirstModel(): { shown: { label: string; model?: unknown }[][] } {
      const shown: { label: string; model?: unknown }[][] = [];
      vscodeMock.window.createQuickPick.mockImplementation(() => {
        const handlers: { button?: () => void } = {};
        const input = {
          items: [] as { label: string; model?: unknown }[],
          selectedItems: [] as { model?: unknown }[],
          activeItems: [] as { model?: unknown }[],
          onDidAccept: () => ({ dispose: () => {} }),
          onDidHide: () => ({ dispose: () => {} }),
          onDidTriggerButton: (listener: () => void) => {
            handlers.button = listener;
            return { dispose: () => {} };
          },
          show: () => {
            shown.push(input.items);
            input.activeItems = [input.items.find((item) => item.model !== undefined) ?? {}];
            handlers.button?.();
          },
          hide: () => {},
          dispose: () => {},
        };
        return input;
      });
      return { shown };
    }

    async function run(): Promise<void> {
      await initializeProject(new OperationGate(), capabilityWith(() => Promise.resolve(ok)));
    }

    it('offers the providers init accepts, default model first, and initializes with the pick', async () => {
      discovery(providerRows, modelRows);
      invoke.text.mockResolvedValue({ kind: 'ok', value: '' });
      const { shown } = pickAllWithFirstModel();
      await run();
      expect(invoke.json.mock.calls.map((call) => call[1])).toEqual([
        ['get', 'providers', '--json'],
        ['get', 'models', '--json'],
      ]);
      // codex has no models and byteplus requires a client: only claude is offered, its default first.
      expect(shown[0].filter((item) => item.model !== undefined).map((item) => item.label)).toEqual([
        'claude · opus',
        'claude · sonnet',
      ]);
      const args = invoke.text.mock.calls[0][1] as string[];
      expect(args).toEqual(expect.arrayContaining(['init', '--no-input', '--provider', 'claude', '--model', 'opus']));
    });

    it('uses a partial catalog as is', async () => {
      discovery(providerRows, [{ name: 'gpt', client: 'codex', default: true }]);
      invoke.text.mockResolvedValue({ kind: 'ok', value: '' });
      const { shown } = pickAllWithFirstModel();
      await run();
      expect(shown[0].filter((item) => item.model !== undefined).map((item) => item.label)).toEqual(['codex · gpt']);
    });

    it.each([
      ['get providers fails', undefined, modelRows],
      ['get models fails', providerRows, undefined],
      ['no client has models', providerRows, []],
      ['only a client-required provider has models', providerRows, [{ name: 'ark', client: 'byteplus' }]],
    ])('shows the no-provider error and opens no picker when %s', async (_name, providers, models) => {
      discovery(providers, models);
      await run();
      expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(
        'No provider with models is available. Install a provider CLI first.',
      );
      expect(vscodeMock.window.createQuickPick).not.toHaveBeenCalled();
      expect(invoke.text).not.toHaveBeenCalled();
    });
  });
});
