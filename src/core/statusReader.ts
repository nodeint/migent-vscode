import { readFileSync } from 'node:fs';

import type { SessionStatusFile } from '@nodeint/migent-contracts';

import { asSessionId } from './manifest';
import { isRecord } from './record';

/** Delay between retries when status.json does not parse (a rename can be observed mid-flight on Windows). */
export const STATUS_RETRY_DELAY_MS = 100;
export const STATUS_MAX_ATTEMPTS = 3;

export type StatusRead =
  | { kind: 'ok'; status: SessionStatusFile }
  | { kind: 'missing' }
  | { kind: 'error'; reason: 'unreadable' | 'invalid' };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const OPTIONAL_STRING_FIELDS = [
  'title',
  'workflow_id',
  'workflow_path',
  'task',
  'created_at',
  'updated_at',
  'task_sha256',
  'latest_execution_id',
  'latest_execution_status',
  'latest_stage_id',
  'latest_decision',
  'completion_method',
  'terminal_execution_id',
] as const satisfies readonly (keyof SessionStatusFile)[];

/** Each output entry keeps the three `OutputRef` fields; an entry without a path is not a usable output. */
function publishedOutputs(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  // `Object.fromEntries` defines own data properties, so a name such as `__proto__` stays an entry.
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, entry]) => {
      const outputPath = isRecord(entry) ? asString(entry.path) : undefined;
      if (!isRecord(entry) || outputPath === undefined) return [];
      return [
        [
          name,
          {
            path: outputPath,
            ...optionalString('source_execution_id', entry.source_execution_id),
            ...optionalString('published_by_execution_id', entry.published_by_execution_id),
          },
        ],
      ];
    }),
  );
}

function optionalString(name: string, value: unknown): Record<string, string> {
  const text = asString(value);
  return text === undefined ? {} : { [name]: text };
}

/** Keep only the small scalar fields: the full event can carry very large `details` and `usage`. */
function providerEvent(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const retryAt = isRecord(value.details) ? asString(value.details.retry_at)?.trim() : undefined;
  return {
    ...optionalString('event', value.event),
    ...optionalString('summary', value.summary),
    ...optionalString('stage_id', value.stage_id),
    ...optionalString('execution_id', value.execution_id),
    ...optionalString('client', value.client),
    ...optionalString('timestamp', value.timestamp),
    ...(retryAt === undefined || retryAt === '' ? {} : { details: { retry_at: retryAt } }),
  };
}

/**
 * Parse `status.json` as the contract's `SessionStatusFile`. A missing or wrong-typed `session_id` or `status`
 * rejects the record; an optional field of the wrong type is dropped. Fields the contract does not declare
 * (`questions`, `running_stages`, `blocked_by_execution_ids`) are not read.
 */
export function parseStatus(text: string): SessionStatusFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const sessionId = asSessionId(value.session_id);
  const status = asString(value.status);
  if (sessionId === null || status === undefined) return null;
  return { session_id: sessionId, status, ...readOptionalFields(value) };
}

/** Copy the optional contract fields that have the right type; a wrong-typed one is dropped. */
function readOptionalFields(value: Record<string, unknown>): Partial<SessionStatusFile> {
  const result: Partial<SessionStatusFile> = {};
  for (const name of OPTIONAL_STRING_FIELDS) {
    const field = asString(value[name]);
    if (field !== undefined) result[name] = field;
  }
  const priorSessionId = asSessionId(value.prior_session_id);
  if (priorSessionId !== null) result.prior_session_id = priorSessionId;
  if (isRecord(value.handoff)) result.handoff = value.handoff;
  if (isRecord(value.baseline)) result.baseline = value.baseline;
  const outputs = publishedOutputs(value.outputs);
  if (outputs !== undefined) result.outputs = outputs;
  const event = providerEvent(value.latest_provider_event);
  if (event !== undefined) result.latest_provider_event = event;
  return result;
}

/** The scalar fields of `latest_provider_event` the views read. */
export type ProviderEventKey = 'event' | 'summary' | 'stage_id' | 'execution_id' | 'client' | 'timestamp';

/** One scalar of the latest provider event; null when the status has no event or the field is absent. */
export function providerEventField(status: SessionStatusFile | null | undefined, key: ProviderEventKey): string | null {
  const value = status?.latest_provider_event?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `details.retry_at` of the latest provider event (`provider.quota`); null when absent or blank. */
export function providerRetryAt(status: SessionStatusFile | null | undefined): string | null {
  const details = status?.latest_provider_event?.details;
  const value = isRecord(details) ? details.retry_at : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
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
