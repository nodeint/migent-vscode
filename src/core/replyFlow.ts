import { readFileSync } from 'node:fs';
import path from 'node:path';

import { formatDuration } from './duration';
import { listExecutions, parseExecutionId, readExecution } from './executions';
import type { SessionSnapshot } from './model';
import { EXECUTIONS_DIRNAME } from './paths';
import { isRecord } from './record';

/** Rules for Reply, Continue without reply and quota waits (plans/03c-reply-notifications.md). No `vscode`. */

export type BlockKind = 'blocker' | 'quota' | 'question';

const QUOTA_EVENT = 'provider.quota';
const BLOCKER_TEXT_MAX = 400;

/** Whether the latest provider event is a quota wait. Quota is a reason, never a persisted status. */
function hasQuotaEvent(snapshot: SessionSnapshot): boolean {
  return snapshot.status?.latestProviderEvent?.event === QUOTA_EVENT;
}

/**
 * A quota wait persists as a stopped session, or as a failed one: the CLI marks the exhausted execution failed
 * (`failure_reason: quota`). A failed session counts only when the quota event belongs to its latest execution,
 * so an unrelated later failure is never read as a quota wait.
 */
function isQuotaWait(snapshot: SessionSnapshot): boolean {
  const { state } = snapshot.displayState;
  if (!hasQuotaEvent(snapshot)) return false;
  if (state === 'stopped') return true;
  if (state !== 'failed') return false;
  const eventExecution = snapshot.status?.latestProviderEvent?.executionId ?? null;
  return eventExecution === null || eventExecution === (snapshot.status?.latestExecutionId ?? null);
}

/**
 * Which kind of obstacle a session shows. A pending human question is never an ordinary blocker, and a
 * quota wait (a stopped session whose latest event is a quota event) has no Reply.
 */
export function blockKind(snapshot: SessionSnapshot): BlockKind | null {
  const { state } = snapshot.displayState;
  if (state === 'question' || (snapshot.status?.questions.length ?? 0) > 0) return 'question';
  if (state === 'blocked') return 'blocker';
  if (isQuotaWait(snapshot)) return 'quota';
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

export interface QuotaWait {
  /** Epoch ms of `retry_at`, or null when the CLI recorded none (or an unparsable value). */
  retryAt: number | null;
  /** True when Retry is enabled without an explicit override: `retry_at` is known and not in the future. */
  isReady: boolean;
}

/** The quota wait of a session, or null when it is not in one. */
export function quotaWait(snapshot: SessionSnapshot, now: number): QuotaWait | null {
  if (blockKind(snapshot) !== 'quota') return null;
  const raw = snapshot.status?.latestProviderEvent?.retryAt ?? null;
  const parsed = raw === null ? Number.NaN : Date.parse(raw);
  const retryAt = Number.isNaN(parsed) ? null : parsed;
  return { retryAt, isReady: retryAt !== null && retryAt <= now };
}

/** `Nov 3, 2026, 2:05 PM GMT+7 · in 12m 3s`; says so instead of inventing a time when none is known. */
export function describeQuotaWait(wait: QuotaWait, now: number, locale?: string): string {
  if (wait.retryAt === null) return 'No retry time was recorded.';
  const absolute = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(wait.retryAt));
  return wait.isReady ? `${absolute} · retry available` : `${absolute} · in ${formatDuration(wait.retryAt - now)}`;
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

/** The user turn the CLI records for a reply (`buildStageReplyPrompt`), without any appended contract. */
function replyTurn(reply: string): string {
  return `Reply:${LF}${reply.replaceAll(CRLF, LF).trim()}`;
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
  const wanted = replyTurn(reply);
  return history.filter((item: unknown) => {
    if (!isRecord(item) || item.role !== 'user' || typeof item.content !== 'string') return false;
    return item.content.replaceAll(CRLF, LF).trim() === wanted;
  }).length;
}

/**
 * Evidence that a reply was consumed: a later execution that resumes the blocked execution
 * (`resumes_execution_id`) and whose recorded conversation holds one more user turn exactly equal to
 * `Reply:` + the text than the blocked execution's did (an identical earlier reply does not count again). A
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
