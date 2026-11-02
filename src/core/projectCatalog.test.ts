import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectChangeEvent } from './model';
import { ProjectCatalog } from './projectCatalog';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-cat-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.migent', 'workflows'), { recursive: true });
  return root;
}

const workflowFile = (root: string, file: string): string => path.join(root, '.migent', 'workflows', file);

function observe(catalog: ProjectCatalog, run: () => void): ProjectChangeEvent[] {
  const events: ProjectChangeEvent[] = [];
  const unsubscribe = catalog.onDidChange((event) => events.push(event));
  try {
    run();
  } finally {
    unsubscribe();
  }
  return events;
}

describe('ProjectCatalog', () => {
  it('loads workflows and config, emitting once per changed kind', () => {
    const root = project();
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: a\n');
    writeFileSync(path.join(root, '.migent', 'config.yaml'), 'schema_version: 1\n');
    const catalog = new ProjectCatalog(root);
    const events = observe(catalog, () => {
      catalog.load();
    });
    expect(events.map((event) => event.kind).sort()).toEqual(['config', 'workflows']);
    expect(catalog.workflows().entries.map((entry) => entry.id)).toEqual(['a']);
    expect(catalog.config().schemaVersion).toBe(1);
    expect(observe(catalog, () => {
      catalog.load();
    })).toEqual([]);
  });

  it('reloads only the named file and tracks create, edit and delete', () => {
    const root = project();
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: a\n');
    writeFileSync(workflowFile(root, 'b.yaml'), 'id: b\n');
    const catalog = new ProjectCatalog(root);
    catalog.load();

    // b.yaml changes on disk but only a.yaml is reloaded: b's cached entry stays.
    writeFileSync(workflowFile(root, 'b.yaml'), 'id: b-renamed\n');
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: a2\n');
    const edit = observe(catalog, () => {
      catalog.reloadWorkflow('a.yaml');
    });
    expect(edit).toEqual([{ project: root, kind: 'workflows' }]);
    expect(catalog.workflows().entries.map((entry) => entry.id)).toEqual(['a2', 'b']);

    writeFileSync(workflowFile(root, 'c.yml'), 'id: c\n');
    catalog.reloadWorkflow('c.yml');
    expect(catalog.workflows().entries.map((entry) => entry.file)).toEqual(['a.yaml', 'b.yaml', 'c.yml']);

    rmSync(workflowFile(root, 'c.yml'));
    catalog.reloadWorkflow('c.yml');
    expect(catalog.workflows().entries.map((entry) => entry.file)).toEqual(['a.yaml', 'b.yaml']);
  });

  it('recomputes duplicate flags across files on a single-file reload', () => {
    const root = project();
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: x\n');
    const catalog = new ProjectCatalog(root);
    catalog.load();
    writeFileSync(workflowFile(root, 'b.yaml'), 'id: x\n');
    catalog.reloadWorkflow('b.yaml');
    expect(catalog.workflows().entries.map((entry) => entry.duplicate)).toEqual([true, true]);
    rmSync(workflowFile(root, 'b.yaml'));
    catalog.reloadWorkflow('b.yaml');
    expect(catalog.workflows().entries.map((entry) => entry.duplicate)).toEqual([false]);
  });

  it('moves to empty when the last workflow is deleted, and ignores non-workflow names', () => {
    const root = project();
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: a\n');
    const catalog = new ProjectCatalog(root);
    catalog.load();
    rmSync(workflowFile(root, 'a.yaml'));
    catalog.reloadWorkflow('a.yaml');
    expect(catalog.workflows().state).toBe('empty');
    expect(observe(catalog, () => {
      catalog.reloadWorkflow('README.md');
    })).toEqual([]);
  });

  it('rescans when the workflows directory appears after being missing', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-cat-'));
    dirs.push(root);
    mkdirSync(path.join(root, '.migent'));
    const catalog = new ProjectCatalog(root);
    catalog.load();
    expect(catalog.workflows().state).toBe('missing');
    mkdirSync(path.join(root, '.migent', 'workflows'));
    writeFileSync(workflowFile(root, 'a.yaml'), 'id: a\n');
    catalog.reloadWorkflow('a.yaml');
    expect(catalog.workflows()).toMatchObject({ state: 'ok' });
  });

  it('reloads config alone and reports each state change', () => {
    const root = project();
    const catalog = new ProjectCatalog(root);
    catalog.load();
    expect(catalog.config().state).toBe('missing');
    writeFileSync(path.join(root, '.migent', 'config.yaml'), 'a: [bad\n');
    expect(observe(catalog, () => {
      catalog.reloadConfig();
    })).toEqual([{ project: root, kind: 'config' }]);
    expect(catalog.config().state).toBe('invalid');
  });
});
