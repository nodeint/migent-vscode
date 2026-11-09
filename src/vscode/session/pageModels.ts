import type { AnswerModel } from '../../core/answerModel';
import { buildAnswerModel } from '../../core/answerModel';
import { parseExecutionId } from '../../core/executions';
import { sessionDir } from '../../core/paths';
import { groupPendingQuestions, type QuestionGroup } from '../../core/questions';
import {
  buildResultsModel,
  type ResultsInput,
  type ResultsModel,
  titleCase,
} from '../../core/resultsModel';
import { buildSessionMeta } from '../../core/sessionMeta';
import { buildSessionMetricsModel, type SessionMetricsInput, type SessionMetricsModel } from '../../core/sessionMetricsModel';
import {
  answerHeader,
  metricsHeader,
  resultsHeader,
  type SessionBatchRef,
  type SessionBatchSummary,
  type SessionHeader,
  type SessionPageModel,
} from '../../core/sessionPageModel';
import { sessionTitle } from '../../core/sessionPresentation';
import type { ProjectRegistry } from '../projects';
import type { BatchIdentity } from '../questions/entry';
import type { Entry, Identity } from './entry';

export type AddressableGroup = QuestionGroup & { executionId: string };

export function addressable(groups: readonly QuestionGroup[]): AddressableGroup[] {
  return groups.filter((group): group is AddressableGroup => group.executionId !== null);
}

export function summariesOf(groups: readonly AddressableGroup[]): SessionBatchSummary[] {
  return groups.map((group) => ({
    stageId: group.stageId,
    executionId: group.executionId,
    count: group.questions.length,
  }));
}

/** The most recent pending batch: highest execution order, then latest attempt, else the last one seen. */
export function latestOf(groups: readonly AddressableGroup[]): AddressableGroup | undefined {
  let best: AddressableGroup | undefined;
  for (const group of groups) {
    if (best === undefined) {
      best = group;
      continue;
    }
    const next = parseExecutionId(group.executionId);
    const current = parseExecutionId(best.executionId);
    if (next !== null && current !== null) {
      const isLater = next.order > current.order || (next.order === current.order && next.attempt > current.attempt);
      if (isLater) best = group;
    } else {
      best = group;
    }
  }
  return best;
}

export function batchOf(identity: Identity, ref: SessionBatchRef): BatchIdentity {
  return {
    project: identity.project,
    sessionId: identity.sessionId,
    stageId: ref.stageId,
    executionId: ref.executionId,
  };
}

export function batchGroups(entry: Entry, registry: ProjectRegistry): AddressableGroup[] {
  const snapshot = registry.project(entry.project)?.store.snapshot(entry.sessionId);
  return addressable(groupPendingQuestions(snapshot?.status?.questions ?? []));
}

export function buildResultsPage(entry: Entry, registry: ProjectRegistry): SessionPageModel {
  const context = registry.project(entry.project);
  const input: ResultsInput =
    context === undefined
      ? { sessionId: entry.sessionId, sessionDirPath: '', snapshots: [], eligibleIds: [], workflows: [] }
      : {
          sessionId: entry.sessionId,
          sessionDirPath: sessionDir(context.root, entry.sessionId),
          snapshots: context.store.all(),
          eligibleIds: context.store.scanOutcome.eligible,
          workflows: context.catalog.workflows().entries,
        };
  const model: ResultsModel = buildResultsModel(input);
  return { tab: 'results', header: resultsHeader(model), results: model };
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

/** The Questions tab for the selected batch, or for the session's current pending batches. */
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
      batches: summariesOf(batchGroups(entry, registry)),
    },
  };
}

/** A session with no pending batch still has a header: the same one an unavailable answer page would show. */
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
    message: 'No questions are pending for this session.',
    questions: [],
    draft: {},
    blockReason: null,
    records: null,
    archive: null,
  });
  return answerHeader(model, entry.sessionId);
}
