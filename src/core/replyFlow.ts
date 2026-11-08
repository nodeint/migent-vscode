import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listExecutions, parseExecutionId, readExecution } from './executions';
import type { SessionSnapshot } from './model';
import { EXECUTIONS_DIRNAME } from './paths';
import { isRecord } from './record';

/** Rules for Reply, Continue without reply and quota failures (plans/03c-reply-notifications.md). No `vscode`. */

export type BlockKind = 'blocker' | 'question';

const QUOTA_EVENT = 'provider.quota';
const BLOCKER_TEXT_MAX = 400;

/**
 * Which kind of obstacle a session shows. A pending human question is never an ordinary blocker. A client quota
 * failure is an ordinary failed stage since CLI 0.5.1, so it is not an obstacle kind.
 */
export function blockKind(snapshot: SessionSnapshot): BlockKind | null {
  const { state } = snapshot.displayState;
  if (state === 'question' || (snapshot.status?.questions.length ?? 0) > 0) return 'question';
  if (state === 'blocked') return 'blocker';
  return null;
}

/** One blocked execution that a reply can answer. */
export interface BlockedTarget {
  executionId: string;
  stageId: string;
  attempt: number;
}

/** The blocked executions of an ordinary blocker, oldest first. Empty for any other session. */
export function blockedTargets(snapshot: SessionSnapshot): BlockedTarget[] {
  if (blockKind(snapshot) !== 'blocker') return [];
  const targets: BlockedTarget[] = [];
  for (const executionId of snapshot.status?.blockedByExecutionIds ?? []) {
    const parsed = parseExecutionId(executionId);
    if (parsed !== null) targets.push({ executionId, stageId: parsed.stageId, attempt: parsed.attempt });
  }
  return targets.sort((left, right) => left.executionId.localeCompare(right.executionId));
}

export interface QuotaFailure {
  /** Epoch ms of `retry_at`, or null when the CLI recorded none (or an unparsable value). Informational only. */
  retryAt: number | null;
}

/**
 * The client quota failure of a failed session, or null. The latest `provider.quota` event must belong to the
 * latest execution, so an unrelated later failure is never read as a quota failure. Since CLI 0.5.1 the CLI
 * neither waits nor retries; `session continue` reruns the stage at once and ignores `retry_at`.
 */
export function quotaFailure(snapshot: SessionSnapshot): QuotaFailure | null {
  if (snapshot.displayState.state !== 'failed') return null;
  const event = snapshot.status?.latestProviderEvent ?? null;
  if (event?.event !== QUOTA_EVENT) return null;
  const eventExecution = event.executionId ?? null;
  if (eventExecution !== null && eventExecution !== (snapshot.status?.latestExecutionId ?? null)) return null;
  const parsed = event.retryAt === null ? Number.NaN : Date.parse(event.retryAt);
  return { retryAt: Number.isNaN(parsed) ? null : parsed };
}

/** `Nov 3, 2026, 2:05 PM GMT+7`; says so instead of inventing a time when none is known. */
export function describeQuotaReset(failure: QuotaFailure, locale?: string): string {
  if (failure.retryAt === null) return 'no reset time was recorded';
  const absolute = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(failure.retryAt));
  return `resets ${absolute}`;
}

/** Stable identity of one reply draft: stage name alone is not enough once an attempt changes. */
export interface ReplyIdentity {
  project: string;
  sessionId: string;
  executionId: string;
}

export function replyDraftKey(identity: ReplyIdentity): string {
  return JSON.stringify([identity.project, identity.sessionId, identity.executionId]);
}

const HEADER_BEGIN = '<!-- migent-reply:begin -->';
const HEADER_END = '<!-- migent-reply:end -->';

function commentSafe(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').replaceAll('--', '- -').trim();
  return flat.length > BLOCKER_TEXT_MAX ? `${flat.slice(0, BLOCKER_TEXT_MAX - 1)}…` : flat;
}

/** The recorded blocker of an execution (`execution.json` outcome), or null. */
export function readBlockerText(sessionDir: string, executionId: string): string | null {
  const record = readExecution(path.join(sessionDir, EXECUTIONS_DIRNAME, executionId));
  const outcome = record?.outcome;
  if (typeof outcome !== 'object' || outcome === null || !('blocker' in outcome)) return null;
  return typeof outcome.blocker === 'string' && outcome.blocker.trim() !== '' ? outcome.blocker : null;
}

export interface ReplyHeaderInput {
  target: BlockedTarget;
  blocker: string | null;
  /** Session-relative path of the previous response, when it exists. */
  responsePath: string | null;
}

