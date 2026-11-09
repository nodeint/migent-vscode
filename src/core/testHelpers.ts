import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveDisplayState } from './displayState';
import { listExecutions } from './executions';
import { readManifest } from './manifest';
import type { LockProbe, SessionSnapshot } from './model';
import { replyNeedsExecutions, replyTargets } from './replyFlow';
import { readStatus } from './statusReader';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Copy the redacted fixtures into a throwaway project layout
 * (<tmp>/.migent/sessions/...) so tests can mutate locks and status files freely.
 */
export function makeProject(): string {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-test-'));
  mkdirSync(path.join(projectRoot, '.migent'), { recursive: true });
  cpSync(path.join(fixturesDir, 'sessions'), path.join(projectRoot, '.migent', 'sessions'), {
    recursive: true,
  });
  cpSync(path.join(fixturesDir, 'workflows'), path.join(projectRoot, '.migent', 'workflows'), {
    recursive: true,
  });
  return projectRoot;
}

/** A session directory in the captured migent 0.3.1 samples, read in place. */
export function capturedDir(name: string): string {
  return path.join(fixturesDir, 'captured', name);
}

/** A hand-written fixture for a shape no captured sample covers (see `fixtures/synthetic/README.md`). */
export function syntheticDir(name: string): string {
  return path.join(fixturesDir, 'synthetic', name);
}

export function workflowsFixtureDir(): string {
  return path.join(fixturesDir, 'workflows');
}

/** Build a snapshot from the manifest and status files in a fixture directory, with the given lock. */
export function snapshotFromDir(dir: string, lock: LockProbe = { kind: 'none' }): SessionSnapshot {
  const manifest = readManifest(path.join(dir, 'manifest.yaml'));
  const read = readStatus(path.join(dir, 'status.json'));
  const status = read.kind === 'ok' ? read.status : null;
  let manifestState: 'ok' | 'invalid' | 'unsupported' = 'invalid';
  if (manifest !== null) manifestState = manifest.schemaSupported ? 'ok' : 'unsupported';
  const body = {
    sessionId: path.basename(dir),
    manifest,
    status,
    statusError: read.kind === 'error',
    lock,
    displayState: deriveDisplayState(
      { status, statusError: read.kind === 'error' ? read.reason : null, manifest: manifestState },
      lock,
    ),
  };
  return { ...body, replyTargets: replyTargets(body, replyNeedsExecutions(body) ? listExecutions(dir) : []) };
}
