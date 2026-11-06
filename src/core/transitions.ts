import path from 'node:path';

import { listExecutionFiles } from './executionFiles';
import { readExecution } from './executions';
import type { SessionSnapshot } from './model';
import { EXECUTIONS_DIRNAME } from './paths';
import { isRecord } from './record';
import { blockedTargets, blockKind } from './replyFlow';

/** State-transition notifications (plans/03c-reply-notifications.md §3). No `vscode` import. */

export type NotifyKind = 'blocked' | 'failed' | 'quota' | 'completed';

export interface Transition {
  kind: NotifyKind;
  project: string;
  sessionId: string;
  /** The execution the state belongs to; null when status.json names none. */
  executionId: string | null;
}

/** The notifiable condition a snapshot is in right now, or null. */
export function currentTransition(project: string, snapshot: SessionSnapshot): Transition | null {
  const { status } = snapshot;
  const base = { project, sessionId: snapshot.sessionId };
  const latest = status?.latestExecutionId ?? null;
  switch (snapshot.displayState.state) {
    case 'failed':
      // A failed execution that is really a quota wait is announced as one, with Retry instead of Continue.
      return blockKind(snapshot) === 'quota'
        ? { ...base, kind: 'quota', executionId: latest }
        : { ...base, kind: 'failed', executionId: latest };
    case 'completed':
      return { ...base, kind: 'completed', executionId: latest };
    case 'blocked':
      return blockKind(snapshot) === 'blocker'
        ? { ...base, kind: 'blocked', executionId: blockedTargets(snapshot)[0]?.executionId ?? latest }
        : null;
    case 'stopped':
      return blockKind(snapshot) === 'quota'
        ? {
            ...base,
            kind: 'quota',
            executionId: [status?.latestProviderEvent?.executionId, latest].find((id) => typeof id === 'string') ?? null,
          }
        : null;
    default:
      return null;
  }
}

/**
 * Remembers which `(session, execution, kind)` conditions were already seen. Seeding (startup, refresh, project
 * discovery) records the current ones silently, so a window opening never replays old notifications; afterwards
 * each new condition is returned exactly once, however many file events repeat it.
 */
export class TransitionTracker {
  readonly #seen = new Set<string>();

  public observe(project: string, snapshot: SessionSnapshot | undefined, isSeed: boolean): Transition | null {
    if (snapshot === undefined) return null;
    const transition = currentTransition(project, snapshot);
    if (transition === null) return null;
    const key = JSON.stringify([project, snapshot.sessionId, transition.kind, transition.executionId]);
    if (this.#seen.has(key)) return null;
    this.#seen.add(key);
    return isSeed ? null : transition;
  }
}

export interface FailureDetails {
  /** One concise sentence about the cause, or null when the execution records none. */
  cause: string | null;
  /** Absolute path of the exact verify or response file for the failing execution, when one exists. */
  file: { kind: 'verify' | 'response'; absolutePath: string } | null;
  /** Absolute path of the execution's `failure.md` report, written by CLI 0.3.6 and later. */
  failureReport: string | null;
  stageId: string | null;
  attempt: number | null;
}

export const FAILURE_REPORT_BUTTON = 'Open failure report';

/**
 * Button labels of a failed-execution notification. The failure report button needs a report that exists;
 * older executions have none, so their notification keeps the existing buttons.
 */
export function failureButtons(details: FailureDetails | undefined): string[] {
  const file = details?.file ?? null;
  const report = details?.failureReport ?? null;
  return [
    'Continue',
    ...(report === null ? [] : [FAILURE_REPORT_BUTTON]),
    ...(file === null ? [] : [file.kind === 'verify' ? 'Open verify' : 'Open response']),
    'View log',
  ];
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
function causeOf(record: Record<string, unknown> | null): string | null {
  const outcome = record !== null && isRecord(record.outcome) ? record.outcome : {};
  const detail = clip(record?.error) ?? clip(outcome.error) ?? clip(outcome.message);
  const reason = clip(record?.failure_reason) ?? clip(outcome.failure_reason);
  const words = reason?.replaceAll('_', ' ') ?? null;
  if (words !== null && detail !== null) return `${words}: ${detail}`;
  return words ?? detail;
}

/** The cause and the exact files of a failed execution. Verify output is preferred when the failure names it. */
export function failureDetails(sessionDir: string, executionId: string | null): FailureDetails {
  if (executionId === null) {
    return { cause: null, file: null, failureReport: null, stageId: null, attempt: null };
  }
  const dir = path.join(sessionDir, EXECUTIONS_DIRNAME, executionId);
  const record = readExecution(dir);
  const cause = causeOf(record);
  const { files } = listExecutionFiles(dir);
  const verify = files.filter((file) => file.kind === 'verify').at(-1);
  const response = files.find((file) => file.kind === 'response');
  const failureReport = files.find((file) => file.kind === 'failure')?.absolutePath ?? null;
  const reason = typeof record?.failure_reason === 'string' ? record.failure_reason : '';
  const isVerifyFailure = /verify/i.test(reason);
  let file: FailureDetails['file'] = null;
  if (verify !== undefined && (isVerifyFailure || response === undefined)) {
    file = { kind: 'verify', absolutePath: verify.absolutePath };
  } else if (response !== undefined) {
    file = { kind: 'response', absolutePath: response.absolutePath };
  }
  const stageId = typeof record?.stage_id === 'string' ? record.stage_id : null;
  const attempt = typeof record?.stage_attempt === 'number' ? record.stage_attempt : null;
  return { cause, file, failureReport, stageId, attempt };
}
