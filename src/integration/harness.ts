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
  // A new project's CLI probe runs asynchronously; commands refuse to launch until it has settled.
  await waitFor('CLI capability checked', () => env.api.capability.state(project.key).kind !== 'checking');
  return project;
}

export const manifest = (id: string, extra = ''): string =>
  `session_id: ${id}\nschema_version: 2\ncreated_at: 2026-11-01T10:00:00.000+00:00\n${extra}`;

export const status = (value: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: 's', status: value, updated_at: new Date().toISOString(), ...extra });

/** Repository root, found from the bundled test entry (`dist-test/integration/index.js`). */
export const repoRoot = (): string => path.resolve(__dirname, '..', '..');

interface Shared {
  api: MigentApi;
  changes: MigentChange[];
}

let cached: Shared | undefined;

async function shared(): Promise<Shared> {
  if (cached) return cached;
  const extension = vscode.extensions.getExtension<MigentApi>('nodeint.migent-vscode');
  if (!extension) throw new Error('extension nodeint.migent-vscode is not loaded');
  const api = await extension.activate();
  await api.ready;
  const changes: MigentChange[] = [];
  api.registry.onDidChange((change) => changes.push(change));
  cached = { api, changes };
  return cached;
}

/** Resolves on the next workspace-folder change; rejects when none arrives, so a missed event names itself. */
function nextFolderChange(what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`timed out waiting for: workspace folder ${what}`));
    }, WAIT_MS);
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    });
  });
}

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run through scripts/integration/run.mjs`);
  return value;
};

export interface ScenarioFolder {
  root: string;
  /** Remove the folder from the workspace, make sure no fake CLI outlived it, and delete its files. */
  dispose(): Promise<void>;
}

/** Name of the file where `fake-migent.js` records the pid of each process it starts. */
const PID_LOG = 'fake-pids.log';
const EXIT_WAIT_MS = 3000;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

function recordedPids(root: string): number[] {
  try {
    return fs
      .readFileSync(path.join(root, PID_LOG), 'utf8')
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Wait for the fake CLI processes a scenario started to end; kill and report any that do not. */
async function assertNoLeakedProcesses(root: string): Promise<void> {
  const pids = recordedPids(root);
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (pids.some(isAlive) && Date.now() < deadline) await sleep(POLL_MS);
  const leaked = pids.filter(isAlive);
  for (const pid of leaked) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  assert.equal(leaked.length, 0, `fake CLI process(es) outlived the scenario (killed): ${leaked.join(', ')}`);
}

const WATCHER_PROBE_FILE = '.watch-ready';
const PROBE_INTERVAL_MS = 100;

/**
 * A watcher on a just-added folder starts asynchronously and misses files written before it is live, so a scenario
 * that writes `.migent/` at once would wait for an event that never comes. Touch a sentinel until a watcher on the
 * folder sees it; only then is the folder handed to the scenario.
 */
async function waitForWatcher(folder: vscode.Uri): Promise<void> {
  const file = path.join(folder.fsPath, WATCHER_PROBE_FILE);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, WATCHER_PROBE_FILE));
  const seen = { value: false };
  const markSeen = (): void => {
    seen.value = true;
  };
  const subscriptions = [watcher.onDidCreate(markSeen), watcher.onDidChange(markSeen)];
  try {
    const deadline = Date.now() + WAIT_MS;
    while (!seen.value && Date.now() < deadline) {
      fs.writeFileSync(file, String(Date.now()));
      await sleep(PROBE_INTERVAL_MS);
    }
    assert.ok(seen.value, `timed out waiting for: file watcher on ${folder.fsPath}`);
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
    watcher.dispose();
    fs.rmSync(file, { force: true });
  }
}

/**
 * Give one scenario its own temporary workspace folder, copied from the fixture template. Nothing is shared
 * between scenarios, so nothing has to wait for a previous scenario's `.migent/` to disappear. The window was
 * launched from a `.code-workspace` file, which is what keeps VS Code 1.90 from restarting the extension host
 * when a folder is added.
 */
export async function openScenarioFolder(): Promise<ScenarioFolder> {
  const root = fs.mkdtempSync(path.join(requiredEnv('MIGENT_IT_SCRATCH'), 'case-'));
  fs.cpSync(requiredEnv('MIGENT_IT_TEMPLATE'), root, { recursive: true });
  const uri = vscode.Uri.file(root);
  const added = nextFolderChange('added');
  if (!vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri })) {
    throw new Error(`VS Code refused to add workspace folder ${root}`);
  }
  await added;
  await waitForWatcher(uri);
  return {
    root,
    async dispose() {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const index = vscode.workspace.workspaceFolders?.findIndex((folder) => folder.uri.fsPath === uri.fsPath) ?? -1;
      if (index >= 0) {
        const removed = nextFolderChange('removed');
        if (!vscode.workspace.updateWorkspaceFolders(index, 1)) {
          throw new Error(`VS Code refused to remove workspace folder ${root}`);
        }
        await removed;
      }
      // The folder is not deleted here: removing a directory while VS Code is still tearing down its watchers is
      // what produced EPERM/EBUSY storms on Windows. The runner deletes the whole scratch tree after the run.
      await assertNoLeakedProcesses(root);
    },
  };
}

/** Run scenarios one by one, each in its own workspace folder; returns the number that failed. */
export async function runScenarios(scenarios: readonly Scenario[]): Promise<number> {
  let failed = 0;
  for (const scenario of scenarios) {
    failed += await runScenario(scenario);
  }
  return failed;
}

/** Run `step`; on a throw, record it under `type` and log the case name with its message. Returns 1 on failure. */
async function attempt(type: string, name: string, step: () => Promise<void>): Promise<number> {
  try {
    await step();
    return 0;
  } catch (error) {
    recordFailure(type, name, error);
    console.log(`FAIL ${name} [${type}]\n     ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const SCENARIO_TIMEOUT_MS = 120_000;

/** Fail a hung scenario by name instead of letting the CI job time out without a trace. */
async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`scenario did not finish within ${ms} ms`)), ms);
  });
  try {
    await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function runScenario(scenario: Scenario): Promise<number> {
  const { api, changes } = await shared();
  let folder: ScenarioFolder | undefined;
  let failed = await attempt('scenario setup', scenario.name, async () => {
    folder = await openScenarioFolder();
  });
  if (folder === undefined) return failed;
  const opened = folder;
  const { root } = opened;
  const wanted = vscode.Uri.file(root).fsPath.toLowerCase();
  const env: Env = {
    root,
    api,
    changes,
    project: () => api.registry.projects().find((candidate) => candidate.folder.uri.fsPath.toLowerCase() === wanted),
  };
  changes.length = 0;
  const started = Date.now();
  console.log(`RUN  ${scenario.name}`);
  failed += await attempt('scenario', scenario.name, () => withTimeout(scenario.run(env), SCENARIO_TIMEOUT_MS));
  if (failed === 0) console.log(`PASS ${scenario.name} (${Date.now() - started} ms)`);
  return failed + (await attempt('scenario cleanup', scenario.name, () => opened.dispose()));
}
