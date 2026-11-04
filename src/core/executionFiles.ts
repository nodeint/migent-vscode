import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isRecord } from './record';

export type ExecutionFileKind = 'task' | 'prompt' | 'response' | 'questions' | 'stream' | 'verify' | 'artifact';

export interface ExecutionFile {
  kind: ExecutionFileKind;
  /** Execution-relative path, forward slashes (e.g. `turns/turn-01/verify.md`). */
  relativePath: string;
  absolutePath: string;
  /** Turn number for `verify`, from the first digits of the turn directory name; else null. */
  turn: number | null;
}

export interface ExecutionFileListing {
  /** `missing` when the execution directory is absent, `unreadable` when it cannot be listed. */
  state: 'ok' | 'missing' | 'unreadable';
  files: ExecutionFile[];
  /** Whether the execution contains an artifacts directory. */
  hasArtifacts: boolean;
  /** Error code when `artifacts/` exists but cannot be listed; null otherwise. */
  artifactsError: string | null;
}

const FIXED_FILES: readonly { name: string; kind: ExecutionFileKind }[] = [
  { name: 'task.md', kind: 'task' },
  { name: 'prompt.md', kind: 'prompt' },
  { name: 'response.md', kind: 'response' },
  { name: 'questions.json', kind: 'questions' },
  { name: 'stream.jsonl', kind: 'stream' },
];

function code(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function listDir(absolute: string): { names: string[]; files: string[]; directories: string[] } | { error: string } {
  try {
    const entries = readdirSync(absolute, { withFileTypes: true });
    return {
      names: entries.map((entry) => entry.name),
      files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    };
  } catch (error) {
    return { error: code(error) };
  }
}

function turnNumber(name: string): number | null {
  const match = /\d+/.exec(name);
  return match === null ? null : Number(match[0]);
}

function verifyFiles(executionDirPath: string): ExecutionFile[] {
  const turns = listDir(path.join(executionDirPath, 'turns'));
  if ('error' in turns) return [];
  return turns.names
    .filter((turn) => isFile(path.join(executionDirPath, 'turns', turn, 'verify.md')))
    .sort((a, b) => (turnNumber(a) ?? Infinity) - (turnNumber(b) ?? Infinity) || a.localeCompare(b))
    .map((turn) => ({
      kind: 'verify',
      relativePath: `turns/${turn}/verify.md`,
      absolutePath: path.join(executionDirPath, 'turns', turn, 'verify.md'),
      turn: turnNumber(turn),
    }));
}

function artifactFiles(executionDirPath: string): { files: ExecutionFile[]; error: string | null } {
  const artifacts = listDir(path.join(executionDirPath, 'artifacts'));
  if ('error' in artifacts) {
    const isAbsent = artifacts.error === 'ENOENT' || artifacts.error === 'ENOTDIR';
    return { files: [], error: isAbsent ? null : artifacts.error };
  }
  const files = artifacts.files
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      kind: 'artifact' as const,
      relativePath: `artifacts/${name}`,
      absolutePath: path.join(executionDirPath, 'artifacts', name),
      turn: null,
    }));
  return { files, error: null };
}

/**
 * List the files of one execution directory that exist now: absent files are omitted,
 * never guessed. Called when an execution node is expanded; nothing is cached.
 */
export function listExecutionFiles(executionDirPath: string): ExecutionFileListing {
  const top = listDir(executionDirPath);
  if ('error' in top) {
    const state = top.error === 'ENOENT' || top.error === 'ENOTDIR' ? 'missing' : 'unreadable';
    return { state, files: [], hasArtifacts: false, artifactsError: null };
  }
  const fixed: ExecutionFile[] = FIXED_FILES.filter(({ name }) => top.files.includes(name)).map(({ name, kind }) => ({
    kind,
    relativePath: name,
    absolutePath: path.join(executionDirPath, name),
    turn: null,
  }));
  const artifacts = artifactFiles(executionDirPath);
  return {
    state: 'ok',
    files: [...fixed, ...verifyFiles(executionDirPath), ...artifacts.files],
    hasArtifacts: top.directories.includes('artifacts'),
    artifactsError: artifacts.error,
  };
}
