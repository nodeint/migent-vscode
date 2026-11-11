import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import { invokeJson, invokeText } from '../../cli/invoke';
import type { LaunchSpec } from '../../cli/locate';
import {
  type ClientChoice,
  clientsArgs,
  initArgs,
  type InitInput,
  joinClients,
  modelsArgs,
  type RoleModel,
} from '../../core/controlArgs';
import type { OperationGate } from '../../core/operationGate';
import { migentDir } from '../../core/paths';
import type { CapabilityService } from '../capability';
import { pickModel } from '../modelPicker';
import { notify, progress, show } from '../notices';

const INFO_MESSAGE_MS = 5000;

const INIT_TIMEOUT_MS = 60_000;
/** Launch-key id for initialization; not a workflow id a project can declare. */
const INIT_GATE_ID = '<init>';

const ROLES = ['developer', 'planner', 'reviewer'] as const;
type Role = (typeof ROLES)[number];

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
  if (folders.length === 0) {
    vscode.window.setStatusBarMessage('Open a folder first, then initialize Migent in it.', INFO_MESSAGE_MS);
    return undefined;
  }
  const candidates = folders.filter((folder) => !existsSync(migentDir(folder.uri.fsPath)));
  if (candidates.length === 0) {
    vscode.window.setStatusBarMessage('Every open folder already has a .migent directory.', INFO_MESSAGE_MS);
    return undefined;
  }
  const [only] = candidates;
  if (candidates.length === 1) return only;
  const picked = await vscode.window.showQuickPick(
    candidates.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: 'Initialize which folder?' },
  );
  return picked?.folder;
}

/** One pick for each role (developer first), or one pick in total when the first uses "for all roles". */
async function pickRoles(clients: ClientChoice[]): Promise<InitInput | undefined> {
  const chosen: Partial<Record<Role, RoleModel>> = {};
  for (const role of ROLES) {
    const picked = await pickModel(`Initialize Migent: ${role} model`, clients, role === ROLES[0]);
    if (picked === undefined) return undefined;
    if (picked.isForAll) return { developer: picked.model, planner: picked.model, reviewer: picked.model };
    chosen[role] = picked.model;
  }
  const { developer, planner, reviewer } = chosen;
  return developer === undefined || planner === undefined || reviewer === undefined
    ? undefined
    : { developer, planner, reviewer };
}

interface InitTarget {
  folder: vscode.WorkspaceFolder;
  launch: LaunchSpec;
  env: NodeJS.ProcessEnv;
  clients: ClientChoice[];
}

/** Resolves with `undefined` as soon as the token is cancelled; the abandoned work finishes on its own. */
async function untilCancelled<T>(work: Promise<T>, token: vscode.CancellationToken): Promise<T | undefined> {
  const subscriptions: vscode.Disposable[] = [];
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        subscriptions.push(token.onCancellationRequested(() => resolve(undefined)));
      }),
    ]);
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
  }
}

async function warnUnavailable(kind: string): Promise<void> {
  let action: 'recheck' | 'installCli' | 'updateCli' = 'recheck';
  let command = 'migent.cli.recheck';
  if (kind === 'missing' || kind === 'old') {
    action = kind === 'old' ? 'updateCli' : 'installCli';
    command = 'migent.cli.install';
  }
  const picked = await show('init.cliUnavailable', { kind }, [action]);
  if (picked !== undefined) await vscode.commands.executeCommand(command);
}

/**
 * The CLI and the client list for a folder that has no project yet. It uses the window CLI state, which does not
 * depend on the folder, and reads `get clients` and `get models` once.
 */
async function loadTarget(
  folder: vscode.WorkspaceFolder,
  capability: CapabilityService,
  token: vscode.CancellationToken,
): Promise<InitTarget | undefined> {
  const state = await untilCancelled(capability.windowReady(), token);
  if (state === undefined) return undefined;
  if (state.kind !== 'ok' || state.launch === undefined) {
    void warnUnavailable(state.kind);
    return undefined;
  }
  const config = vscode.workspace.getConfiguration('migent', folder.uri);
  const env = { ...process.env, ...config.get<Record<string, string>>('env', {}) };
  const listOptions = { cwd: folder.uri.fsPath, env, timeoutMs: INIT_TIMEOUT_MS };
  const listed = await untilCancelled(
    Promise.all([
      invokeJson(state.launch, clientsArgs(), listOptions),
      invokeJson(state.launch, modelsArgs(), listOptions),
    ]),
    token,
  );
  if (listed === undefined) return undefined;
  const [clientRows, modelRows] = listed;
  const clients =
    clientRows.kind === 'ok' && modelRows.kind === 'ok' ? joinClients(clientRows.value, modelRows.value) : [];
  if (clients.length === 0) {
    notify('init.noClients');
    return undefined;
  }
  return { folder, launch: state.launch, env, clients };
}

/** Run the prompts and `migent init` for a folder whose launch key this call holds. */
async function initializeFolder(target: InitTarget): Promise<void> {
  const { launch, env } = target;
  const options = { cwd: target.folder.uri.fsPath, env, timeoutMs: INIT_TIMEOUT_MS };
  const roles = await pickRoles(target.clients);
  if (roles === undefined) return;
  // The prompts took time: the folder may have been initialized meanwhile, so eligibility is checked again.
  if (existsSync(migentDir(target.folder.uri.fsPath))) {
    vscode.window.setStatusBarMessage(`The folder ${target.folder.name} already has a .migent directory.`, INFO_MESSAGE_MS);
    return;
  }
  const result = await progress('init.running', undefined, () => invokeText(launch, initArgs(roles), options));
  if (result.kind === 'error') {
    const detail = result.error.stderr.trim() || result.error.detail;
    notify('init.failed', { detail });
    return;
  }
  await vscode.commands.executeCommand('migent.refresh');
  const picked = await show('init.done', { name: target.folder.name });
  if (picked === 'runWorkflow') await vscode.commands.executeCommand('migent.session.run');
}

/**
 * `migent init` driven by Quick Picks (one pick per role, or one pick for every role). The CLI creates `.migent/`.
 * It runs under the shared operation gate with a launch key per folder, so two invocations cannot both initialize one
 * folder at once.
 */
export async function initializeProject(gate: OperationGate, capability: CapabilityService): Promise<void> {
  const folder = await pickFolder();
  if (folder === undefined) return;
  const handle = gate.tryAcquire({ kind: 'launch', project: folder.uri.toString(), workflowId: INIT_GATE_ID });
  if (handle === null) {
    vscode.window.setStatusBarMessage(`The folder ${folder.name} is already being initialized.`, INFO_MESSAGE_MS);
    return;
  }
  try {
    const target = await progress('init.loadingClients', undefined, (_reporter, token) =>
      loadTarget(folder, capability, token),
    );
    if (target !== undefined) await initializeFolder(target);
  } finally {
    handle.release();
  }
}
