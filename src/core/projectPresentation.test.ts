import { describe, expect, it } from 'vitest';

import { configRow, projectRelative, workflowRow, workflowsDiagnostic } from './projectPresentation';
import type { WorkflowEntry } from './workflows';

const entry = (overrides: Partial<WorkflowEntry> = {}): WorkflowEntry => ({
  id: 'plan',
  file: 'plan.yaml',
  state: 'ok',
  error: null,
  title: null,
  stages: [],
  duplicate: false,
  ...overrides,
});

describe('workflowsDiagnostic', () => {
  it('reports missing, empty and unreadable as distinct rows and nothing for entries', () => {
    expect(workflowsDiagnostic({ state: 'missing', error: null, entries: [] })?.label).toBe('No workflows directory');
    expect(workflowsDiagnostic({ state: 'empty', error: null, entries: [] })?.label).toBe('No workflows');
    const unreadable = workflowsDiagnostic({ state: 'unreadable', error: 'EACCES', entries: [] });
    expect(unreadable).toMatchObject({ code: 'workflows-unreadable', detail: 'EACCES' });
    expect(workflowsDiagnostic({ state: 'ok', error: null, entries: [entry()] })).toBeNull();
  });
});

describe('workflowRow', () => {
  it('labels a valid workflow by id with its path and stages in the tooltip', () => {
    const row = workflowRow(entry({ title: 'Plan it', stages: ['a', 'b'] }), '.migent/workflows/plan.yaml');
    expect(row).toMatchObject({ label: 'plan', description: 'Plan it', contextValue: 'workflow.ok' });
    expect(row.tooltip).toContain('.migent/workflows/plan.yaml');
    expect(row.tooltip).toContain('a → b');
  });

  it('marks unreadable files and flags duplicate ids on every affected file', () => {
    expect(workflowRow(entry({ state: 'unreadable', error: 'EACCES' }), 'p').contextValue).toBe('workflow.unreadable');
    const duplicate = workflowRow(entry({ duplicate: true }), '.migent/workflows/plan.yaml');
    expect(duplicate.description).toBe('duplicate id · plan.yaml');
    expect(duplicate.icon).toBe('warning');
    expect(duplicate.contextValue).toBe('workflow.ok');
  });
});

describe('configRow', () => {
  it('shows each state with a matching context value', () => {
    const path = '.migent/config.yaml';
    expect(configRow({ state: 'ok', error: null, schemaVersion: 2 }, path)).toMatchObject({
      label: 'config.yaml',
      description: 'schema 2',
      contextValue: 'config.ok',
    });
    expect(configRow({ state: 'ok', error: null, schemaVersion: null }, path).description).toBeUndefined();
    const missing = configRow({ state: 'missing', error: null, schemaVersion: null }, path);
    expect(missing).toMatchObject({ description: 'not found', contextValue: 'config.missing' });
    expect(missing.tooltip).toContain(path);
    expect(configRow({ state: 'invalid', error: 'boom', schemaVersion: null }, path)).toMatchObject({
      description: 'boom',
      contextValue: 'config.invalid',
    });
    expect(configRow({ state: 'unreadable', error: 'EACCES', schemaVersion: null }, path).contextValue).toBe(
      'config.unreadable',
    );
  });
});

describe('projectRelative', () => {
  it('uses forward slashes', () => {
    expect(projectRelative('/a/b', '/a/b/.migent/config.yaml')).toBe('.migent/config.yaml');
  });
});
