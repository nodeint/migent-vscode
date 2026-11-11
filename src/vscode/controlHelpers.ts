import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as vscode from 'vscode';

import { invokeCaptured, invokeText } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import { doctorArgs, doctorLines, parseDoctorOutput, renameArgs } from '../core/controlArgs';
import type { SessionSnapshot } from '../core/model';
import { frozenWorkflowPath, workflowDraftPath, workflowsDir } from '../core/paths';
import { sessionLabel } from '../core/sessionPresentation';
import { text } from '../text';
import { progress, show } from './notices';
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
    vscode.window.setStatusBarMessage(text('prompts.completedStatus', { label: sessionLabel(snapshot) }), COMPLETED_MESSAGE_MS);
    return;
  }
  sinks.log(text('documents.logCompleteWarnings', { warnings }));
  const picked = await show('control.completedWithWarnings', { label: sessionLabel(snapshot), warnings });
  if (picked === 'viewLog') sinks.showLog();
}

/**
 * Run `session rename` and report a failure. The CLI usability check runs here, at dispatch, because it can change
 * while the title prompt is open. Success returns through the `title.json` watcher.
 */
export async function runRename(
  target: { context: ProjectContext; snapshot: SessionSnapshot; title: string },
  control: { ensureWritable: (context: ProjectContext) => Promise<boolean>; showLog: () => void },
  runtime: readonly [launch: LaunchSpec | undefined, env: NodeJS.ProcessEnv, output: vscode.LogOutputChannel],
): Promise<void> {
  const { context, snapshot, title } = target;
  const [launch, env, output] = runtime;
  if (!(await control.ensureWritable(context)) || launch === undefined) return;
  const options = { cwd: context.root, env, timeoutMs: 30_000 };
  const result = await progress('control.renaming', { label: sessionLabel(snapshot) }, () =>
    invokeCaptured(launch, renameArgs(snapshot.sessionId, title), options),
  );
  if (result.kind === 'ok') return;
  const detail = result.error.stderr.trim() || result.error.detail;
  output.error(text('documents.logRenameFailed', { detail }));
  const picked = await show('control.renameFailed', { detail });
  if (picked === 'viewLog') control.showLog();
}

export async function runDoctor(
  context: ProjectContext,
  runtime: { launch: LaunchSpec; env: NodeJS.ProcessEnv; output: vscode.LogOutputChannel; showLog: () => void },
): Promise<void> {
  const { launch, env, output, showLog } = runtime;
  const options = { cwd: context.root, env, timeoutMs: 30_000 };
  const result = await progress('control.doctorRunning', undefined, () => invokeText(launch, doctorArgs(), options));
  const checks = parseDoctorOutput(result.kind === 'ok' ? result.value : (result.error.stdout ?? ''));
  if (checks === null) {
    const detail = result.kind === 'error' ? result.error.stderr.trim() || result.error.detail : text('states.unexpectedOutput');
    output.error(text('documents.logDoctorFailed', { detail }));
    const picked = await show('control.doctorFailed', { detail });
    if (picked === 'viewLog') showLog();
    return;
  }
  output.appendLine(text('documents.doctorHeading', { folder: context.folder.name }));
  for (const line of doctorLines(checks)) output.appendLine(line);
  showLog();
}
