import type { AnswerModel } from '../../core/answerModel';
import { buildAnswerModel } from '../../core/answerModel';
import { readRecentEvents } from '../../core/eventTail';
import { listExecutions } from '../../core/executions';
import { readMetrics } from '../../core/metrics';
import { buildOverviewModel, type OverviewInput } from '../../core/overviewModel';
import { eventsPath, sessionDir } from '../../core/paths';
import { attemptRecords, type QuestionAttempt, questionAttempts } from '../../core/questionHistory';
import { type QuestionRecord, readQuestions } from '../../core/questions';
import { type ResultsInput, titleCase } from '../../core/resultsModel';
import { OVERVIEW_ACTIVITY_LIMIT } from '../../core/sessionActivity';
import { buildSessionMeta } from '../../core/sessionMeta';
import { buildSessionMetricsModel, type SessionMetricsInput, type SessionMetricsModel } from '../../core/sessionMetricsModel';
import {
  answerHeader,
  metricsHeader,
  overviewHeader,
  type SessionBatchRef,
  type SessionHeader,
  type SessionPageModel,
} from '../../core/sessionPageModel';
import { sessionTitle } from '../../core/sessionPresentation';
import { readSessionStagePlan } from '../../core/workflowStages';
import { text } from '../../text';
import type { ProjectRegistry } from '../projects';
import type { BatchIdentity } from '../questions/entry';
import type { Entry, Identity } from './entry';

export function batchOf(identity: Identity, ref: SessionBatchRef): BatchIdentity {
  return {
    project: identity.project,
    sessionId: identity.sessionId,
    stageId: ref.stageId,
    executionId: ref.executionId,
  };
}

/** The session's question history (`questions.json`); empty when the file is missing or cannot be read. */
export function questionRecords(entry: PageEntry, registry: ProjectRegistry): QuestionRecord[] {
  const context = registry.project(entry.project);
  if (context === undefined) return [];
  const read = readQuestions(sessionDir(context.root, entry.sessionId));
  return read.kind === 'ok' ? read.questions : [];
}

/** Every attempt of the session that asked questions, from the history and the pending questions. */
export function attemptsOf(
  entry: PageEntry,
  registry: ProjectRegistry,
  records: readonly QuestionRecord[],
): QuestionAttempt[] {
  const snapshot = registry.project(entry.project)?.store.snapshot(entry.sessionId);
  return questionAttempts(records, snapshot?.status?.questions ?? []);
}

/** The fields a page builder needs from an entry; tests can pass a plain object. */
type PageEntry = Pick<Entry, 'project' | 'sessionId'>;

function resultsInputOf(entry: PageEntry, registry: ProjectRegistry): ResultsInput {
  const context = registry.project(entry.project);
  if (context === undefined) {
    return { sessionId: entry.sessionId, sessionDirPath: '', snapshots: [], eligibleIds: [], workflows: [] };
  }
  return {
    sessionId: entry.sessionId,
    sessionDirPath: sessionDir(context.root, entry.sessionId),
    snapshots: context.store.all(),
    eligibleIds: context.store.scanOutcome.eligible,
    workflows: context.catalog.workflows().entries,
  };
}

/**
 * The Overview data: the results input plus the executions, stage plan and recent
 * events. Events are read only while the session is Running; the tab still posts
 * the `results` model until P5 renames it.
 */
export function buildOverviewPage(entry: PageEntry, registry: ProjectRegistry): SessionPageModel {
  const context = registry.project(entry.project);
  const snapshot = context?.store.snapshot(entry.sessionId);
  const input: OverviewInput = {
    ...resultsInputOf(entry, registry),
    executions: [],
    plan: { kind: 'missing' },
    events: [],
  };
  if (context !== undefined && snapshot !== undefined) {
    input.executions = listExecutions(input.sessionDirPath);
    input.plan = readSessionStagePlan(context.root, entry.sessionId);
    const metrics = readMetrics(input.sessionDirPath);
    if (metrics.kind === 'ok') input.metrics = metrics.metrics.executions;
    if (snapshot.displayState.state === 'running') {
      input.events = readRecentEvents(eventsPath(context.root, entry.sessionId), OVERVIEW_ACTIVITY_LIMIT);
    }
  }
  const model = buildOverviewModel(input);
  return { tab: 'overview', header: overviewHeader(model), overview: model };
}

