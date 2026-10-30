import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function workflowsFixtureDir(): string {
  return path.join(fixturesDir, 'workflows');
}
