import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as vscode from 'vscode';

import { invokeText } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import { doctorArgs, doctorLines, parseDoctorOutput } from '../core/controlArgs';
import type { SessionSnapshot } from '../core/model';
import { frozenWorkflowPath, workflowsDir } from '../core/paths';
import type { ProjectContext } from './projects';

function normalizeYaml(text: string): string {
  return text.replaceAll('\r\n', '\n').replace(/[ \t]+$/gm, '').trim();
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export function workflowChange(
  context: ProjectContext, snapshot: SessionSnapshot,
): { frozen: string; current: string } | undefined {
  const workflowId = snapshot.manifest?.workflowId;
  if (workflowId === null || workflowId === undefined) return undefined;
  const { entries } = context.catalog.workflows();
  const entry = entries.find((candidate) => candidate.id === workflowId && !candidate.duplicate);
  if (entry === undefined) return undefined;
  const frozen = frozenWorkflowPath(context.root, snapshot.sessionId);
  const frozenText = readText(frozen);
  const current = path.join(workflowsDir(context.root), entry.file);
  const currentText = readText(current);
  if (frozenText === undefined || currentText === undefined) return undefined;
  return normalizeYaml(frozenText) === normalizeYaml(currentText) ? undefined : { frozen, current };
}

export async function runDoctor(
  context: ProjectContext,
  runtime: { launch: LaunchSpec; env: NodeJS.ProcessEnv; output: vscode.LogOutputChannel; showLog: () => void },
): Promise<void> {
  const { launch, env, output, showLog } = runtime;
  const options = { cwd: context.root, env, timeoutMs: 30_000 };
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Running Migent doctor' },
    () => invokeText(launch, doctorArgs(), options),
  );
  const checks = parseDoctorOutput(result.kind === 'ok' ? result.value : (result.error.stdout ?? ''));
  if (checks === null) {
    const detail = result.kind === 'error' ? result.error.stderr.trim() || result.error.detail : 'unexpected output';
    output.error(`doctor failed: ${detail}`);
    const picked = await vscode.window.showErrorMessage(`Doctor could not run: ${detail}`, 'View log');
    if (picked === 'View log') showLog();
    return;
  }
  output.appendLine(`doctor (${context.folder.name}):`);
  for (const line of doctorLines(checks)) output.appendLine(line);
  showLog();
}
