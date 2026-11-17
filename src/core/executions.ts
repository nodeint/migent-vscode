import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { SessionExecution } from '@nodeint/migent-contracts';

import { asSessionId } from './manifest';
import { EXECUTIONS_DIRNAME, FAILURE_REPORT_FILENAME } from './paths';
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

const REQUIRED_STRING_FIELDS = [
  'execution_id',
  'stage_id',
  'status',
  'created_at',
] as const satisfies readonly (keyof SessionExecution)[];
const NULLABLE_STRING_FIELDS = [
  'completed_at',
  'client',
  'model',
  'agent_id',
  'resumes_execution_id',
  'failure_reason',
  'provider_endpoint',
] as const satisfies readonly (keyof SessionExecution)[];
const OPTIONAL_STRING_FIELDS = [
  'artifact_directory',
  'kind',
  'error',
  'turn_kind',
  'hostname',
] as const satisfies readonly (keyof SessionExecution)[];
const OPTIONAL_RECORD_FIELDS = [
  'options',
  'skip',
  'outcome',
  'corrections',
] as const satisfies readonly (keyof SessionExecution)[];
const OPTIONAL_NUMBER_FIELDS = [
  'final_turn',
  'response_protocol',
  'owner_pid',
] as const satisfies readonly (keyof SessionExecution)[];

const SCHEMA_V1 = 1;
const SCHEMA_V2 = 2;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Copy the optional contract fields that have the right type; a wrong-typed one is dropped. */
function copyOptionalFields(value: Record<string, unknown>): Partial<SessionExecution> {
  const result: Record<string, unknown> = {};
  for (const name of OPTIONAL_STRING_FIELDS) {
    const field = nonEmpty(value[name]);
    if (field !== undefined) result[name] = field;
  }
  for (const name of NULLABLE_STRING_FIELDS) {
    const field = value[name];
    if (field === null || nonEmpty(field) !== undefined) result[name] = field;
  }
  for (const name of OPTIONAL_RECORD_FIELDS) {
    const field = value[name];
    if (isRecord(field)) result[name] = field;
  }
  for (const name of OPTIONAL_NUMBER_FIELDS) {
    const field = value[name];
    if (typeof field === 'number') result[name] = field;
  }
  const providerPid = value.provider_pid;
  if (providerPid === null || typeof providerPid === 'number') result.provider_pid = providerPid;
  const version = value.schema_version;
  if (version === SCHEMA_V1 || version === SCHEMA_V2) result.schema_version = version;
  return result;
}

/**
 * Parse `execution.json` as the contract's `SessionExecution`. A missing or wrong-typed required field
 * (`session_id`, `execution_id`, `execution_order`, `stage_id`, `stage_attempt`, `status`, `created_at`) rejects
 * the record (null); an optional field of the wrong type is dropped. The large `turns` and `verify` values are
 * not kept: nothing here reads them.
 */
export function parseExecution(value: unknown): SessionExecution | null {
  if (!isRecord(value)) return null;
  const sessionId = asSessionId(value.session_id);
  const [executionId, stageId, status, createdAt] = REQUIRED_STRING_FIELDS.map((name) => nonEmpty(value[name]));
  const { execution_order: order, stage_attempt: attempt } = value;
  if (
    sessionId === null ||
    executionId === undefined ||
    stageId === undefined ||
    status === undefined ||
    createdAt === undefined ||
    typeof order !== 'number' ||
    typeof attempt !== 'number'
  ) {
    return null;
  }
  return {
    session_id: sessionId,
    execution_id: executionId,
    execution_order: order,
    stage_id: stageId,
    stage_attempt: attempt,
    status,
    created_at: createdAt,
    ...copyOptionalFields(value),
  };
}

/**
 * One execution as listed: the contract record plus the facts of its directory (D3d). `order` and `attempt` come
 * from the directory name when it follows the pattern, else from the record.
 */
