/**
 * Shared pieces of the host integration scenarios: waiting, writing Migent files from Node (as the CLI would),
 * and running a list of scenarios against the activated extension in the fixture workspace.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { MigentApi } from '../extension';
import type { MigentChange } from '../vscode/changes';
import type { ProjectContext } from '../vscode/projects';
import { recordFailure } from './failureReport';

const WAIT_MS = 6000;
const POLL_MS = 25;
export const SETTLE_MS = 400;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(label: string, isReady: () => boolean, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isReady()) return;
    await sleep(POLL_MS);
  }
  assert.ok(isReady(), `timed out waiting for: ${label}`);
}

export interface Env {
  root: string;
  api: MigentApi;
  changes: MigentChange[];
  project: () => ProjectContext | undefined;
}

export interface Scenario {
  name: string;
  run: (env: Env) => Promise<void>;
}

export const migentPath = (root: string, ...parts: string[]): string => path.join(root, '.migent', ...parts);

export function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Replace a file the way migent does: write a temp file in the same folder, then rename it over. */
export function writeAtomic(file: string, content: string): void {
  const temp = `${file}.tmp-${Date.now()}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

export function removeMigent(root: string): void {
  fs.rmSync(path.join(root, '.migent'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export function freshLock(): string {
  return JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() });
}

export async function createProject(env: Env): Promise<ProjectContext> {
  write(migentPath(env.root, 'config.yaml'), 'schema_version: 1\n');
  await waitFor('project appears', () => env.project() !== undefined);
  const project = env.project();
  assert.ok(project, 'project exists');
  return project;
}

export const manifest = (id: string, extra = ''): string =>
  `session_id: ${id}\nschema_version: 2\ncreated_at: 2026-11-01T10:00:00.000+00:00\n${extra}`;

export const status = (value: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: 's', status: value, updated_at: new Date().toISOString(), ...extra });

/** Repository root, found from the bundled test entry (`dist-test/integration/index.js`). */
export const repoRoot = (): string => path.resolve(__dirname, '..', '..');

let cached: Env | undefined;

async function environment(): Promise<Env> {
  if (cached) return cached;
  const root = process.env.MIGENT_IT_WORKSPACE;
  if (!root) throw new Error('MIGENT_IT_WORKSPACE is not set; run through scripts/integration/run.mjs');
  const extension = vscode.extensions.getExtension<MigentApi>('nodeint.migent-vscode');
  if (!extension) throw new Error('extension nodeint.migent-vscode is not loaded');
  const api = await extension.activate();
  await api.ready;
  const changes: MigentChange[] = [];
  api.registry.onDidChange((change) => changes.push(change));
  const wanted = vscode.Uri.file(root).fsPath.toLowerCase();
  cached = {
    root,
    api,
    changes,
    project: () => api.registry.projects().find((candidate) => candidate.folder.uri.fsPath.toLowerCase() === wanted),
  };
  return cached;
}

/**
 * Remove `.migent/` between scenarios. Editors opened by a scenario are closed first, and a transient
 * lock (EBUSY/EPERM while VS Code's watcher still holds a folder, seen on Windows) is retried with a pause.
 */
async function cleanMigent(root: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      removeMigent(root);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(SETTLE_MS);
    }
  }
}

/**
 * Wait until the removed project is demoted. VS Code 1.90 occasionally delivers the anchor delete event
 * late; the product's recovery path for a dropped event is Refresh, so use it once before failing.
 */
async function waitForCleanStart(env: Env): Promise<void> {
  try {
    await waitFor('clean start', () => env.project() === undefined);
  } catch {
    console.log('NOTE anchor delete event not seen within the wait; recovering with migent.refresh');
    env.api.registry.refresh();
    await waitFor('clean start after refresh', () => env.project() === undefined);
  }
}

/** Run scenarios one by one, each from a clean workspace; returns the number that failed. */
export async function runScenarios(scenarios: readonly Scenario[]): Promise<number> {
  const env = await environment();
  let failed = 0;
  for (const scenario of scenarios) {
    await cleanMigent(env.root);
    await waitForCleanStart(env);
    await sleep(SETTLE_MS);
    env.changes.length = 0;
    try {
      await scenario.run(env);
    } catch (error) {
      failed += 1;
      recordFailure('scenario', scenario.name, error);
      console.log(`FAIL ${scenario.name}\n     ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await cleanMigent(env.root);
  return failed;
}
