import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  restore: undefined as undefined | ((panel: unknown, state: unknown) => Promise<void>),
  opened: [] as string[],
  invoked: [] as { args: readonly string[]; input: string | undefined }[],
  next: undefined as undefined | ((args: readonly string[]) => unknown),
  created: 0,
  revealed: 0,
}));

function fakePanel() {
  return {
    title: '',
    viewColumn: 1,
    reveal: () => {
      host.revealed += 1;
    },
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
    createWebviewPanel: () => {
      host.created += 1;
      return fakePanel();
    },
  },
}));

vi.mock('../openFile', () => ({
  openFile: (file: string) => {
    host.opened.push(file);
    return Promise.resolve();
  },
}));

vi.mock('../../cli/invoke', () => ({
  invokeJson: (_launch: unknown, args: readonly string[], options: { input?: string }) => {
    host.invoked.push({ args, input: options.input });
    return Promise.resolve(host.next?.(args) ?? { kind: 'error', error: { exitCode: 2, stderr: 'boom', stdout: '' } });
  },
}));

const { isConfigIdentity, saveArgs, ConfigPanels, validationOf } = await import('./panels');

const HASH = 'a'.repeat(64);
const written = { kind: 'ok', value: { schema_version: 1, valid: true, diagnostics: [], written: true, hash: 'c'.repeat(64) } };

function setup(files: Record<string, string> = { 'config.yaml': 'schema_version: 7\nroles:\n  dev:\n    agent: fast\nagents:\n  fast:\n    model: m\n' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'config-panels-'));
  mkdirSync(path.join(root, '.migent'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, '.migent', name), content);
  const context = { key: 'k', folder: { name: 'p' }, root };
  const registry = { project: () => context, onDidChange: () => ({ dispose: () => undefined }) };
  const capability = {
    state: () => ({ kind: 'ok', launch: { command: 'migent', prefixArgs: [] } }),
    windowReady: () => Promise.resolve({ kind: 'ok', launch: { command: 'migent', prefixArgs: [] } }),
  };
  host.messages = [];
  host.opened = [];
  host.invoked = [];
  host.next = undefined;
  host.created = 0;
  host.revealed = 0;
  const panels = new ConfigPanels(registry as never, capability as never, { fsPath: '/ext' } as never);
  const last = () => host.messages.filter((m) => m.type === 'model').at(-1) as { identity: Record<string, unknown>; model: Record<string, any>; transient?: Record<string, unknown> };
  return { root, panels, last };
}

describe('Configuration panel identity and restore', () => {
  it('accepts only a project and a known tab', () => {
    expect(isConfigIdentity({ project: 'k', tab: 'local' })).toBe(true);
    expect(isConfigIdentity({ project: 'k', tab: 'yaml' })).toBe(false);
    expect(isConfigIdentity({ project: '', tab: 'project' })).toBe(false);
  });

  it('opens one panel per project and reveals it on the next open', () => {
    const { panels } = setup();
    panels.open('k');
    panels.open('k', 'local');
    expect(host.created).toBe(1);
    expect(host.revealed).toBe(1);
    expect(panels.count).toBe(1);
  });

  it('restores the panel with its project and tab, and rejects a bad state', async () => {
    const { panels, last } = setup();
    await host.restore?.(fakePanel(), { project: 'k', tab: 'local' });
    expect(panels.count).toBe(1);
    expect(last().model.tab).toBe('local');
    await host.restore?.(fakePanel(), { project: 'k', tab: 'nope' });
    expect(panels.count).toBe(1);
  });
});

describe('Configuration model', () => {
  it('reports both files and an empty local draft when config.local.yaml is missing', () => {
    const { panels, last } = setup();
    panels.open('k');
    expect(last().model.tabs.project).toMatchObject({ state: 'ok', exists: true });
    expect(last().model.tabs.local).toMatchObject({ state: 'missing', exists: false });
    expect(last().model.agentNames).toEqual(['fast']);
  });

  it('opens a project whose config.yaml is missing with an explicit missing state', () => {
    const { panels, last } = setup({});
    panels.open('k');
    expect(last().model.tabs.project).toMatchObject({ state: 'missing', exists: false });
  });
});

describe('openFile', () => {
  it('opens the active scope\'s file and refuses a missing local file', async () => {
    const { panels, root } = setup();
    panels.open('k');
    await panels.handle('k', { type: 'openFile', tab: 'project' });
    await panels.handle('k', { type: 'openFile', tab: 'local' });
    expect(host.opened).toEqual([path.join(root, '.migent', 'config.yaml')]);
  });
});

describe('saveArgs', () => {
  it('adds the base hash exactly when the draft replaces a file', () => {
    expect(saveArgs('local', { kind: 'create' })).not.toContain('--base-hash');
    expect(saveArgs('local', { kind: 'replace', hash: HASH })).toEqual(expect.arrayContaining(['--base-hash', HASH]));
    expect(saveArgs('project', { kind: 'create' })).toEqual(
      expect.arrayContaining(['config', 'save', '-', '--scope', 'project', '--format', 'yaml', '--preserve-comments', '--json']),
    );
  });
});

