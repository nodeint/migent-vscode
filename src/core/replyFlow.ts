import { readFileSync } from 'node:fs';
import path from 'node:path';

import { text } from '../text';
import { listExecutions, parseExecutionId, readExecution } from './executions';
import type { ExecutionSnapshot, ReplyTarget, SessionSnapshot } from './model';
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
export function blockKind(snapshot: ReplyInput): BlockKind | null {
  const { state } = snapshot.displayState;
  if (state === 'question' || (snapshot.status?.questions.length ?? 0) > 0) return 'question';
  if (state === 'blocked') return 'blocker';
  return null;
}

/** The blocked executions of an ordinary blocker, oldest first. Empty for any other session. */
export function blockedTargets(snapshot: ReplyInput): ReplyTarget[] {
  if (blockKind(snapshot) !== 'blocker') return [];
  const targets: ReplyTarget[] = [];
  for (const executionId of snapshot.status?.blockedByExecutionIds ?? []) {
    const parsed = parseExecutionId(executionId);
    if (parsed !== null) targets.push({ executionId, stageId: parsed.stageId, attempt: parsed.attempt, kind: 'blocker' });
  }
  return targets.sort((left, right) => left.executionId.localeCompare(right.executionId));
}

/** What the reply rule reads: a snapshot before the store has attached its reply targets. */
export type ReplyInput = Omit<SessionSnapshot, 'replyTargets'>;

/** States in which a role session accepts a reply (`migent session continue --reply`, CLI 0.5.2). */
const ROLE_REPLY_STATES: ReadonlySet<string> = new Set(['stopped', 'failed', 'blocked', 'cancelled', 'completed']);

/**
 * Whether the rule needs the execution summaries: only a cancelled workflow session does. Blocked workflow targets
 * come from `status.json` and a role session names its latest execution there.
 */
export function replyNeedsExecutions(snapshot: ReplyInput): boolean {
  return (snapshot.manifest?.role ?? null) === null && snapshot.displayState.state === 'cancelled' && blockKind(snapshot) === null;
}

function roleTarget(snapshot: ReplyInput): ReplyTarget[] {
  const executionId = snapshot.status?.latestExecutionId ?? null;
  const parsed = executionId === null ? null : parseExecutionId(executionId);
  if (executionId === null || parsed === null) return [];
  return [{ executionId, stageId: null, attempt: parsed.attempt, kind: 'roleTurn' }];
}

/** The latest non-skipped execution of each stage, as the CLI picks the one an interrupted reply resumes. */
function cancelledTargets(executions: readonly ExecutionSnapshot[]): ReplyTarget[] {
  const latest = new Map<string, ExecutionSnapshot>();
  for (const execution of executions) {
    if (execution.status === 'skipped') continue;
    const current = latest.get(execution.stage);
    if (current === undefined || execution.order > current.order) latest.set(execution.stage, execution);
  }
  return [...latest.values()]
    .filter((execution) => execution.status === 'cancelled' && execution.kind !== 'verify')
    .map((execution) => ({ executionId: execution.id, stageId: execution.stage, attempt: execution.attempt, kind: 'cancelled' as const }))
    .sort((left, right) => left.executionId.localeCompare(right.executionId));
}

/**
 * The executions a reply can answer now: the one eligibility rule the tree, the Overview page and the commands share.
 * A pending question is the Questions page's; a workflow replies to its blocked or interrupted stages, a role session
 * to its latest execution. `executions` is read only when `replyNeedsExecutions` says so.
 */
export function replyTargets(snapshot: ReplyInput, executions: readonly ExecutionSnapshot[] = []): ReplyTarget[] {
  if (blockKind(snapshot) === 'question') return [];
  const { state } = snapshot.displayState;
  if ((snapshot.manifest?.role ?? null) !== null) return ROLE_REPLY_STATES.has(state) ? roleTarget(snapshot) : [];
  if (state === 'blocked') return blockedTargets(snapshot);
  if (state === 'cancelled') return cancelledTargets(executions);
  return [];
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
  if (failure.retryAt === null) return text('states.noResetTime');
  const when = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(failure.retryAt));
  return text('states.resetsAt', { when });
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
  target: ReplyTarget;
  blocker: string | null;
  /** Session-relative path of the previous response, when it exists. */
  responsePath: string | null;
  /** The role name of a role session, for its context line. */
  role?: string | null;
}

function contextLines(input: ReplyHeaderInput): string[] {
  const { target } = input;
  const stage = commentSafe(target.stageId ?? input.role ?? text('states.roleFallback'));
  switch (target.kind) {
    case 'cancelled':
      return [text('states.replyInterrupted', { stage, attempt: target.attempt }), text('states.replyKeepsRunning')];
    case 'roleTurn':
      return [text('states.replyRole', { stage, executionId: commentSafe(target.executionId) })];
    default:
      return [
        text('states.replyBlocked', { stage, attempt: target.attempt }),
        input.blocker === null
          ? text('states.replyBlockerUnavailable')
          : text('states.replyBlocker', { blocker: commentSafe(input.blocker) }),
      ];
  }
}

