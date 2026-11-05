import { formatDuration } from './duration';
import type { ExecutionFile } from './executionFiles';
import { parseExecutionId } from './executions';
import type { ExecutionSnapshot, ScanOutcome, SessionSnapshot, UnknownReason } from './model';
import { blockKind, describeQuotaWait, quotaWait } from './replyFlow';

/** Plain-text presentation of sessions for tree views. Nothing here reads disk or imports `vscode`. */

export const LABEL_MAX_LENGTH = 60;
const SHORT_ID_LENGTH = 8;
const UNAVAILABLE = 'unavailable';

const MS_PER_SECOND = 1000;
const JUST_NOW_SECONDS = 5;

export { formatDuration };

export function shortId(sessionId: string): string {
  return sessionId.slice(0, SHORT_ID_LENGTH);
}

export function truncate(text: string, max: number = LABEL_MAX_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Full title: manifest title, else status title, else workflow id, else the short id. */
export function sessionTitle(snapshot: SessionSnapshot): string {
  const { manifest, status } = snapshot;
  return manifest?.title ?? status?.title ?? status?.workflowId ?? shortId(snapshot.sessionId);
}

export function sessionLabel(snapshot: SessionSnapshot): string {
  return truncate(sessionTitle(snapshot));
}

/** `just now` or `<duration> ago`, for a time in the past. */
export function formatAgo(ms: number): string {
  if (ms < JUST_NOW_SECONDS * MS_PER_SECOND) return 'just now';
  const [first] = formatDuration(ms).split(' ');
  return `${first} ago`;
}

function parseTime(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function pendingQuestionTotal(snapshot: SessionSnapshot): number {
  return snapshot.status?.questions.length ?? 0;
}

/** Why a session is Unknown, in words (for the row description and tooltip). */
export function unknownReasonText(snapshot: SessionSnapshot): string {
  switch (snapshot.displayState.unknownReason) {
    case 'missing-status':
      return 'status.json missing';
    case 'unreadable-status':
      return 'status.json unreadable';
    case 'invalid-status':
      return 'status.json invalid';
    case 'invalid-manifest':
      return 'manifest.yaml missing or invalid';
    case 'unsupported-schema':
      return `Unsupported schema version ${snapshot.manifest?.schemaVersion ?? UNAVAILABLE}`;
    case 'unrecognized-status':
      return `Unrecognized status "${snapshot.status?.status ?? UNAVAILABLE}"`;
    case undefined:
      return UNAVAILABLE;
  }
}

/** Icon id: Unknown is told apart by reason, every other state uses the display state's icon. */
export function sessionIcon(snapshot: SessionSnapshot): string {
  const reason: UnknownReason | undefined = snapshot.displayState.unknownReason;
  if (reason === undefined) return snapshot.displayState.icon;
  return reason === 'unsupported-schema' || reason === 'unrecognized-status' ? 'question' : 'bracket-error';
}

function questionsText(count: number): string {
  return `${count} ${count === 1 ? 'question' : 'questions'}`;
}

export function stageOf(snapshot: SessionSnapshot): string | null {
  const { status } = snapshot;
  if (snapshot.displayState.state === 'running') return status?.runningStages[0]?.stageId ?? status?.latestStageId ?? null;
  return status?.latestStageId ?? null;
}

/** Elapsed time since start for a Running session, time since the last update for the others. */
function timeText(snapshot: SessionSnapshot, now: number): string | null {
  const { status, manifest } = snapshot;
  if (snapshot.displayState.state === 'running') {
    const started = parseTime(status?.createdAt ?? manifest?.createdAt);
    return started === null ? null : formatDuration(now - started);
  }
  const updated = parseTime(status?.updatedAt);
  return updated === null ? null : formatAgo(now - updated);
}

/** `workflow · stage · elapsed`; Unknown shows its reason instead. */
export function sessionDescription(snapshot: SessionSnapshot, now: number): string {
  if (snapshot.displayState.state === 'unknown') return unknownReasonText(snapshot);
  const questions = pendingQuestionTotal(snapshot);
  const parts = [
    snapshot.status?.workflowId ?? snapshot.manifest?.workflowId ?? null,
    stageOf(snapshot),
    timeText(snapshot, now),
    questions > 0 ? questionsText(questions) : null,
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}

function stateTitle(snapshot: SessionSnapshot): string {
  const { state } = snapshot.displayState;
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stageLine(snapshot: SessionSnapshot): string | null {
  const id = snapshot.status?.latestExecutionId ?? null;
  const parsed = id === null ? null : parseExecutionId(id);
  if (parsed !== null) return `Stage: ${parsed.stageId} (attempt ${parsed.attempt})`;
  const stage = snapshot.status?.latestStageId ?? null;
  return stage === null ? null : `Stage: ${stage}`;
}

function eventLine(snapshot: SessionSnapshot): string | null {
  const event = snapshot.status?.latestProviderEvent ?? null;
  if (event === null) return null;
  const detail = [event.event, event.summary, event.provider].filter((part) => part !== null).join(' · ');
  return detail === '' ? null : `Latest event: ${detail}`;
}

function blockerLine(snapshot: SessionSnapshot): string | null {
  const { status } = snapshot;
  if (snapshot.displayState.state === 'blocked' && status !== null) {
    return `Blocked by: ${status.blockedByExecutionIds.join(', ') || UNAVAILABLE}`;
  }
  if (snapshot.displayState.state === 'failed') return `Latest execution: ${status?.latestExecutionStatus ?? UNAVAILABLE}`;
  return null;
}

function quotaLine(snapshot: SessionSnapshot, now: number): string | null {
  const wait = quotaWait(snapshot, now);
  return wait === null ? null : `Waiting for provider quota: ${describeQuotaWait(wait, now)}`;
}

function updateLine(snapshot: SessionSnapshot, now: number): string {
  const updatedAt = snapshot.status?.updatedAt ?? null;
  const updated = parseTime(updatedAt);
  return `Last update: ${updated === null ? UNAVAILABLE : `${updatedAt} (${formatAgo(now - updated)})`}`;
}

/** Multi-line tooltip. Missing values read "unavailable"; the full provider event is never shown. */
export function sessionTooltip(snapshot: SessionSnapshot, now: number): string {
  const questions = pendingQuestionTotal(snapshot);
  const lines: (string | null)[] = [
    sessionTitle(snapshot),
    `State: ${stateTitle(snapshot)}`,
    snapshot.displayState.unknownReason === undefined ? null : `Reason: ${unknownReasonText(snapshot)}`,
    `Workflow: ${snapshot.status?.workflowId ?? snapshot.manifest?.workflowId ?? UNAVAILABLE}`,
    stageLine(snapshot),
    blockerLine(snapshot),
    quotaLine(snapshot, now),
    questions > 0 ? `Pending questions: ${questions}` : null,
    snapshot.displayState.writable ? null : 'Lock held by another host',
    updateLine(snapshot, now),
    eventLine(snapshot),
    `Session: ${snapshot.sessionId}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** `session.<state>` plus `;questions`, `;quota`, `;foreign`, `;outputs`, `;reason-<reason>` in that order. */
export function sessionContextValue(snapshot: SessionSnapshot): string {
  const flags = [
    pendingQuestionTotal(snapshot) > 0 ? 'questions' : null,
    blockKind(snapshot) === 'quota' ? 'quota' : null,
    snapshot.displayState.writable ? null : 'foreign',
    (snapshot.status?.outputs.length ?? 0) > 0 ? 'outputs' : null,
    snapshot.displayState.unknownReason === undefined ? null : `reason-${snapshot.displayState.unknownReason}`,
  ].filter((flag): flag is string => flag !== null);
  return [`session.${snapshot.displayState.state}`, ...flags].join(';');
}

export function executionLabel(execution: ExecutionSnapshot): string {
  return `${execution.stage || execution.id} · attempt ${execution.attempt}`;
}

export function executionDescription(execution: ExecutionSnapshot): string {
  const provider = [execution.provider, execution.model].filter((part) => part !== null).join('/');
  return [provider === '' ? null : provider, execution.decision]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export function executionIcon(execution: ExecutionSnapshot): string {
  switch (execution.status) {
    case 'completed':
      return 'pass';
    case 'failed':
      return 'error';
    case 'running':
      return 'sync~spin';
    default:
      return 'circle-outline';
  }
}

export function executionContextValue(execution: ExecutionSnapshot): string {
  return `execution.${execution.status ?? 'unknown'}`;
}

export function executionFileLabel(file: ExecutionFile): string {
  if (file.kind === 'verify') return `verify · turn ${file.turn ?? '?'}`;
  return file.relativePath.split('/').pop() ?? file.relativePath;
}

export interface SessionsDiagnostic {
  code: 'scan-unreadable' | 'no-sessions';
  label: string;
  /** Error code for `scan-unreadable`. */
  detail: string | null;
}

/** The empty or error node for a project's sessions, or null when sessions exist. */
export function sessionsDiagnostic(scan: ScanOutcome): SessionsDiagnostic | null {
  if (scan.state === 'unreadable') {
    return { code: 'scan-unreadable', label: 'Cannot read the sessions folder', detail: scan.error };
  }
  return scan.eligible.length === 0 ? { code: 'no-sessions', label: 'No sessions yet', detail: null } : null;
}

/** `TreeItem.id` values (plans/02-monitoring.md §5.3). `project` is the host's `ProjectKey`. Never include state. */
export const nodeIds = {
  project: (project: string): string => `project:${project}`,
  group: (project: string, group: string): string => `group:${project}#${group}`,
  session: (project: string, sessionId: string): string => `session:${project}#${sessionId}`,
  execution: (project: string, sessionId: string, executionId: string): string =>
    `execution:${project}#${sessionId}/${executionId}`,
  file: (uri: string): string => `file:${uri}`,
  more: (project: string): string => `more:${project}`,
  diagnostic: (project: string, code: string): string => `diag:${project}#${code}`,
};
