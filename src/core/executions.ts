import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ExecutionSnapshot } from './model';
import { EXECUTIONS_DIRNAME } from './paths';
import { isRecord } from './record';

const EXECUTION_ID_PATTERN = /^(\d+)-(.+)--attempt-(\d+)$/;

export interface ParsedExecutionId {
  order: number;
  stageId: string;
  attempt: number;
}

/** Directory and event ids use `0003-stage--attempt-01`. The stage portion may contain hyphens. */
export function parseExecutionId(executionId: string): ParsedExecutionId | null {
  const match = EXECUTION_ID_PATTERN.exec(executionId);
  if (match === null) return null;
  return { order: Number(match[1]), stageId: match[2], attempt: Number(match[3]) };
}

function readExecutionRecord(executionJsonPath: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(executionJsonPath, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function outcomeFrom(record: Record<string, unknown> | null): Record<string, unknown> {
  return isRecord(record?.outcome) ? record.outcome : {};
}

function stageFrom(record: Record<string, unknown> | null, parsed: ParsedExecutionId | null): string {
  return str(record?.stage_id) ?? parsed?.stageId ?? '';
}

function summaryFrom(dirName: string, record: Record<string, unknown> | null): ExecutionSnapshot {
  const parsed = parseExecutionId(dirName);
  const outcome = outcomeFrom(record);

  return {
    id: str(record?.execution_id) ?? dirName,
    order: parsed?.order ?? numberOr(record?.execution_order, 0),
    stage: stageFrom(record, parsed),
    attempt: parsed?.attempt ?? numberOr(record?.stage_attempt, 1),
    status: str(record?.status),
    decision: str(outcome.decision),
    provider: str(record?.provider),
    model: str(record?.model),
  };
}

/**
 * List the executions of one session, oldest first. Reads each execution.json;
 * callers load this lazily (node expanded, or the session is running). A record
 * that fails to parse still yields a summary from the directory name.
 */
export function listExecutions(sessionDirPath: string): ExecutionSnapshot[] {
  let entries;
  try {
    entries = readdirSync(path.join(sessionDirPath, EXECUTIONS_DIRNAME), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: ExecutionSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = readExecutionRecord(
      path.join(sessionDirPath, EXECUTIONS_DIRNAME, entry.name, 'execution.json'),
    );
    rows.push(summaryFrom(entry.name, record));
  }
  rows.sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : 1));
  return rows;
}

/** Full execution.json for one execution, for views that show details. */
export function readExecution(executionDirPath: string): Record<string, unknown> | null {
  if (!statSyncSafe(executionDirPath)) return null;
  return readExecutionRecord(path.join(executionDirPath, 'execution.json'));
}

function statSyncSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