/** The blocker context kept at the top of the Reply editor. It is removed before sending. */
export function replyHeader(input: ReplyHeaderInput): string {
  const { target } = input;
  const lines = [
    HEADER_BEGIN,
    `<!-- Blocked stage: ${commentSafe(target.stageId)} (attempt ${target.attempt}) -->`,
    `<!-- Blocker: ${input.blocker === null ? 'unavailable' : commentSafe(input.blocker)} -->`,
    input.responsePath === null ? null : `<!-- Previous response: ${commentSafe(input.responsePath)} -->`,
    '<!-- Write your reply below this block, then use Send Reply. -->',
    HEADER_END,
    '',
    '',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** The reply text: the editor content without its leading context block, trimmed. */
export function replyText(content: string): string {
  const normalized = content.replaceAll('\r\n', '\n');
  if (!normalized.startsWith(HEADER_BEGIN)) return normalized.trim();
  const end = normalized.indexOf(HEADER_END);
  return (end === -1 ? normalized : normalized.slice(end + HEADER_END.length)).trim();
}

const CRLF = '\r\n';
const LF = '\n';

/**
 * The user turns the CLI records for a reply (`buildStageReplyPrompt`), without any appended contract: the
 * `## Human reply` heading of current CLIs, and the `Reply:` label older ones used.
 */
function replyTurns(reply: string): string[] {
  const text = reply.replaceAll(CRLF, LF).trim();
  return [`## Human reply${LF}${LF}${text}`, `Reply:${LF}${text}`];
}

/**
 * How many user turns of an execution's `conversation.json` history are exactly this reply. The CLI pushes the
 * turn as its own history entry, whether the provider keeps a native session or the history is replayed, and
 * appends its contract only to what it sends, so the entry is the complete submitted user turn.
 */
function countReplyTurns(executionDir: string, reply: string): number | null {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(path.join(executionDir, 'conversation.json'), 'utf8'));
  } catch {
    return null;
  }
  const history: unknown = isRecord(record) ? record.history : undefined;
  if (!Array.isArray(history)) return null;
  const wanted = replyTurns(reply);
  return history.filter((item: unknown) => {
    if (!isRecord(item) || item.role !== 'user' || typeof item.content !== 'string') return false;
    return wanted.includes(item.content.replaceAll(CRLF, LF).trim());
  }).length;
}

/**
 * Whether the blocked execution has been resumed: a later execution of the same stage names it in
 * `resumes_execution_id`. It says nothing about the text, so it holds whatever the CLI renders into its prompt.
 * Once it holds, the target is no longer blocked at that execution and a second reply cannot be sent to it.
 */
export function replyResumed(sessionDir: string, blocked: BlockedTarget): boolean {
  const blockedOrder = parseExecutionId(blocked.executionId)?.order ?? 0;
  const executions = path.join(sessionDir, EXECUTIONS_DIRNAME);
  return listExecutions(sessionDir).some(
    (execution) =>
      execution.stage === blocked.stageId &&
      execution.order > blockedOrder &&
      readExecution(path.join(executions, execution.id))?.resumes_execution_id === blocked.executionId,
  );
}

/**
 * Evidence that a reply was consumed: a later execution that resumes the blocked execution
 * (`resumes_execution_id`) and whose recorded conversation holds one more user turn exactly equal to
 * the reply turn (`## Human reply` and the text, or `Reply:` and the text for older CLIs) than the blocked
 * execution's did (an identical earlier reply does not count again). A
 * superseded execution alone, or a prompt that merely contains the same words, is not acknowledgment.
 */
export function replyConsumed(sessionDir: string, blocked: BlockedTarget, reply: string): boolean {
  const blockedOrder = parseExecutionId(blocked.executionId)?.order ?? 0;
  if (reply.trim() === '') return false;
  const executions = path.join(sessionDir, EXECUTIONS_DIRNAME);
  const before = countReplyTurns(path.join(executions, blocked.executionId), reply);
  // Without readable baseline history the comparison is unsupported: an old identical reply could be mistaken for
  // the new one, so nothing is confirmed and the draft is kept.
  if (before === null) return false;
  return listExecutions(sessionDir).some((execution) => {
    if (execution.stage !== blocked.stageId || execution.order <= blockedOrder) return false;
    const dir = path.join(executions, execution.id);
    if (readExecution(dir)?.resumes_execution_id !== blocked.executionId) return false;
    const after = countReplyTurns(dir, reply);
    return after !== null && after > before;
  });
}
