import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionDir } from '../../core/paths';

const invoke = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('../../cli/invoke', () => ({ invokeJson: invoke.json, invokeText: vi.fn() }));

const posted = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  handler: undefined as ((raw: unknown) => void) | undefined,
  html: '',
}));
vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  ThemeIcon: class {},
  QuickPickItemKind: { Separator: -1 },
  ProgressLocation: { Notification: 15, Window: 10 },
  workspace: {},
  Uri: {
    file: (f: string) => ({ fsPath: f }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  commands: { executeCommand: vi.fn() },
  window: {
    showErrorMessage: vi.fn(),
    registerWebviewPanelSerializer: () => ({ dispose: () => undefined }),
    createWebviewPanel: () => ({
      title: '',
      viewColumn: 1,
      reveal: () => undefined,
      dispose: () => undefined,
      onDidDispose: () => undefined,
      webview: {
        options: {},
        set html(value: string) {
          posted.html = value;
        },
        cspSource: 'csp',
        asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => uri.fsPath }),
        postMessage: (message: Record<string, unknown>) => {
          posted.messages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: (raw: unknown) => void) => {
          posted.handler = handler;
          return { dispose: () => undefined };
        },
      },
    }),
  },
}));

const { SessionWorkflowPanels } = await import('./panels');

const HASH = 'a'.repeat(64);
const identity = { project: 'k', sessionId: 's1' };
const form = { stages: [{ id: 'plan', role: 'dev' }], artifacts: [], downstream: [] };

function makeRoot(withExecution: boolean, schema = 7): string {
  const root = mkdtempSync(path.join(tmpdir(), 'swp-'));
  const dir = sessionDir(root, 's1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'workflow.yaml'), `schema_version: ${schema}\nid: a\nstages:\n  - id: plan\n    role: dev\n`);
  if (withExecution) mkdirSync(path.join(dir, 'executions', '0001-plan--attempt-01'), { recursive: true });
  return root;
}

function setup(root: string) {
  const context = {
    key: 'k',
    folder: { name: 'p' },
    root,
    store: { snapshot: () => undefined },
    catalog: {
      workflows: () => ({ state: 'empty', error: null, entries: [] }),
      config: () => ({ state: 'missing', error: null, schemaVersion: null, roles: [], agents: [] }),
    },
  };
  const registry = { project: () => context, onDidChange: () => ({ dispose: () => undefined }) };
  const capability = {
    state: () => ({ kind: 'ok', launch: { command: 'migent', prefixArgs: [] } }),
    windowReady: () => Promise.resolve({ kind: 'checking' }),
  };
  const panels = new SessionWorkflowPanels(registry as never, capability as never, { fsPath: '/ext' } as never);
  panels.open(identity);
  const last = (): {
    model: { isLocked: boolean; canSave: boolean };
    transient?: { saving: boolean; error: string | null };
  } => posted.messages.filter((m) => m.type === 'model').at(-1) as never;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
  const save = async (draft: unknown = form): Promise<void> => {
    await settle();
    await panels.handle(identity, { type: 'saveForm', form: draft, baseHash: HASH });
  };
  return { panels, last, save };
}

const envelope = (extra: Record<string, unknown> = {}) => ({
  schema_version: 1,
  valid: true,
  diagnostics: [],
  hash: 'b'.repeat(64),
  written: true,
  ...extra,
});

describe('SessionWorkflowPanels page', () => {
  it('loads the shared workflow form stylesheet, not the editor page stylesheet', () => {
    posted.html = '';
    setup(makeRoot(false));
    expect(posted.html).toContain('workflowform.css');
    expect(posted.html).not.toContain('workfloweditor.css');
  });
});

describe('SessionWorkflowPanels save', () => {
  beforeEach(() => {
    posted.messages = [];
    invoke.json.mockReset();
  });

  it('saves the draft through the session flag with the base hash and reposts the model', async () => {
    const { save, last } = setup(makeRoot(false));
    invoke.json.mockResolvedValue({ kind: 'ok', value: envelope() });
    await save();
    const [, args, options] = invoke.json.mock.calls[0] as [unknown, string[], { input: string }];
    expect(args).toEqual(expect.arrayContaining(['workflow', 'save', '-', '--session', 's1', '--base-hash', HASH]));
    expect(args).not.toContain('--target');
    expect(options.input).toContain('plan');
    expect(last().transient).toMatchObject({ saving: false, error: null });
  });

  it('reports validation errors without a page error', async () => {
    const { save, last } = setup(makeRoot(false));
    const diagnostics = [{ severity: 'error', code: 'x', message: 'bad stage', path: ['stages', 0] }];
    invoke.json.mockResolvedValue({
      kind: 'error',
      error: {
        kind: 'exit',
        detail: '',
        exitCode: 2,
        stderr: '',
        stdout: JSON.stringify(envelope({ valid: false, written: false, diagnostics })),
      },
    });
    await save();
    const message = last() as unknown as {
      model: { validation: { errors: { message: string }[] } };
      transient: { error: string | null };
    };
    expect(message.model.validation.errors.map((e) => e.message)).toEqual(['bad stage']);
    expect(message.transient.error).toBeNull();
  });

  it('asks for a reload on a hash conflict', async () => {
    const { save, last } = setup(makeRoot(false));
    invoke.json.mockResolvedValue({
      kind: 'error',
      error: {
        kind: 'exit',
        detail: '',
        exitCode: 3,
        stderr: '',
        stdout: JSON.stringify(envelope({ valid: true, written: false })),
      },
    });
    await save();
    expect(last().transient?.error).toMatch(/changed on disk/);
  });

  it('refuses a result the CLI did not confirm as written', async () => {
    const { save, last } = setup(makeRoot(false));
    invoke.json.mockResolvedValue({ kind: 'ok', value: envelope({ written: false }) });
    await save();
    expect(last().transient?.error).toMatch(/did not confirm/);
  });

  it('ignores a second request while one save is in flight', async () => {
    const { save } = setup(makeRoot(false));
    let release: (value: unknown) => void = () => undefined;
    invoke.json.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = save();
    await Promise.resolve();
    await save();
    release({ kind: 'ok', value: envelope() });
    await first;
    expect(invoke.json).toHaveBeenCalledTimes(1);
  });

  it('refuses a duplicate artifact id before serializing, keeping the draft', async () => {
    const { save, last } = setup(makeRoot(false));
    await save({
      ...form,
      artifacts: [{ id: 'plan', file: 'a.md' }, { id: 'plan', file: 'b.md' }],
    });
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last().transient?.error).toMatch(/"plan" is used more than once/);
  });

  it('refuses to save a workflow on an older schema, without calling the CLI', async () => {
    const { save, last } = setup(makeRoot(false, 6));
    await save();
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last().model.canSave).toBe(false);
    expect(last().transient?.error).toMatch(/migent migrate/);
  });

  it('refuses to save once a stage has run, without calling the CLI', async () => {
    const { save, last } = setup(makeRoot(true));
    await save();
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last().transient?.error).toMatch(/no longer be changed/);
  });
});
