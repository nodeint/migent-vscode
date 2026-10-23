import path from "node:path";

export const MIGENT_DIR = ".migent";

export function sessionsDir(projectRoot: string): string {
  return path.join(projectRoot, MIGENT_DIR, "sessions");
}

export function sessionDir(projectRoot: string, sessionId: string): string {
  return path.join(sessionsDir(projectRoot), sessionId);
}
