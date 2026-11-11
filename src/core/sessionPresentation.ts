import { text } from '../text';
import { formatDuration } from './duration';
import type { ExecutionFile } from './executionFiles';
import { parseExecutionId } from './executions';
import type { ExecutionSnapshot, ScanOutcome, SessionSnapshot, UnknownReason } from './model';
import { describeQuotaReset, quotaFailure } from './replyFlow';

/** Plain-text presentation of sessions for tree views. Nothing here reads disk or imports `vscode`. */

export const LABEL_MAX_LENGTH = 60;
const SHORT_ID_LENGTH = 8;
const MS_PER_SECOND = 1000;
const JUST_NOW_SECONDS = 5;

export { formatDuration };

export function shortId(sessionId: string): string {
  return sessionId.slice(0, SHORT_ID_LENGTH);
}

export function truncate(text: string, max: number = LABEL_MAX_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Full title: `title.json` overlay, else manifest title, else status title, else workflow id, else the short id. */
export function sessionTitle(snapshot: SessionSnapshot): string {
  const { manifest, status } = snapshot;
  const { titleOverride } = snapshot;
  return titleOverride ?? manifest?.title ?? status?.title ?? status?.workflowId ?? shortId(snapshot.sessionId);
}

export function sessionLabel(snapshot: SessionSnapshot): string {
  return truncate(sessionTitle(snapshot));
}

/** `just now` or `<duration> ago`, for a time in the past. */
export function formatAgo(ms: number): string {
  if (ms < JUST_NOW_SECONDS * MS_PER_SECOND) return text('views.justNow');
  const [first = ''] = formatDuration(ms).split(' ');
  return text('views.ago', { duration: first });
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
      return text('views.unknownStatusMissing');
    case 'unreadable-status':
      return text('views.unknownStatusUnreadable');
    case 'invalid-status':
      return text('views.unknownStatusInvalid');
    case 'invalid-manifest':
      return text('views.unknownManifestInvalid');
    case 'unsupported-schema':
      return text('views.unknownSchema', { version: String(snapshot.manifest?.schemaVersion ?? unavailable()) });
    case 'unrecognized-status':
      return text('views.unknownStatus', { status: snapshot.status?.status ?? unavailable() });
    case undefined:
      return unavailable();
  }
}

/** Icon id: Unknown is told apart by reason, every other state uses the display state's icon. */
export function sessionIcon(snapshot: SessionSnapshot): string {
  const reason: UnknownReason | undefined = snapshot.displayState.unknownReason;
  if (reason === undefined) return snapshot.displayState.icon;
  return reason === 'unsupported-schema' || reason === 'unrecognized-status' ? 'question' : 'bracket-error';
}

function unavailable(): string {
  return text('views.unavailable');
}

function questionsText(count: number): string {
  return text('views.questionCount', { count });
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
  if (parsed !== null) return text('views.tooltipStageAttempt', { stage: parsed.stageId, attempt: parsed.attempt });
  const stage = snapshot.status?.latestStageId ?? null;
  return stage === null ? null : text('views.tooltipStage', { stage });
}

function eventLine(snapshot: SessionSnapshot): string | null {
  const event = snapshot.status?.latestProviderEvent ?? null;
  if (event === null) return null;
  const detail = [event.event, event.summary, event.client].filter((part) => part !== null).join(' · ');
  return detail === '' ? null : text('views.tooltipEvent', { detail });
}

function blockerLine(snapshot: SessionSnapshot): string | null {
  const { status } = snapshot;
  if (snapshot.displayState.state === 'blocked' && status !== null) {
    return text('views.tooltipBlockedBy', { ids: status.blockedByExecutionIds.join(', ') || unavailable() });
  }
  if (snapshot.displayState.state === 'failed') return text('views.tooltipLatestExecution', { status: status?.latestExecutionStatus ?? unavailable() });
  return null;
}

function quotaLine(snapshot: SessionSnapshot): string | null {
  const failure = quotaFailure(snapshot);
  return failure === null ? null : text('states.quotaFailed', { reset: describeQuotaReset(failure) });
}

function updateLine(snapshot: SessionSnapshot, now: number): string {
  const updatedAt = snapshot.status?.updatedAt ?? null;
  const updated = parseTime(updatedAt);
  const value = updated === null
    ? unavailable()
    : text('views.tooltipLastUpdateAgo', { at: updatedAt ?? '', ago: formatAgo(now - updated) });
  return text('views.tooltipLastUpdate', { value });
}

/** Multi-line tooltip. Missing values read "unavailable"; the full provider event is never shown. */
export function sessionTooltip(snapshot: SessionSnapshot, now: number): string {
  const questions = pendingQuestionTotal(snapshot);
  const lines: (string | null)[] = [
    sessionTitle(snapshot),
    text('views.tooltipState', { state: stateTitle(snapshot) }),
    snapshot.displayState.unknownReason === undefined ? null : text('views.tooltipReason', { reason: unknownReasonText(snapshot) }),
    text('views.tooltipWorkflow', { workflow: snapshot.status?.workflowId ?? snapshot.manifest?.workflowId ?? unavailable() }),
    stageLine(snapshot),
    blockerLine(snapshot),
    quotaLine(snapshot),
    questions > 0 ? text('views.tooltipPendingQuestions', { count: questions }) : null,
    snapshot.displayState.writable ? null : text('views.tooltipForeignLock'),
    updateLine(snapshot, now),
    eventLine(snapshot),
    text('views.tooltipSession', { id: snapshot.sessionId }),
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** `session.<state>` plus `;questions`, `;foreign`, `;outputs`, `;role`, `;reason-<reason>` in that order. */
export function sessionContextValue(snapshot: SessionSnapshot): string {
  const flags = [
    pendingQuestionTotal(snapshot) > 0 ? 'questions' : null,
    snapshot.displayState.writable ? null : 'foreign',
    (snapshot.status?.outputs.length ?? 0) > 0 ? 'outputs' : null,
    (snapshot.manifest?.role ?? null) === null ? null : 'role',
    snapshot.replyTargets.length > 0 ? 'reply' : null,
    snapshot.displayState.unknownReason === undefined ? null : `reason-${snapshot.displayState.unknownReason}`,
  ].filter((flag): flag is string => flag !== null);
  return [`session.${snapshot.displayState.state}`, ...flags].join(';');
}

export function executionLabel(execution: ExecutionSnapshot): string {
  return text('views.executionLabel', { stage: execution.stage || execution.id, attempt: execution.attempt });
}

export function executionDescription(execution: ExecutionSnapshot): string {
  const client = [execution.client, execution.model].filter((part) => part !== null).join('/');
  return [client === '' ? null : client, execution.decision]
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

/** `execution.<status>` plus `;failure` when the execution wrote a `failure.md` report. */
export function executionContextValue(execution: ExecutionSnapshot): string {
  const base = `execution.${execution.status ?? 'unknown'}`;
  return execution.hasFailureReport ? `${base};failure` : base;
}

export function executionFileLabel(file: ExecutionFile): string {
  if (file.kind === 'verify') return text('views.verifyFile', { turn: String(file.turn ?? '?') });
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
    return { code: 'scan-unreadable', label: text('views.cannotReadSessions'), detail: scan.error };
  }
  return scan.eligible.length === 0 ? { code: 'no-sessions', label: text('views.noSessions'), detail: null } : null;
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