export interface ExecutionEntry {
  execution: SessionExecution;
  id: string;
  order: number;
  attempt: number;
  /** Whether the execution wrote `failure.md` (CLI 0.3.6 and later); old sessions have none. */
  hasFailureReport: boolean;
}

function readExecutionRecord(executionJsonPath: string): SessionExecution | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(executionJsonPath, 'utf8'));
  } catch {
    return null;
  }
  return parseExecution(value);
}

function outcomeOf(execution: SessionExecution): Record<string, unknown> {
  return isRecord(execution.outcome) ? execution.outcome : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `outcome.decision`; null when absent. */
export function executionDecision(execution: SessionExecution): string | null {
  return str(outcomeOf(execution).decision);
}

/** `outcome.blocker` recorded when the execution blocked; null otherwise. */
export function executionBlocker(execution: SessionExecution): string | null {
  return str(outcomeOf(execution).blocker);
}

/** `outcome.status` (`question` when the attempt ended by asking); null when absent. */
export function executionOutcomeStatus(execution: SessionExecution): string | null {
  return str(outcomeOf(execution).status);
}

/** `options.effort`, else `options.model_reasoning_effort` (codex); null when absent. */
export function executionEffort(execution: SessionExecution): string | null {
  if (!isRecord(execution.options)) return null;
  const { effort, model_reasoning_effort: reasoningEffort } = execution.options;
  return str(effort) ?? str(reasoningEffort);
}

const CAUSE_MAX = 200;

function clip(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const flat = value.replaceAll(/\s+/g, ' ').trim();
  return flat.length > CAUSE_MAX ? `${flat.slice(0, CAUSE_MAX - 1)}…` : flat;
}

/**
 * The CLI records `failure_reason` (such as `verify_failed`) and `error` at the top level of `execution.json`;
 * an `outcome.error` or `outcome.message` is accepted too. The reason code is shown as words.
 */
export function executionCause(execution: SessionExecution | null): string | null {
  if (execution === null) return null;
  const outcome = outcomeOf(execution);
  const detail = clip(execution.error) ?? clip(outcome.error) ?? clip(outcome.message);
  const reason = clip(execution.failure_reason) ?? clip(outcome.failure_reason);
  const words = reason?.replaceAll('_', ' ') ?? null;
  if (words !== null && detail !== null) return `${words}: ${detail}`;
  return words ?? detail;
}

function entryFrom(executionDirPath: string): ExecutionEntry | null {
  const execution = readExecutionRecord(path.join(executionDirPath, 'execution.json'));
  if (execution === null) return null;
  const parsed = parseExecutionId(path.basename(executionDirPath));
  return {
    execution,
    id: execution.execution_id,
    order: parsed?.order ?? execution.execution_order,
    attempt: parsed?.attempt ?? execution.stage_attempt,
    hasFailureReport: isFile(path.join(executionDirPath, FAILURE_REPORT_FILENAME)),
  };
}

/**
 * List the executions of one session, oldest first. Reads each execution.json;
 * callers load this lazily (node expanded, or the session is running). An execution whose record is missing,
 * unparsable or lacks a required contract field is omitted (B4).
 */
export function listExecutions(sessionDirPath: string): ExecutionEntry[] {
  let entries;
  try {
    entries = readdirSync(path.join(sessionDirPath, EXECUTIONS_DIRNAME), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: ExecutionEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const row = entryFrom(path.join(sessionDirPath, EXECUTIONS_DIRNAME, entry.name));
    if (row !== null) rows.push(row);
  }
  rows.sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : 1));
  return rows;
}

/** One execution from its directory, for a targeted refresh. Null when the directory or a valid record is absent. */
export function readExecutionSummary(executionDirPath: string): ExecutionEntry | null {
  if (!statSyncSafe(executionDirPath)) return null;
  return entryFrom(executionDirPath);
}

/** The contract record of one execution, for views that show details. Null when absent or invalid. */
export function readExecution(executionDirPath: string): SessionExecution | null {
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

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
