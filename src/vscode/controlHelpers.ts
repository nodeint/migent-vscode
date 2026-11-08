import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as vscode from 'vscode';

import { invokeText } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import { doctorArgs, doctorLines, parseDoctorOutput } from '../core/controlArgs';
import type { SessionSnapshot } from '../core/model';
import { frozenWorkflowPath, workflowDraftPath, workflowsDir } from '../core/paths';
import { sessionLabel } from '../core/sessionPresentation';
import type { ProjectContext } from './projects';

const COMPLETED_MESSAGE_MS = 3000;

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

/**
 * Whether the session directory holds its editable `workflow.yaml`. The CLI keeps it after freezing, and a
 * Continue (even with `--refresh-workflow`) reads it, never the live `.migent/workflows` file, so the live file
 * is not a source of change for such a session.
 *
 * This reads session data, not the CLI version: a session prepared before CLI 0.3.5 has no file.
 */
export function hasWorkflowDraft(projectRoot: string, sessionId: string): boolean {
  return existsSync(workflowDraftPath(projectRoot, sessionId));
}

/**
 * Undefined for a session that has its own `workflow.yaml`; a session prepared before CLI 0.3.5 has none and
 * compares the live and frozen copies.
 */
export function workflowChange(
  context: ProjectContext, snapshot: SessionSnapshot,
): { frozen: string; current: string } | undefined {
  if (hasWorkflowDraft(context.root, snapshot.sessionId)) return undefined;
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

/**
 * Whether a finished command is a proven pre-execution rejection of a prepared session's draft: it started from
 * `prepared`, the CLI reported a configuration error, the session still reads `prepared` and no runner holds it.
 */
export function isRejectedStart(
  context: ProjectContext,
  input: { sessionId: string; before: SessionSnapshot | undefined; outcome: string },
): boolean {
  const { sessionId, before, outcome } = input;
  if (outcome !== 'ConfigError' || before?.displayState.state !== 'prepared') return false;
  const now = context.store.snapshot(sessionId);
  return hasWorkflowDraft(context.root, sessionId) && now?.displayState.state === 'prepared' && now.lock.kind !== 'alive';
}

/**
 * Report a finished `session complete`. The CLI warns on stderr about each missing required artifact and
 * completes anyway, so those warnings are shown instead of an unconditional success.
 */
export async function reportCompleted(
  snapshot: SessionSnapshot,
  warnings: string,
  sinks: { log: (line: string) => void; showLog: () => void },
): Promise<void> {
  if (warnings === '') {
    vscode.window.setStatusBarMessage(`Completed ${sessionLabel(snapshot)}`, COMPLETED_MESSAGE_MS);
    return;
  }
  sinks.log(`complete warnings: ${warnings}`);
  const picked = await vscode.window.showWarningMessage(
    `Completed ${sessionLabel(snapshot)} with warnings: ${warnings}`,
    'View log',
  );
  if (picked === 'View log') sinks.showLog();
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