describe('Configuration save', () => {
  const form = { schemaVersion: 7, agents: [{ name: 'a', agent: { model: 'm', extra: {} } }], roles: [], extra: {} };

  it('creates the local file without a base hash even when it exists now, and the CLI decides', async () => {
    const { panels, last } = setup({ 'config.yaml': 'schema_version: 7\n', 'config.local.yaml': 'schema_version: 7\n' });
    panels.open('k');
    host.next = () => ({ kind: 'error', error: { exitCode: 2, stderr: '', stdout: JSON.stringify({ schema_version: 1, valid: false, diagnostics: [{ severity: 'error', message: 'exists', code: 'x' }] }) } });
    await panels.handle('k', { type: 'saveForm', tab: 'local', form, base: { kind: 'create' } });
    expect(host.invoked[0].args).not.toContain('--base-hash');
    expect(host.invoked[0].args).toEqual(expect.arrayContaining(['--scope', 'local']));
    expect(last().model.tabs.local.validation.errors[0].message).toBe('exists');
  });

  it('replaces with the draft\'s own hash even after the file was deleted', async () => {
    const { panels } = setup();
    panels.open('k');
    host.next = () => written;
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(host.invoked[0].args).toEqual(expect.arrayContaining(['--base-hash', HASH, '--scope', 'project']));
    expect(host.invoked[0].input).toContain('schema_version: 7');
  });

  it('counts only a written, versioned envelope as saved', async () => {
    const { panels, last } = setup();
    panels.open('k');
    host.next = () => ({ kind: 'ok', value: { schema_version: 1, valid: true, diagnostics: [], written: false } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient?.error).toMatch(/did not confirm/);
    host.next = () => ({ kind: 'ok', value: { ...written.value, schema_version: undefined } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient?.error).toMatch(/did not confirm/);
    host.next = () => ({ kind: 'ok', value: { ...written.value, schema_version: 2 } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient?.error).toMatch(/did not confirm/);
    host.next = () => written;
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient).toMatchObject({ error: null, saved: 'project' });
  });

  it('keeps the draft on a conflict and on invalid diagnostics', async () => {
    const { panels, last } = setup();
    panels.open('k');
    host.next = () => ({ kind: 'error', error: { exitCode: 3, stderr: '', stdout: JSON.stringify({ schema_version: 1, valid: true, diagnostics: [], current_hash: 'd' }) } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient?.error).toMatch(/changed on disk/);
    host.next = () => ({ kind: 'error', error: { exitCode: 2, stderr: '', stdout: JSON.stringify({ schema_version: 1, valid: false, diagnostics: [{ severity: 'error', message: 'bad', code: 'c', path: ['agents'] }] }) } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().model.tabs.project.validation.errors).toEqual([{ path: 'agents', message: 'bad' }]);
    const first = (last().transient?.result as { seq: number }).seq;
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'replace', hash: HASH } });
    expect(last().transient?.result).toEqual({ tab: 'project', seq: first + 1 });
  });

  it('rejects a save with a missing or malformed intent and never creates config.yaml', async () => {
    const { panels } = setup();
    panels.open('k');
    host.next = () => written;
    await panels.handle('k', { type: 'saveForm', tab: 'local', form });
    await panels.handle('k', { type: 'saveForm', tab: 'local', form, base: { kind: 'replace', hash: 'x' } });
    await panels.handle('k', { type: 'saveForm', tab: 'project', form, base: { kind: 'create' } });
    expect(host.invoked).toHaveLength(0);
  });

  it('refuses a repeated agent name before the CLI sees it', async () => {
    const { panels } = setup();
    panels.open('k');
    const twice = { ...form, agents: [form.agents[0], form.agents[0]] };
    await panels.handle('k', { type: 'saveForm', tab: 'project', form: twice, base: { kind: 'replace', hash: HASH } });
    expect(host.invoked).toHaveLength(0);
  });
});

describe('validationOf', () => {
  it('labels a diagnostic from the other layer with its file', () => {
    const diagnostics = [
      { severity: 'error' as const, code: 'c', message: 'own', path: 'roles', source: 'local' },
      { severity: 'error' as const, code: 'c', message: 'other', path: 'roles.dev.agent', source: 'project' },
      { severity: 'warning' as const, code: 'w', message: 'none', path: '' },
    ];
    expect(validationOf(diagnostics, 'local')).toEqual({
      errors: [
        { path: 'roles', message: 'own' },
        { path: 'roles.dev.agent', message: 'other', file: 'config.yaml' },
      ],
      warnings: [{ path: '', message: 'none' }],
    });
  });
});
