import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TASK_FILENAME } from './paths';

/**
 * The whole text of a session's `task.md`, trimmed of surrounding whitespace. Null when the file is
 * missing, unreadable or blank. Nothing is excerpted or shortened: how much to show is the page's decision.
 */
export function readSessionTask(sessionDirPath: string): string | null {
  try {
    const text = readFileSync(path.join(sessionDirPath, TASK_FILENAME), 'utf8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}
