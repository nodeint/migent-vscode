import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import { invokeJson, invokeText } from '../../cli/invoke';
import { type LaunchSpec, nodeProbes } from '../../cli/locate';
import { probeCapability } from '../../cli/version';
import { initArgs, type InitInput, parseProviders, type ProviderChoice, providersArgs, type RoleModel } from '../../core/controlArgs';
import type { OperationGate } from '../../core/operationGate';
import { migentDir } from '../../core/paths';

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

async function pickModel(role: Role, providers: ProviderChoice[]): Promise<RoleModel | undefined> {
  const provider = await vscode.window.showQuickPick(
    providers.map((choice) => ({ label: choice.name, choice })),
    { title: `Initialize Migent: ${role} provider`, placeHolder: `Provider for the ${role}` },
  );
  if (provider === undefined) return undefined;
  const model = await vscode.window.showQuickPick(provider.choice.models, {
    title: `Initialize Migent: ${role} model`,
    placeHolder: `Model for the ${role} (${provider.label})`,
  });
  return model === undefined ? undefined : { provider: provider.label, model };
}

interface InitTarget {
  folder: vscode.WorkspaceFolder;
  launch: LaunchSpec;
  env: NodeJS.ProcessEnv;
}

/** The CLI for a folder that has no project yet, so it is probed directly rather than through the registry. */
async function locateForFolder(folder: vscode.WorkspaceFolder): Promise<InitTarget | undefined> {
  const config = vscode.workspace.getConfiguration('migent', folder.uri);
  const state = await probeCapability({
    locate: {
      platform: process.platform,
      env: process.env,
      probes: nodeProbes,
    },
  });
  if (state.kind === 'ok' && state.launch !== undefined) {
    return { folder, launch: state.launch, env: { ...process.env, ...config.get<Record<string, string>>('env', {}) } };
  }
  const picked = await vscode.window.showWarningMessage(`The Migent CLI is unavailable (${state.kind}).`, 'Recheck');
  if (picked === 'Recheck') await vscode.commands.executeCommand('migent.cli.recheck');
  return undefined;
}

async function pickRoles(providers: ProviderChoice[]): Promise<InitInput | undefined> {
  const chosen: Partial<Record<Role, RoleModel>> = {};
  for (const role of ROLES) {
    const model = await pickModel(role, providers);
    if (model === undefined) return undefined;
    chosen[role] = model;
  }
  const { developer, planner, reviewer } = chosen;
  return developer === undefined || planner === undefined || reviewer === undefined
    ? undefined
    : { developer, planner, reviewer };
}

/** Run the prompts and `migent init` for a folder whose launch key this call holds. */
async function initializeFolder(target: InitTarget): Promise<void> {
  const { launch, env } = target;
  const options = { cwd: target.folder.uri.fsPath, env, timeoutMs: INIT_TIMEOUT_MS };
  const listed = await invokeJson(launch, providersArgs(), options);
  const providers = listed.kind === 'ok' ? parseProviders(listed.value) : [];
  if (providers.length === 0) {
    void vscode.window.showErrorMessage('No provider with models is available. Install a provider CLI first.');
    return;
  }
  const roles = await pickRoles(providers);
  if (roles === undefined) return;
  // The prompts took time: the folder may have been initialized meanwhile, so eligibility is checked again.
  if (existsSync(migentDir(target.folder.uri.fsPath))) {
    vscode.window.setStatusBarMessage(`The folder ${target.folder.name} already has a .migent directory.`, INFO_MESSAGE_MS);
    return;
  }
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Initializing Migent' },
    () => invokeText(launch, initArgs(roles), options),
  );
  if (result.kind === 'error') {
    const detail = result.error.stderr.trim() || result.error.detail;
    void vscode.window.showErrorMessage(`Could not initialize Migent: ${detail}`);
    return;
  }
  vscode.window.setStatusBarMessage(`Initialized Migent in ${target.folder.name}.`, INFO_MESSAGE_MS);
  await vscode.commands.executeCommand('migent.refresh');
}

/**
 * `migent init` driven by Quick Picks (provider, then model, per role). The CLI creates `.migent/`. It runs under the
 * shared operation gate with a launch key per folder, so two invocations cannot initialize one folder at once.
 */
export async function initializeProject(gate: OperationGate): Promise<void> {
  const folder = await pickFolder();
  if (folder === undefined) return;
  const handle = gate.tryAcquire({ kind: 'launch', project: folder.uri.toString(), workflowId: INIT_GATE_ID });
  if (handle === null) {
    vscode.window.setStatusBarMessage(`The folder ${folder.name} is already being initialized.`, INFO_MESSAGE_MS);
    return;
  }
  try {
    const target = await locateForFolder(folder);
    if (target !== undefined) await initializeFolder(target);
  } finally {
    handle.release();
  }
}
