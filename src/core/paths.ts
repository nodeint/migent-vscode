import path from 'node:path';

export const MIGENT_DIR = '.migent';
export const SESSIONS_DIRNAME = 'sessions';
export const WORKFLOWS_DIRNAME = 'workflows';
export const MANIFEST_FILENAME = 'manifest.yaml';
export const STATUS_FILENAME = 'status.json';
export const EVENTS_FILENAME = 'events.jsonl';
export const LOCK_FILENAME = 'session.lock';
export const EXECUTIONS_DIRNAME = 'executions';
export const OUTPUTS_DIRNAME = 'outputs';
export const HANDOFF_DIRNAME = 'handoff';
export const QUESTIONS_FILENAME = 'questions.json';
export const NEXT_FILENAME = 'next.json';
export const FROZEN_WORKFLOW_FILENAME = 'workflow.frozen.yaml';
export const TASK_FILENAME = 'task.md';
/** The editable session workflow written by `session prepare` (CLI 0.3.5 and later). */
export const WORKFLOW_DRAFT_FILENAME = 'workflow.yaml';
export const METRICS_FILENAME = 'metrics.json';
export const CANCEL_REQUEST_FILENAME = 'cancel.requested';
/** Readable failure report written by CLI 0.3.6 and later for a failed execution. */
export const FAILURE_REPORT_FILENAME = 'failure.md';
/** Provider failure diagnostics written by CLI 0.3.6 and later for a failed execution. */
export const DIAGNOSTICS_FILENAME = 'diagnostics.json';
export const CONFIG_FILENAME = 'config.yaml';

export function migentDir(projectRoot: string): string {
  return path.join(projectRoot, MIGENT_DIR);
}

export function sessionsDir(projectRoot: string): string {
  return path.join(projectRoot, MIGENT_DIR, SESSIONS_DIRNAME);
}

export function sessionDir(projectRoot: string, sessionId: string): string {
  return path.join(sessionsDir(projectRoot), sessionId);
}

export function manifestPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), MANIFEST_FILENAME);
}

export function statusPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), STATUS_FILENAME);
}

export function eventsPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), EVENTS_FILENAME);
}

export function lockPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), LOCK_FILENAME);
}

export function executionsDir(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), EXECUTIONS_DIRNAME);
}

export function workflowsDir(projectRoot: string): string {
  return path.join(projectRoot, MIGENT_DIR, WORKFLOWS_DIRNAME);
}

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, MIGENT_DIR, CONFIG_FILENAME);
}

export function questionsPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), QUESTIONS_FILENAME);
}

export function nextPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), NEXT_FILENAME);
}

export function frozenWorkflowPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), FROZEN_WORKFLOW_FILENAME);
}

export function workflowDraftPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), WORKFLOW_DRAFT_FILENAME);
}

export function taskPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), TASK_FILENAME);
}

export function metricsPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), METRICS_FILENAME);
}

export function cancelRequestPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), CANCEL_REQUEST_FILENAME);
}

export function outputsDir(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), OUTPUTS_DIRNAME);
}

/**
 * Resolve `relative` under `baseDir`. Null when it is empty, absolute, or leaves
 * `baseDir` (a lexical check; symbolic links are not followed).
 */
export function resolveWithin(baseDir: string, relative: string): string | null {
  if (relative === '' || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) return null;
  const resolved = path.resolve(baseDir, relative);
  const back = path.relative(baseDir, resolved);
  if (back === '' || back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) return null;
  return resolved;
}

export function handoffDir(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), HANDOFF_DIRNAME);
}
