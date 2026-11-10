import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { frozenWorkflowPath, workflowDraftPath } from './paths';
import { readSessionStagePlan } from './workflowStages';

const SESSION = '00000000-0000-4000-8000-000000000001';
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-stages-'));
  temps.push(dir);
  return dir;
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

describe('readSessionStagePlan', () => {
  it('reads stage ids from the frozen workflow in declaration order and skips malformed entries', () => {
    const root = project();
    write(
      frozenWorkflowPath(root, SESSION),
      ['stages:', '  - id: plan', '  - id: implement', '  - title: no id', '  - 42', "  - id: ''"].join('\n'),
    );
    expect(readSessionStagePlan(root, SESSION)).toEqual({ kind: 'ok', stages: ['plan', 'implement'] });
  });

  it('reads stages from the frozen wrapper as well as a top-level draft', () => {
    const root = project();
    write(
      frozenWorkflowPath(root, SESSION),
      ['source_sha256: abc', 'workflow:', '  id: plan', '  stages:', '    - id: draft', '    - id: review'].join('\n'),
    );
    expect(readSessionStagePlan(root, SESSION)).toEqual({ kind: 'ok', stages: ['draft', 'review'] });
  });

  it('prefers the frozen workflow over the draft', () => {
    const root = project();
    write(frozenWorkflowPath(root, SESSION), 'stages:\n  - id: frozen\n');
    write(workflowDraftPath(root, SESSION), 'stages:\n  - id: draft\n');
    expect(readSessionStagePlan(root, SESSION)).toEqual({ kind: 'ok', stages: ['frozen'] });
  });

  it('falls back to the draft when the frozen copy is missing', () => {
    const root = project();
    write(workflowDraftPath(root, SESSION), 'stages:\n  - id: build\n  - id: verify\n');
    expect(readSessionStagePlan(root, SESSION)).toEqual({ kind: 'ok', stages: ['build', 'verify'] });
  });

  it('reports a workflow without stages as an empty plan', () => {
    const root = project();
    write(frozenWorkflowPath(root, SESSION), 'id: plan\ntitle: Plan\n');
    expect(readSessionStagePlan(root, SESSION)).toEqual({ kind: 'ok', stages: [] });
  });

  it('reports missing when neither file exists', () => {
    expect(readSessionStagePlan(project(), SESSION)).toEqual({ kind: 'missing' });
  });

  it('reports invalid YAML with its error', () => {
    const root = project();
    write(frozenWorkflowPath(root, SESSION), 'stages: [\n');
    const plan = readSessionStagePlan(root, SESSION);
    expect(plan.kind).toBe('invalid');
    expect(plan.kind === 'invalid' ? plan.error : '').not.toBe('');
  });

  it('reports an unreadable workflow path with its error', () => {
    const root = project();
    mkdirSync(frozenWorkflowPath(root, SESSION), { recursive: true });
    const plan = readSessionStagePlan(root, SESSION);
    expect(plan.kind).toBe('unreadable');
    expect(plan.kind === 'unreadable' ? plan.error : '').not.toBe('');
  });
});
