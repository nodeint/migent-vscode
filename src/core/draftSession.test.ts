import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveDisplayState } from './displayState';
import { readManifest } from './manifest';
import { FROZEN_WORKFLOW_FILENAME, WORKFLOW_DRAFT_FILENAME, workflowDraftPath } from './paths';
import { readStatus } from './statusReader';
import { capturedDir } from './testHelpers';

describe('migent 0.3.5 draft sessions (captured)', () => {
  it('a prepared session has an empty task.md and an editable workflow.yaml but nothing frozen', () => {
    const dir = capturedDir('prepared-draft');
    const status = readStatus(path.join(dir, 'status.json'));
    expect(status.kind).toBe('ok');
    if (status.kind !== 'ok') return;
    expect(deriveDisplayState({ status: status.status, statusError: null, manifest: 'ok' }, { kind: 'none' }).state).toBe(
      'prepared',
    );
    expect(readFileSync(path.join(dir, 'task.md'), 'utf8')).toBe('');
    expect(existsSync(path.join(dir, WORKFLOW_DRAFT_FILENAME))).toBe(true);
    expect(existsSync(path.join(dir, FROZEN_WORKFLOW_FILENAME))).toBe(false);
  });

  it('a started session keeps workflow.yaml next to the frozen copy, which wraps the workflow', () => {
    const dir = capturedDir('started-draft');
    expect(existsSync(path.join(dir, WORKFLOW_DRAFT_FILENAME))).toBe(true);
    expect(readFileSync(path.join(dir, FROZEN_WORKFLOW_FILENAME), 'utf8')).toMatch(/^source_sha256: \w+\nworkflow:\n/);
    expect(readManifest(path.join(dir, 'manifest.yaml'))?.workflowId).toBe('plan');
  });

  it('workflowDraftPath is the session directory file', () => {
    expect(workflowDraftPath('/p', 's1')).toBe(path.join('/p', '.migent', 'sessions', 's1', 'workflow.yaml'));
  });
});
