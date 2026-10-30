import path from "node:path";

export const MIGENT_DIR = ".migent";
export const SESSIONS_DIRNAME = "sessions";
export const WORKFLOWS_DIRNAME = "workflows";
export const MANIFEST_FILENAME = "manifest.yaml";
export const STATUS_FILENAME = "status.json";
export const EVENTS_FILENAME = "events.jsonl";
export const LOCK_FILENAME = "session.lock";
export const EXECUTIONS_DIRNAME = "executions";

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
