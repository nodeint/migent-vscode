import type { AnswerModel } from '../../core/answerModel';
import { buildAnswerModel } from '../../core/answerModel';
import { readRecentEvents } from '../../core/eventTail';
import { listExecutions, parseExecutionId } from '../../core/executions';
import { buildOverviewModel, type OverviewInput } from '../../core/overviewModel';
import { eventsPath, sessionDir } from '../../core/paths';
import { groupPendingQuestions, type QuestionGroup } from '../../core/questions';
import { type ResultsInput, titleCase } from '../../core/resultsModel';
import { OVERVIEW_ACTIVITY_LIMIT } from '../../core/sessionActivity';
import { buildSessionMeta } from '../../core/sessionMeta';
import { buildSessionMetricsModel, type SessionMetricsInput, type SessionMetricsModel } from '../../core/sessionMetricsModel';
import {
  answerHeader,
  metricsHeader,
  overviewHeader,
  type SessionBatchRef,
  type SessionBatchSummary,
  type SessionHeader,
  type SessionPageModel,
} from '../../core/sessionPageModel';
import { sessionTitle } from '../../core/sessionPresentation';
import { readSessionStagePlan } from '../../core/workflowStages';
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
