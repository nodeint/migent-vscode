import { readFileSync } from 'node:fs';

import type { ProviderEventSummary, PublishedOutput, RunningStage, SessionStatus } from './model';
import { parsePendingQuestions } from './questions';
import { isRecord } from './record';

/** Delay between retries when status.json does not parse (a rename can be observed mid-flight on Windows). */
export const STATUS_RETRY_DELAY_MS = 100;
export const STATUS_MAX_ATTEMPTS = 3;

export type StatusRead =
  | { kind: 'ok'; status: SessionStatus }
  | { kind: 'missing' }
  | { kind: 'error'; reason: 'unreadable' | 'invalid' };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function blockedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function runningStages(value: unknown): RunningStage[] {
  if (!Array.isArray(value)) return [];
  const rows: RunningStage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const raw = entry;
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

function publishedOutputs(value: unknown): PublishedOutput[] {
  if (!isRecord(value)) return [];
  const rows: PublishedOutput[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const outputPath = asString(entry.path);
    if (outputPath === null) continue;
    rows.push({
      name,
      path: outputPath,
      sourceExecutionId: asString(entry.source_execution_id),
      publishedByExecutionId: asString(entry.published_by_execution_id),
    });
  }
  return rows;
}

/** Keep only the small scalar fields: the full event can carry very large `details` and `usage`. */
function providerEventSummary(value: unknown): ProviderEventSummary | null {
  if (!isRecord(value)) return null;
  return {
    event: asString(value.event),
    summary: asString(value.summary),
    stageId: asString(value.stage_id),
    executionId: asString(value.execution_id),
    provider: asString(value.provider),
    timestamp: asString(value.timestamp),
  };
}

export function parseStatus(text: string): SessionStatus | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { latest_provider_event: providerEvent, ...raw } = value;
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
    questions: parsePendingQuestions(raw.questions),
    outputs: publishedOutputs(raw.outputs),
    latestProviderEvent: providerEventSummary(providerEvent),
    raw,
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

function attemptRead(statusPath: string): StatusRead {
  let text: string;
  try {
    text = readFileSync(statusPath, 'utf8');
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'error', reason: 'unreadable' };
  }
  const status = parseStatus(text);
  return status === null ? { kind: 'error', reason: 'invalid' } : { kind: 'ok', status };
}

/**
 * Read `status.json`. The file is written atomically, so a parse error means the
 * read raced a write (seen during renames on Windows): retry after 100 ms, up to
 * 3 attempts, then give up and let the caller mark the session Unknown.
 */
export function readStatus(statusPath: string): StatusRead {
  let last: StatusRead = { kind: 'error', reason: 'unreadable' };
  for (let i = 0; i < STATUS_MAX_ATTEMPTS; i += 1) {
    if (i > 0) sleepSync(STATUS_RETRY_DELAY_MS);
    last = attemptRead(statusPath);
    if (last.kind !== 'error') return last;
  }
  return last;
}
