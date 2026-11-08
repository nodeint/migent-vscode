import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sessionDir } from './paths';
import { readSessionWorkflow } from './sessionWorkflow';

function project(withExecution: boolean, schema = 7): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sw-'));
  const dir = sessionDir(root, 's1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'workflow.yaml'), `schema_version: ${schema}\nid: a\nstages:\n  - id: plan\n    role: dev\n`);
  if (withExecution) mkdirSync(path.join(dir, 'executions', '0001-plan--attempt-01'), { recursive: true });
  return root;
}

const read = (root: string): ReturnType<typeof readSessionWorkflow> =>
  readSessionWorkflow({
    projectRoot: root,
    projectName: 'p',
    projectKey: 'k',
    sessionId: 's1',
    scan: { state: 'empty', error: null, entries: [] },
    config: { state: 'missing', error: null, schemaVersion: null, roles: [], agents: [] },
  });

describe('readSessionWorkflow', () => {
  it('stays editable before any stage ran', () => {
    const model = read(project(false));
    expect(model.isLocked).toBe(false);
    expect(model.form.stages.map((s) => s.id)).toEqual(['plan']);
    expect(model.canSave).toBe(true);
  });

  it('locks once a stage has an execution', () => {
    const model = read(project(true));
    expect(model.isLocked).toBe(true);
    expect(model.ranStages).toEqual(['plan']);
    expect(model.canSave).toBe(false);
  });

  it('is read-only on an older schema, and a lock never makes it savable', () => {
    for (const withExecution of [false, true]) {
      const model = read(project(withExecution, 6));
      expect(model.state).toBe('unsupported');
      expect(model.isSupported).toBe(false);
      expect(model.canSave).toBe(false);
    }
  });
});
