import { parseAnswerMessage } from './answerModel';
import type { AnswerDraft } from './questionAnswers';
import { isRecord } from './record';
import { parseResultsMessage, type ResultsIntent } from './resultsIntent';
import { parseSessionMetricsMessage, type SessionMetricsIntent } from './sessionMetricsIntent';
import { SESSION_TABS, type SessionBatchRef, type SessionTab } from './sessionPageModel';
import { parseWorkflowEditorMessage } from './workflowEditorIntent';

/**
 * What the one Session page may send the host. Tab and batch selection are page-local navigation; every other
 * intent is the one its own page already sent (results, metrics, answers) or a workflow-form message.
 */

export type SessionPageIntent =
  | { intent: 'selectTab'; tab: SessionTab }
  | { intent: 'selectBatch'; batch: SessionBatchRef }
  | ResultsIntent
  | SessionMetricsIntent;

export type SessionPageMessage =
  | { type: 'ready' }
  | { type: 'intent'; value: SessionPageIntent }
  | { type: 'edit'; generation: number; fingerprint: string; questionId: string; draft: AnswerDraft }
  | { type: 'submit'; revision: number; fingerprint: string }
  | { type: 'discard' }
  | { type: 'recheck' }
  | { type: 'openQuestions' }
  | { type: 'later' }
  | { type: 'continue' }
  | { type: 'viewLog' }
  | { type: 'openOverview' }
  | { type: 'openMetrics' }
  | { type: 'saveForm'; form: Record<string, unknown>; baseHash: string }
  | { type: 'reload' }
  | { type: 'openFile' }
  | { type: 'pickModel' };

/** The workflow-form messages the Session page understands; the rest of the editor's set is not exposed. */
const WORKFLOW_MESSAGES = ['saveForm', 'reload', 'openFile', 'pickModel'] as const;

function tabOf(value: unknown): SessionTab | null {
  return SESSION_TABS.find((tab) => tab === value) ?? null;
}

function batchOf(value: unknown): SessionBatchRef | null {
  if (!isRecord(value)) return null;
  const { stageId, executionId } = value;
  if (typeof executionId !== 'string' || executionId === '') return null;
  if (stageId !== null && (typeof stageId !== 'string' || stageId === '')) return null;
  return { stageId, executionId };
}

function intentWith(raw: Record<string, unknown>): SessionPageIntent | null {
  switch (raw.intent) {
    case 'selectTab': {
      const tab = tabOf(raw.tab);
      return tab === null ? null : { intent: 'selectTab', tab };
    }
    case 'selectBatch': {
      const batch = batchOf(raw.batch);
      return batch === null ? null : { intent: 'selectBatch', batch };
    }
    default: {
      const results = parseResultsMessage(raw);
      if (results?.type === 'intent') return results.value;
      const metrics = parseSessionMetricsMessage(raw);
      return metrics?.type === 'intent' ? metrics.value : null;
    }
  }
}

function workflowMessage(raw: Record<string, unknown>): SessionPageMessage | null {
  const { type } = raw;
  if (typeof type !== 'string' || WORKFLOW_MESSAGES.find((known) => known === type) === undefined) return null;
  const parsed = parseWorkflowEditorMessage(raw);
  if (parsed === null) return null;
  switch (parsed.type) {
    case 'saveForm':
      return { type: 'saveForm', form: parsed.form, baseHash: parsed.baseHash };
    case 'reload':
    case 'openFile':
    case 'pickModel':
      return { type: parsed.type };
    default:
      return null;
  }
}

function answerMessage(raw: Record<string, unknown>): SessionPageMessage | null {
  const parsed = parseAnswerMessage(raw);
  if (parsed === null || parsed.type === 'ready' || parsed.type === 'sessionAction') return null;
  switch (parsed.type) {
    case 'edit':
      return parsed;
    case 'submit':
      return parsed;
    case 'reload':
      return { type: 'reload' };
    case 'discard':
    case 'recheck':
    case 'openQuestions':
    case 'later':
    case 'continue':
    case 'viewLog':
    case 'openOverview':
    case 'openMetrics':
      return { type: parsed.type };
    default:
      return null;
  }
}

/** Validate a message from the Session page. Anything outside the contract is dropped (null). */
export function parseSessionPageMessage(raw: unknown): SessionPageMessage | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'ready') return { type: 'ready' };
  if (raw.type === 'intent' || raw.type === 'sessionAction') {
    const message = raw.type === 'sessionAction' ? { type: 'intent', intent: 'sessionAction', action: raw.action } : raw;
    const value = intentWith(message);
    return value === null ? null : { type: 'intent', value };
  }
  return workflowMessage(raw) ?? answerMessage(raw);
}
