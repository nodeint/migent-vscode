import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionSnapshot } from '../../core/model';
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
    file: (file: string) => ({ fsPath: file }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  commands: { executeCommand: vi.fn() },
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    registerWebviewPanelSerializer: () => ({ dispose: () => undefined }),
    createWebviewPanel: () => ({
      title: '',
      viewColumn: 1,
      active: true,
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

const { SessionPanels } = await import('./panels');
type SessionPanelsDeps = import('./panels').SessionPanelsDeps;

const HASH = 'a'.repeat(64);
const identity = { project: 'k', sessionId: 's1' };
const form = { stages: [{ id: 'plan', role: 'dev' }], artifacts: [], downstream: [] };

function makeRoot(withExecution: boolean, schema = 7): string {
  const root = mkdtempSync(path.join(tmpdir(), 'session-'));
  const dir = sessionDir(root, 's1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'workflow.yaml'), `schema_version: ${schema}\nid: a\nstages:\n  - id: plan\n    role: dev\n`);
  if (withExecution) mkdirSync(path.join(dir, 'executions', '0001-plan--attempt-01'), { recursive: true });
  return root;
}

function question(id: string, executionId: string, stageId: string) {
  return {
    id,
    question: `Question ${id}`,
    context: null,
    selection: 'single',
    options: [{ id: 'A', label: 'A', description: null }],
    recommended: [],
    executionId,
    stageId,
    recipient: 'human',
    file: null,
  };
}

function snapshot(questions: ReturnType<typeof question>[] = []): SessionSnapshot {
  return {
    sessionId: 's1',
    manifest: { title: 'Session', workflowId: 'wf', raw: {} },
    status: { workflowId: 'wf', questions, runningStages: [], outputs: [] },
    displayState: { state: 'question', icon: '', writable: true },
    replyTargets: [],
  } as unknown as SessionSnapshot;
}

const QUESTIONS = [question('1', '0001-plan--attempt-01', 'plan'), question('2', '0002-review--attempt-01', 'review')];

function setup(root: string, current: SessionSnapshot | undefined = undefined) {
  const context = {
    key: 'k',
    folder: { name: 'p' },
    root,
    store: {
      snapshot: () => current,
      all: () => (current === undefined ? [] : [current]),
      scanOutcome: { eligible: [] },
    },
    catalog: {
      workflows: () => ({ state: 'empty', error: null, entries: [] }),
      config: () => ({ state: 'missing', error: null, schemaVersion: null, roles: [], agents: [] }),
    },
    watcher: { retain: () => ({ dispose: () => undefined }) },
  };
  const registry = { project: () => context, onDidChange: () => ({ dispose: () => undefined }) };
  const capability = {
    state: () => ({ kind: 'ok', launch: { command: 'migent', prefixArgs: [] } }),
    windowReady: () => Promise.resolve({ kind: 'checking' }),
  };
  const data = new Map<string, unknown>();
  const deps = {
    capability,
    control: { showLog: vi.fn(), answerBlock: () => null, continueSession: vi.fn() },
    submitter: { pending: () => null },
    extensionUri: { fsPath: '/ext' },
    memento: {
      get: (key: string) => data.get(key),
      update: (key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      },
    },
  };
  const panels = new SessionPanels(registry as never, deps as unknown as SessionPanelsDeps);
  const last = () =>
    posted.messages.filter((message) => message.type === 'model').at(-1) as
      | {
          model: {
            tab: string;
            header: { title: string; state: string };
            workflow?: { isLocked: boolean; canSave: boolean; validation: { errors: { message: string }[] } };
            questions?: { model: { questions: { id: string }[] } | null; selected: { executionId: string } | null };
          };
          transient?: { saving: boolean; error: string | null };
        }
      | undefined;
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

beforeEach(() => {
  posted.messages = [];
  invoke.json.mockReset();
});

describe('SessionPanels tabs', () => {
  it('opens on Results by default and switches in place', async () => {
    const { panels, last } = setup(makeRoot(false), snapshot());
    panels.open(identity);
    expect(last()?.model.tab).toBe('results');
    await panels.handle(identity, { type: 'intent', intent: 'selectTab', tab: 'metrics' });
    expect(last()?.model.tab).toBe('metrics');
  });

  it('reposts an unchanged model on ready without a new revision', async () => {
    const { panels, last } = setup(makeRoot(false), snapshot());
    panels.open(identity);
    const revision = panels.revision(identity);
    const models = posted.messages.filter((message) => message.type === 'model');
    await panels.handle(identity, { type: 'ready' });
    expect(panels.revision(identity)).toBe(revision);
    expect(posted.messages.filter((message) => message.type === 'model')).toHaveLength(models.length + 1);
    expect(posted.messages.filter((message) => message.type === 'model').at(-1)?.revision).toBe(revision);
    expect(last()?.model.tab).toBe('results');
  });

  it('bumps the revision when a publish carries a changed model', async () => {
    const { panels } = setup(makeRoot(false), snapshot());
    panels.open(identity);
    const revision = panels.revision(identity);
    await panels.handle(identity, { type: 'intent', intent: 'selectTab', tab: 'metrics' });
    expect(panels.revision(identity)).toBe(revision + 1);
  });

  it('loads the shared workflow form stylesheet, not the editor page stylesheet', () => {
    posted.html = '';
    const { panels } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
    expect(posted.html).toContain('workflowForm.css');
    expect(posted.html).not.toContain('workflowEditor.css');
  });

  it('shows the latest pending batch with every batch available', async () => {
    const { panels, last } = setup(makeRoot(false), snapshot(QUESTIONS));
    panels.open(identity, { tab: 'questions' });
    const model = last()?.model.questions;
    expect(model?.selected?.executionId).toBe('0002-review--attempt-01');
    expect(model?.model?.questions.map((item) => item.id)).toEqual(['2']);
  });

  it('switches batches without closing the page', async () => {
    const { panels, last } = setup(makeRoot(false), snapshot(QUESTIONS));
    panels.open(identity, { tab: 'questions' });
    await panels.handle(identity, {
      type: 'intent',
      intent: 'selectBatch',
      batch: { stageId: 'plan', executionId: '0001-plan--attempt-01' },
    });
    const model = last()?.model.questions;
    expect(model?.selected?.executionId).toBe('0001-plan--attempt-01');
    expect(model?.model?.questions.map((item) => item.id)).toEqual(['1']);
  });

  it('keeps one panel per session when opened twice', () => {
    const { panels } = setup(makeRoot(false), snapshot());
    panels.open(identity);
    panels.open(identity, { tab: 'metrics' });
    expect(panels.count).toBe(1);
  });
});

describe('SessionPanels workflow save', () => {
  it('saves the draft through the session flag with the base hash and reposts the model', async () => {
    const { panels, save, last } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
    invoke.json.mockResolvedValue({ kind: 'ok', value: envelope() });
    await save();
    const [, args, options] = invoke.json.mock.calls[0] as [unknown, string[], { input: string }];
    expect(args).toEqual(expect.arrayContaining(['workflow', 'save', '-', '--session', 's1', '--base-hash', HASH]));
    expect(args).not.toContain('--target');
    expect(options.input).toContain('plan');
    expect(last()?.transient).toMatchObject({ saving: false, error: null });
  });

  it('reports validation errors without a page error', async () => {
    const { panels, save, last } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
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
    expect(last()?.model.workflow?.validation.errors.map((item) => item.message)).toEqual(['bad stage']);
    expect(last()?.transient?.error).toBeNull();
  });

  it('asks for a reload on a hash conflict', async () => {
    const { panels, save, last } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
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
    expect(last()?.transient?.error).toMatch(/changed on disk/);
  });

  it('refuses a result the CLI did not confirm as written', async () => {
    const { panels, save, last } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
    invoke.json.mockResolvedValue({ kind: 'ok', value: envelope({ written: false }) });
    await save();
    expect(last()?.transient?.error).toMatch(/did not confirm/);
  });

  it('ignores a second request while one save is in flight', async () => {
    const { panels, save } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
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
    const { panels, save, last } = setup(makeRoot(false));
    panels.open(identity, { tab: 'workflow' });
    await save({
      ...form,
      artifacts: [
        { id: 'plan', file: 'a.md' },
        { id: 'plan', file: 'b.md' },
      ],
    });
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last()?.transient?.error).toMatch(/"plan" is used more than once/);
  });

  it('refuses to save a workflow on an older schema, without calling the CLI', async () => {
    const { panels, save, last } = setup(makeRoot(false, 6));
    panels.open(identity, { tab: 'workflow' });
    await save();
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last()?.model.workflow?.canSave).toBe(false);
    expect(last()?.transient?.error).toMatch(/migent migrate/);
  });

  it('refuses to save once a stage has run, without calling the CLI', async () => {
    const { panels, save, last } = setup(makeRoot(true));
    panels.open(identity, { tab: 'workflow' });
    await save();
    expect(invoke.json).not.toHaveBeenCalled();
    expect(last()?.transient?.error).toMatch(/no longer be changed/);
  });
});