/** The context kept at the top of the Reply editor. It is removed before sending. */
export function replyHeader(input: ReplyHeaderInput): string {
  const lines = [
    HEADER_BEGIN,
    ...contextLines(input),
    input.responsePath === null ? null : text('states.replyPrevious', { path: commentSafe(input.responsePath) }),
    text('states.replyWrite'),
    HEADER_END,
    '',
    '',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** The one-line context the quick reply box shows, by target kind. */
export function replyPrompt(target: ReplyTarget, role: string | null): string {
  switch (target.kind) {
    case 'cancelled':
      return text('states.replyPromptCancelled', { stage: target.stageId ?? '', attempt: target.attempt });
    case 'roleTurn':
      return role === null
        ? text('states.replyPromptRoleUnnamed', { executionId: target.executionId })
        : text('states.replyPromptRole', { role, executionId: target.executionId });
    default:
      return text('states.replyPromptBlocked', { stage: target.stageId ?? '', attempt: target.attempt });
  }
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

const INTERRUPTED_LEAD = 'Your previous turn was stopped by the human before it finished. Their message:';
const ROLE_PREFIX = `## Role${LF}`;

/**
 * The user turns the CLI records for a reply (`buildStageReplyPrompt`), without any appended contract: the
 * `## Human reply` heading of current CLIs, the same with the interruption sentence of a reply to a stopped turn,
 * and the `Reply:` label older ones used.
 */
function replyTurns(reply: string): string[] {
  const text = reply.replaceAll(CRLF, LF).trim();
  return [
    `## Human reply${LF}${LF}${text}`,
    `## Human reply${LF}${LF}${INTERRUPTED_LEAD}${LF}${LF}${text}`,
    `Reply:${LF}${text}`,
  ];
}

/**
 * Whether a recorded user turn is one of the reply turns. A role session's turn is also preceded by the role's
 * configured responsibilities (`## Role`, a blank line, bullets, a blank line), whose text is not known here, so only
 * the exact tail after a blank line is compared. That keeps the exact-turn rule: text that merely contains the reply
 * does not match.
 */
function isReplyTurn(content: string, wanted: readonly string[], isRole: boolean): boolean {
  const turn = content.replaceAll(CRLF, LF).trim();
  if (wanted.includes(turn)) return true;
  if (!isRole || !turn.startsWith(ROLE_PREFIX)) return false;
  return wanted.some((body) => turn.endsWith(`${LF}${LF}${body}`));
}

/**
 * How many user turns of an execution's `conversation.json` history are exactly this reply. The CLI pushes the
 * turn as its own history entry, whether the provider keeps a native session or the history is replayed, and
 * appends its contract only to what it sends, so the entry is the complete submitted user turn.
 */
function countReplyTurns(executionDir: string, reply: string, isRole: boolean): number | null {
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
    return isReplyTurn(item.content, wanted, isRole);
  }).length;
}

/** The stage whose later execution resumes the target; a role session's target has no stage, its id names the role. */
function targetStage(target: ReplyTarget): string {
  return target.stageId ?? parseExecutionId(target.executionId)?.stageId ?? '';
}

/**
 * Whether the blocked execution has been resumed: a later execution of the same stage names it in
 * `resumes_execution_id`. It says nothing about the text, so it holds whatever the CLI renders into its prompt.
 * Once it holds, the target is no longer blocked at that execution and a second reply cannot be sent to it.
 */
export function replyResumed(sessionDir: string, blocked: ReplyTarget): boolean {
  const blockedOrder = parseExecutionId(blocked.executionId)?.order ?? 0;
  const executions = path.join(sessionDir, EXECUTIONS_DIRNAME);
  const stage = targetStage(blocked);
  return listExecutions(sessionDir).some(
    (execution) =>
      execution.stage === stage &&
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
export function replyConsumed(sessionDir: string, blocked: ReplyTarget, reply: string): boolean {
  const blockedOrder = parseExecutionId(blocked.executionId)?.order ?? 0;
  if (reply.trim() === '') return false;
  const executions = path.join(sessionDir, EXECUTIONS_DIRNAME);
  const stage = targetStage(blocked);
  const before = countReplyTurns(path.join(executions, blocked.executionId), reply, blocked.stageId === null);
  // Without readable baseline history the comparison is unsupported: an old identical reply could be mistaken for
  // the new one, so nothing is confirmed and the draft is kept.
  if (before === null) return false;
  return listExecutions(sessionDir).some((execution) => {
    if (execution.stage !== stage || execution.order <= blockedOrder) return false;
    const dir = path.join(executions, execution.id);
    if (readExecution(dir)?.resumes_execution_id !== blocked.executionId) return false;
    const after = countReplyTurns(dir, reply, blocked.stageId === null);
    return after !== null && after > before;
  });
}
