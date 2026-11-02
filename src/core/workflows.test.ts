import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeProject } from './testHelpers';
import { readWorkflowFile, scanWorkflows } from './workflows';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function bareProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-wf-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.migent'), { recursive: true });
  return root;
}

function writeWorkflow(root: string, file: string, text: string): void {
  const dir = path.join(root, '.migent', 'workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

describe('scanWorkflows', () => {
  it('lists workflow ids and stage ids, sorted by id', () => {
    const root = makeProject();
    dirs.push(root);
    const scan = scanWorkflows(root);
    expect(scan.state).toBe('ok');
    expect(scan.entries.map((row) => row.id)).toEqual(['implement', 'plan']);
    const plan = scan.entries.find((row) => row.id === 'plan');
    expect(plan).toMatchObject({ file: 'plan.yaml', state: 'ok', error: null, title: 'Plan', duplicate: false });
    expect(plan?.stages).toEqual(['plan', 'review_plan']);
    expect(scan.entries.find((row) => row.id === 'implement')?.stages).toEqual(['prepare', 'implement', 'review_work']);
  });

  it('distinguishes a missing directory from an empty one', () => {
    const root = bareProject();
    expect(scanWorkflows(root)).toMatchObject({ state: 'missing', entries: [] });
    mkdirSync(path.join(root, '.migent', 'workflows'));
    writeWorkflow(root, 'notes.txt', 'ignored');
    expect(scanWorkflows(root)).toMatchObject({ state: 'empty', entries: [] });
  });

  it('treats a workflows path that is not a directory as missing', () => {
    const root = bareProject();
    writeFileSync(path.join(root, '.migent', 'workflows'), 'a file, not a directory');
    expect(scanWorkflows(root).state).toBe('missing');
  });

  it('keeps an invalid file listed with its parse error', () => {
    const root = bareProject();
    writeWorkflow(root, 'good.yaml', 'id: good\nstages: []\n');
    writeWorkflow(root, 'broken.yaml', 'id: [unclosed\n');
    const scan = scanWorkflows(root);
    expect(scan.state).toBe('ok');
    const broken = scan.entries.find((row) => row.file === 'broken.yaml');
    expect(broken?.state).toBe('invalid');
    expect(broken?.error).toBeTruthy();
    expect(broken?.id).toBe('broken');
    expect(scan.entries.find((row) => row.file === 'good.yaml')?.state).toBe('ok');
  });

  it('flags every file that shares an id, with no first-file-wins', () => {
    const root = bareProject();
    writeWorkflow(root, 'a.yaml', 'id: same\n');
    writeWorkflow(root, 'b.yml', 'id: same\n');
    writeWorkflow(root, 'c.yaml', 'id: other\n');
    const scan = scanWorkflows(root);
    // Ordered by id, then file name.
    expect(scan.entries.map((row) => [row.file, row.duplicate])).toEqual([
      ['c.yaml', false],
      ['a.yaml', true],
      ['b.yml', true],
    ]);
  });
});

describe('readWorkflowFile', () => {
  it('returns null for a file that no longer exists', () => {
    const root = bareProject();
    mkdirSync(path.join(root, '.migent', 'workflows'));
    expect(readWorkflowFile(root, 'gone.yaml')).toBeNull();
  });

  it('marks a file that cannot be read as unreadable', () => {
    const root = bareProject();
    // A directory named like a workflow cannot be read as a file (EISDIR) on every platform.
    mkdirSync(path.join(root, '.migent', 'workflows', 'dir.yaml'), { recursive: true });
    expect(readWorkflowFile(root, 'dir.yaml')?.state).toBe('unreadable');
  });
});
