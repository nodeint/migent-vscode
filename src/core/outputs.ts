import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { SessionSnapshot as CliSessionSnapshot, SessionStatusFile } from '@nodeint/migent-contracts';

import { OUTPUTS_DIRNAME, resolveWithin } from './paths';
import { isRecord } from './record';

/** A published output as the contract describes it (`OutputRef`). */
export type OutputRef = CliSessionSnapshot['outputs'][string];

/** A published output name with its reference; the reference always carries a path. */
export type PublishedOutputEntry = readonly [name: string, ref: OutputRef & { path: string }];

/** The usable published outputs of `status.json`, in file order: an entry without a string path is skipped. */
export function publishedOutputs(status: SessionStatusFile | null | undefined): PublishedOutputEntry[] {
  const entries: PublishedOutputEntry[] = [];
  for (const [name, value] of Object.entries(status?.outputs ?? {})) {
    if (!isRecord(value) || typeof value.path !== 'string') continue;
    const { source_execution_id: source, published_by_execution_id: publisher } = value;
    entries.push([
      name,
      {
        path: value.path,
        ...(typeof source === 'string' ? { source_execution_id: source } : {}),
        ...(typeof publisher === 'string' ? { published_by_execution_id: publisher } : {}),
      },
    ]);
  }
  return entries;
}

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

function publishedRow(sessionDirPath: string, [name, output]: PublishedOutputEntry): OutputRow {
  const absolutePath = resolveWithin(sessionDirPath, output.path);
  let state: OutputFileState = 'rejected';
  if (absolutePath !== null) state = isFile(absolutePath) ? 'ok' : 'missing';
  return {
    name,
    path: normalize(output.path),
    absolutePath,
    state,
    sourceExecutionId: output.source_execution_id ?? null,
    publishedByExecutionId: output.published_by_execution_id ?? null,
  };
}

/**
 * Rows for the published outputs of a session plus path-only rows for files in
 * `outputs/` that status does not name. Reads the directory on demand; nothing is cached.
 */
export function listOutputs(sessionDirPath: string, published: readonly PublishedOutputEntry[]): OutputListing {
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
