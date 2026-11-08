import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LaunchSpec } from '../../cli/locate';

const invoke = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('../../cli/invoke', () => ({ invokeJson: invoke.json, invokeText: vi.fn() }));
vi.mock('vscode', () => ({ ThemeIcon: class {}, window: {}, workspace: {}, commands: {} }));

const { createWorkflowCopy } = await import('./workflowCopy');

const launch: LaunchSpec = { command: 'migent', prefixArgs: [], via: 'native' };
const text = '# keep me\nschema_version: 7\nid: b\nstages: []\n';
const root = '/project';

beforeEach(() => {
  invoke.json.mockReset();
});

const written = { valid: true, diagnostics: [], written: true };

describe('createWorkflowCopy', () => {
  it('saves through the CLI without a base hash, so it only creates', async () => {
    invoke.json.mockResolvedValue({ kind: 'ok', value: written });
    expect(await createWorkflowCopy(launch, root, { file: 'b.yaml', text })).toBeNull();
    const [, args, options] = invoke.json.mock.calls[0] as [unknown, string[], { input: string }];
    expect(args).toEqual(expect.arrayContaining(['workflow', 'save', '-', '--target', 'b.yaml']));
    expect(args).not.toContain('--base-hash');
    expect(options.input).toBe(text);
  });

  it('reports the CLI error and a save it did not confirm', async () => {
    invoke.json.mockResolvedValueOnce({
      kind: 'error',
      error: {
        kind: 'exit',
        detail: '',
        exitCode: 1,
        stderr: '',
        stdout: JSON.stringify({
          valid: false,
          diagnostics: [{ severity: 'error', code: 'duplicate-id', message: 'id used twice', path: ['id'] }],
        }),
      },
    });
    expect(await createWorkflowCopy(launch, root, { file: 'b.yaml', text })).toBe('id used twice');
    invoke.json.mockResolvedValueOnce({ kind: 'ok', value: { valid: true, diagnostics: [], written: false } });
    expect(await createWorkflowCopy(launch, root, { file: 'b.yaml', text })).toMatch(/did not confirm/);
  });
});
