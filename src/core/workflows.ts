import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import type { DirectoryState } from './model';
import { workflowsDir } from './paths';
import { isRecord } from './record';

export type WorkflowEntryState = 'ok' | 'invalid' | 'unreadable';

export interface WorkflowEntry {
  /** Workflow id from the file body, else the file name without extension. */
  id: string;
  file: string;
  state: WorkflowEntryState;
  /** Parse or read error text; null when `state` is `ok`. */
  error: string | null;
  title: string | null;
  /** Stage ids in declaration order, for display. */
  stages: string[];
  /** True when another `ok` entry declares the same id. Set by `markDuplicates`. */
  duplicate: boolean;
}

export interface WorkflowScan {
  state: DirectoryState;
  error: string | null;
  /** Ordered by id, then file name. */
  entries: WorkflowEntry[];
}

function stageIds(parsed: unknown): string[] {
  if (!isRecord(parsed)) return [];
  const { stages } = parsed;
  if (!Array.isArray(stages)) return [];
  const ids: string[] = [];
  for (const stage of stages) {
    if (!isRecord(stage)) continue;
    const { id } = stage;
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return ids;
}

export function isWorkflowFile(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function fallbackId(file: string): string {
  return path.basename(file, path.extname(file));
}

function failed(file: string, state: 'invalid' | 'unreadable', error: unknown): WorkflowEntry {
  return { id: fallbackId(file), file, state, error: errorText(error), title: null, stages: [], duplicate: false };
}

/**
 * Read one workflow file by name. Null when the file no longer exists, so a caller
 * reacting to a delete event can drop the entry. Unreadable or unparsable files
 * stay listed with their error: nothing is skipped silently.
 */
export function readWorkflowFile(projectRoot: string, file: string): WorkflowEntry | null {
  let text: string;
  try {
    text = readFileSync(path.join(workflowsDir(projectRoot), file), 'utf8');
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'ENOENT') return null;
    return failed(file, 'unreadable', error);
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return failed(file, 'invalid', error);
  }
  const body = isRecord(parsed) ? parsed : null;
  return {
    id: typeof body?.id === 'string' && body.id !== '' ? body.id : fallbackId(file),
    file,
    state: 'ok',
    error: null,
    title: typeof body?.title === 'string' && body.title !== '' ? body.title : null,
    stages: stageIds(parsed),
    duplicate: false,
  };
}

/** Sort entries and flag every `ok` entry whose id is shared with another `ok` entry. */
export function markDuplicates(entries: WorkflowEntry[]): WorkflowEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.state === 'ok') counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  return entries
    .map((entry) => ({ ...entry, duplicate: entry.state === 'ok' && (counts.get(entry.id) ?? 0) > 1 }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.file.localeCompare(right.file));
}

/** Scan `.migent/workflows/*.{yaml,yml}`; missing, empty and unreadable are distinct outcomes. */
export function scanWorkflows(projectRoot: string): WorkflowScan {
  let names: string[];
  try {
    names = readdirSync(workflowsDir(projectRoot), { withFileTypes: true })
      .filter((entry) => entry.isFile() && isWorkflowFile(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
    const state = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
    return { state, error: state === 'unreadable' ? code : null, entries: [] };
  }
  const entries: WorkflowEntry[] = [];
  for (const name of names) {
    const entry = readWorkflowFile(projectRoot, name);
    if (entry !== null) entries.push(entry);
  }
  return { state: entries.length === 0 ? 'empty' : 'ok', error: null, entries: markDuplicates(entries) };
}
