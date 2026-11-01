import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { PublishedOutput } from './model';
import { OUTPUTS_DIRNAME, resolveWithin } from './paths';
import { isRecord } from './record';

/**
 * `ok`: the file exists. `missing`: published but absent. `rejected`: the recorded
 * path leaves the session directory, so it is never resolved or opened.
 */
export type OutputFileState = 'ok' | 'missing' | 'rejected';

export interface OutputRow {
  /** Published name; null for a file found in `outputs/` that status does not name. */
  name: string | null;
  /** Session-relative path, forward slashes. */
  path: string;
  /** Absolute path inside the session directory; null when rejected. */
  absolutePath: string | null;
  state: OutputFileState;
  sourceExecutionId: string | null;
  publishedByExecutionId: string | null;
}

export interface OutputListing {
  rows: OutputRow[];
  /** Error code when `outputs/` exists but cannot be listed; null otherwise (a missing directory is normal). */
  directoryError: string | null;
}

function normalize(relative: string): string {
  return relative.replace(/\\/g, '/');
}

function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function publishedRow(sessionDirPath: string, output: PublishedOutput): OutputRow {
  const absolutePath = resolveWithin(sessionDirPath, output.path);
  let state: OutputFileState = 'rejected';
  if (absolutePath !== null) state = isFile(absolutePath) ? 'ok' : 'missing';
  return {
    name: output.name,
    path: normalize(output.path),
    absolutePath,
    state,
    sourceExecutionId: output.sourceExecutionId,
    publishedByExecutionId: output.publishedByExecutionId,
  };
}

/**
 * Rows for the published outputs of a session plus path-only rows for files in
 * `outputs/` that status does not name. Reads the directory on demand; nothing is cached.
 */
export function listOutputs(sessionDirPath: string, published: readonly PublishedOutput[]): OutputListing {
  const rows = published.map((output) => publishedRow(sessionDirPath, output));
  const known = new Set(rows.map((row) => row.path));
  let directoryError: string | null = null;
  try {
    const entries = readdirSync(path.join(sessionDirPath, OUTPUTS_DIRNAME), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const relative = `${OUTPUTS_DIRNAME}/${entry.name}`;
      if (known.has(relative)) continue;
      rows.push({
        name: null,
        path: relative,
        absolutePath: path.join(sessionDirPath, OUTPUTS_DIRNAME, entry.name),
        state: 'ok',
        sourceExecutionId: null,
        publishedByExecutionId: null,
      });
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
    if (code !== 'ENOENT' && code !== 'ENOTDIR') directoryError = code;
  }
  return { rows, directoryError };
}
