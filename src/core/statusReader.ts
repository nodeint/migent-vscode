import { readFileSync } from 'node:fs';

import type { RunningStage, SessionStatus } from './model';

/** Delay between retries when status.json does not parse (a rename can be observed mid-flight on Windows). */
export const STATUS_RETRY_DELAY_MS = 100;
export const STATUS_MAX_ATTEMPTS = 3;

export type StatusRead =
  | { kind: 'ok'; status: SessionStatus }
  | { kind: 'missing' }
  | { kind: 'error' };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function blockedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function runningStages(value: unknown): RunningStage[] {
  if (!Array.isArray(value)) return [];
  const rows: RunningStage[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    rows.push({
      executionId: asString(raw.execution_id),
      stageId: asString(raw.stage_id),
      provider: asString(raw.provider),
      event: asString(raw.event),
      summary: asString(raw.summary),
      updatedAt: asString(raw.updated_at),
    });
  }
  return rows;
}

export function parseStatus(text: string): SessionStatus | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    status: asString(raw.status),
    workflowId: asString(raw.workflow_id),
    title: asString(raw.title),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
    latestExecutionId: asString(raw.latest_execution_id),
    latestExecutionStatus: asString(raw.latest_execution_status),
    latestStageId: asString(raw.latest_stage_id),
    latestDecision: asString(raw.latest_decision),
    blockedByExecutionIds: blockedIds(raw.blocked_by_execution_ids),
    runningStages: runningStages(raw.running_stages),
    raw,
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function attemptRead(statusPath: string): StatusRead {
  let text: string;
  try {
    text = readFileSync(statusPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'error' };
  }
  const status = parseStatus(text);
  return status === null ? { kind: 'error' } : { kind: 'ok', status };
}

/**
 * Read `status.json`. The file is written atomically, so a parse error means the
 * read raced a write (seen during renames on Windows): retry after 100 ms, up to
 * 3 attempts, then give up and let the caller mark the session Unknown.
 */
export function readStatus(statusPath: string): StatusRead {
  let last: StatusRead = { kind: 'error' };
  for (let i = 0; i < STATUS_MAX_ATTEMPTS; i += 1) {
    if (i > 0) sleepSync(STATUS_RETRY_DELAY_MS);
    last = attemptRead(statusPath);
    if (last.kind !== 'error') return last;
  }
  return last;
}