export function buildMetricsPage(entry: Entry, registry: ProjectRegistry): SessionPageModel {
  const context = registry.project(entry.project);
  const input: SessionMetricsInput =
    context === undefined
      ? { sessionId: entry.sessionId, sessionDirPath: '', snapshots: [] }
      : {
          sessionId: entry.sessionId,
          sessionDirPath: sessionDir(context.root, entry.sessionId),
          snapshots: context.store.all(),
        };
  const model: SessionMetricsModel = buildSessionMetricsModel(input);
  return { tab: 'metrics', header: metricsHeader(model), metrics: model };
}

/** The Questions tab for the selected attempt, with the session's attempts for the selector. */
export function buildQuestionsPage(
  entry: Entry,
  registry: ProjectRegistry,
  model: AnswerModel,
): SessionPageModel | null {
  const batch = entry.questionBatch;
  if (batch === null) return null;
  return {
    tab: 'questions',
    header: answerHeader(model, entry.sessionId),
    questions: {
      model,
      selected: { stageId: batch.stageId, executionId: batch.executionId },
      attempts: attemptsOf(entry, registry, questionRecords(entry, registry)),
    },
  };
}

/**
 * A read-only record of an attempt that no longer waits for answers: its questions and what was answered, or a
 * note that the session moved on without an answer.
 */
export function buildAttemptRecord(
  entry: PageEntry,
  registry: ProjectRegistry,
  shown: { attempt: QuestionAttempt; records: readonly QuestionRecord[] },
): AnswerModel {
  const { attempt, records } = shown;
  const snapshot = registry.project(entry.project)?.store.snapshot(entry.sessionId);
  const own = attemptRecords(records, attempt);
  const isAnswered = attempt.status === 'answered';
  return buildAnswerModel({
    revision: 1,
    generation: 0,
    fingerprint: `record:${attempt.executionId}`,
    title: snapshot === undefined ? entry.sessionId : sessionTitle(snapshot),
    workflowId: snapshot?.status?.workflowId ?? snapshot?.manifest?.workflowId ?? null,
    sessionState: snapshot === undefined ? 'Unavailable' : titleCase(snapshot.displayState.state),
    meta: buildSessionMeta(snapshot),
    state: isAnswered ? 'recorded' : 'answered-elsewhere',
    message: isAnswered ? null : text('prompts.questionsSuperseded'),
    questions: own.map((record) => ({ ...record, file: null })),
    draft: {},
    blockReason: null,
    records: own,
    archive: null,
  });
}

/** A session that never asked a question still has a header: the same one an unavailable answer page would show. */
export function buildEmptyAnswerHeader(entry: Entry, registry: ProjectRegistry): SessionHeader {
  const snapshot = registry.project(entry.project)?.store.snapshot(entry.sessionId);
  const title = snapshot === undefined ? entry.sessionId : sessionTitle(snapshot);
  const sessionState = snapshot === undefined ? 'Unavailable' : titleCase(snapshot.displayState.state);
  const model = buildAnswerModel({
    revision: 1,
    generation: 0,
    fingerprint: '',
    title,
    workflowId: snapshot?.status?.workflowId ?? snapshot?.manifest?.workflowId ?? null,
    sessionState,
    meta: buildSessionMeta(snapshot),
    state: 'unavailable',
    message: text('prompts.noPendingQuestions'),
    questions: [],
    draft: {},
    blockReason: null,
    records: null,
    archive: null,
  });
  return answerHeader(model, entry.sessionId);
}
