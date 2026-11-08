import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { WorkflowEditorModel } from '../../core/workflowEditor';
const host = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  restore: undefined as undefined | ((panel: unknown, state: unknown) => Promise<void>),
}));

function fakePanel() {
  return {
    title: '',
    viewColumn: 1,
    reveal: () => undefined,
    dispose: () => undefined,
    onDidDispose: () => undefined,
    webview: {
      options: {},
      html: '',
      cspSource: 'csp',
      asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => uri.fsPath }),
      postMessage: (message: Record<string, unknown>) => {
        host.messages.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
    },
  };
}

vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  ThemeIcon: class {},
  QuickPickItemKind: { Separator: -1 },
  ProgressLocation: { Notification: 15, Window: 10 },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: {
    file: (f: string) => ({ fsPath: f }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  commands: { executeCommand: vi.fn() },
  window: {
    showErrorMessage: vi.fn(),
    registerWebviewPanelSerializer: (
      _type: string,
      serializer: { deserializeWebviewPanel: (panel: unknown, state: unknown) => Promise<void> },
    ) => {
      host.restore = serializer.deserializeWebviewPanel;
      return { dispose: () => undefined };
    },
    createWebviewPanel: () => fakePanel(),
  },
}));

const { saveArgs, saveRefusal, isWorkflowEditorIdentity, WorkflowEditorPanels } = await import('./panels');

const identity = { project: 'k', file: 'plan.yaml' };
const model = (canSave: boolean): Pick<WorkflowEditorModel, 'canSave'> => ({ canSave });

describe('saveRefusal', () => {
  it('refuses a save before any model was published, whatever the page asks', () => {
    expect(saveRefusal(identity, null)).toMatch(/cannot be saved/);
  });

  it('refuses an unsupported or unreadable model and points to migrate', () => {
    expect(saveRefusal(identity, model(false))).toMatch(/migent migrate/);
  });

  it('refuses a file that is not .yaml even on a savable model', () => {
    expect(saveRefusal({ ...identity, file: 'plan.yml' }, model(true))).toMatch(/\.yaml/);
  });

  it('allows a savable .yaml model', () => {
    expect(saveRefusal(identity, model(true))).toBeNull();
  });
});

describe('saveArgs', () => {
  it('creates without a base hash and replaces with one', () => {
    expect(saveArgs('a.yaml', null)).not.toContain('--base-hash');
    expect(saveArgs('a.yaml', 'h')).toEqual(expect.arrayContaining(['--base-hash', 'h', '--preserve-comments']));
  });
});

function setup(roles: string[] = ['developer']) {
  const root = mkdtempSync(path.join(tmpdir(), 'wfe-'));
  mkdirSync(path.join(root, '.migent', 'workflows'), { recursive: true });
  const context = {
    key: 'k',
    folder: { name: 'p' },
    root,
    catalog: {
      workflows: () => ({ state: 'empty', error: null, entries: [] }),
      config: () => ({ state: 'ok', error: null, schemaVersion: 7, roles, agents: [] }),
      reloadWorkflow: () => undefined,
    },
  };
  const registry = { project: () => context, onDidChange: () => ({ dispose: () => undefined }) };
  const capability = {
    state: () => ({ kind: 'ok', launch: { command: 'migent', prefixArgs: [] } }),
    windowReady: () => Promise.resolve({ kind: 'checking' }),
  };
  host.messages = [];
  const panels = new WorkflowEditorPanels(registry as never, capability as never, { fsPath: '/ext' } as never);
  const last = () =>
    host.messages.filter((m) => m.type === 'model').at(-1) as { identity: Record<string, unknown>; model: { mode: string; canSave: boolean } };
  return { root, panels, last };
}

describe('unsaved workflow draft lifecycle', () => {
  it('opens a new draft and persists the draft flag in the page identity', () => {
    const { panels, last } = setup();
    panels.open({ project: 'k', file: 'fresh.yaml' }, { isNew: true });
    expect(last().model).toMatchObject({ mode: 'new', canSave: true });
    expect(last().identity).toMatchObject({ project: 'k', file: 'fresh.yaml', isNew: true });
  });

  it('restores an unsaved draft as a new draft after a window reload', async () => {
    const { panels, last } = setup();
    await host.restore?.(fakePanel(), { project: 'k', file: 'fresh.yaml', isNew: true });
    expect(panels.count).toBe(1);
    expect(last().model).toMatchObject({ mode: 'new', canSave: true });
  });

  it('restores an ordinary page as an edit page, and a draft whose file now exists as an edit page', async () => {
    const { panels, root, last } = setup();
    await host.restore?.(fakePanel(), { project: 'k', file: 'plain.yaml' });
    expect(last().model.mode).toBe('edit');
    writeFileSync(
      path.join(root, '.migent', 'workflows', 'there.yaml'),
      'schema_version: 7\nid: there\nstages:\n  - id: s\n    role: developer\n',
    );
    await host.restore?.(fakePanel(), { project: 'k', file: 'there.yaml', isNew: true });
    expect(last().model).toMatchObject({ mode: 'edit', canSave: true });
    expect(last().identity).not.toHaveProperty('isNew');
    expect(panels.count).toBe(2);
  });
});

describe('workflow editor identity', () => {
  it('rejects an unsafe file even when the draft flag is set', () => {
    expect(isWorkflowEditorIdentity({ project: 'k', file: 'new.yaml', isNew: true })).toBe(true);
    expect(isWorkflowEditorIdentity({ project: 'k', file: '../x.yaml', isNew: true })).toBe(false);
  });
});
