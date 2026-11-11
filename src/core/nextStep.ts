import { text } from '../text';
import { childrenOf } from './handoff';
import type { SessionSnapshot } from './model';
import { markDeclared, type NextSuggestion, readFrozenDownstream, readNext } from './nextWorkflows';
import { targetState, type TargetWorkflowState } from './resultsModel';
import { sessionTitle } from './sessionPresentation';
import type { WorkflowEntry } from './workflows';

/**
 * The Next step flow's data (plans/03b-downstream-handoff.md §5). The suggestion is presentation only: a launch is
 * re-derived from the frozen declaration, the source state and the current target workflow by `resolveLaunch`
 * immediately before dispatch.
 */

export interface NextStepTarget {
  workflow: string;
  state: TargetWorkflowState;
  /** File name inside `.migent/workflows`; null unless exactly one valid entry matches. */
  file: string | null;
  error: string | null;
}

export interface NextStepInput {
  sourceId: string;
  sessionDirPath: string;
  snapshots: readonly SessionSnapshot[];
  workflows: readonly WorkflowEntry[];
  targetWorkflow: string;
}

/** A suggestion that the frozen declaration confirms, or the reason it cannot be launched. */
export type SuggestionLookup =
  | { kind: 'ok'; suggestion: NextSuggestion }
  | { kind: 'blocked'; reason: string; suggestion: NextSuggestion | null };

/** Published output names of a session; null when the session is not loaded. */
function publishedNames(source: SessionSnapshot | undefined): string[] | null {
  return source?.status?.outputs.map((output) => output.name) ?? null;
}

export function lookupSuggestion(
  sessionDirPath: string,
  targetWorkflow: string,
  published: readonly string[] | null,
): SuggestionLookup {
  const read = readNext(sessionDirPath);
  if (read.kind === 'missing') return { kind: 'blocked', reason: text('states.nextMissing'), suggestion: null };
  if (read.kind !== 'ok') {
    return { kind: 'blocked', reason: text('states.nextUnusable'), suggestion: null };
  }
  const frozen = readFrozenDownstream(sessionDirPath);
  const marked = markDeclared(read.suggestions, frozen, published);
  const suggestion = marked.find((candidate) => candidate.workflow === targetWorkflow) ?? null;
  if (suggestion === null) {
    return { kind: 'blocked', reason: text('states.notSuggested', { workflow: targetWorkflow }), suggestion: null };
  }
  if (suggestion.declared !== true) {
    const reason =
      suggestion.declared === null
        ? text('states.downstreamUnreadable')
        : text('states.notDeclared', { workflow: targetWorkflow });
    return { kind: 'blocked', reason, suggestion };
  }
  return { kind: 'ok', suggestion };
}

export function targetOf(workflows: readonly WorkflowEntry[], workflow: string): NextStepTarget {
  const state = targetState(workflow, workflows);
  const match = workflows.find((entry) => entry.id === workflow);
  const reasons: Record<TargetWorkflowState, string | null> = {
    available: null,
    duplicate: text('states.targetDuplicate'),
    invalid: match?.error ?? text('states.targetInvalid'),
    'not-found': text('states.targetNotFound'),
  };
  return { workflow, state, file: state === 'available' ? (match?.file ?? null) : null, error: reasons[state] };
}

/** The first thing that stops a launch, from fresh data. Null when Run and Prepare may proceed. */
export function launchBlockOf(
  source: SessionSnapshot | undefined,
  lookup: SuggestionLookup,
  target: NextStepTarget,
): string | null {
  if (source === undefined) return text('states.sourceNotLoaded');
  if (source.displayState.state !== 'completed') return text('states.sourceNotCompleted');
  if (lookup.kind === 'blocked') return lookup.reason;
  return target.error;
}

/** A session already created from this source and target that is still Prepared or Running. */
export interface NextStepActiveChild {
  sessionId: string;
  title: string;
  state: string;
}

/** What the flow shows before it asks for a task. */
export interface NextStepPreview {
  /** Prepared or Running children: the flow offers to open one instead of creating another by accident. */
  activeChildren: NextStepActiveChild[];
  sourceTitle: string;
  /** The canonical default task of the suggestion; null when it has none or it is not listed. */
  suggestedTask: string | null;
  target: NextStepTarget;
  /** Why Run and Prepare are not allowed; null when launching is allowed. */
  launchBlock: string | null;
}

export function previewNextStep(input: NextStepInput): NextStepPreview {
  const source = input.snapshots.find((candidate) => candidate.sessionId === input.sourceId);
  const target = targetOf(input.workflows, input.targetWorkflow);
  const lookup = lookupSuggestion(input.sessionDirPath, input.targetWorkflow, publishedNames(source));
  return {
    activeChildren: childrenOf(input.snapshots, input.sourceId)
      .filter(
        (child) =>
          child.manifest?.workflowId === input.targetWorkflow &&
          (child.displayState.state === 'prepared' || child.displayState.state === 'running'),
      )
      .map((child) => ({ sessionId: child.sessionId, title: sessionTitle(child), state: child.displayState.state })),
    sourceTitle: source === undefined ? input.sourceId : sessionTitle(source),
    suggestedTask: lookup.suggestion?.task ?? null,
    target,
    launchBlock: launchBlockOf(source, lookup, target),
  };
}

export interface ResolvedLaunch {
  workflowId: string;
  priorSessionId: string;
  /** Null when the task equals the canonical default, so the CLI supplies it. */
  task: string | null;
  /** The effective one-line task, trimmed. */
  taskText: string;
  /** File name of the target workflow inside `.migent/workflows`. */
  workflowFile: string;
}

/**
 * Re-derive a launch from fresh data immediately before dispatch. Errors are specific and user-facing. A blank task
 * is refused unless `allowEmpty` is set (Prepare, whose `task.md` the user writes afterwards).
 */
export function resolveLaunch(
  input: NextStepInput,
  requestedTask: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): { kind: 'ok'; launch: ResolvedLaunch } | { kind: 'blocked'; reason: string } {
  const source = input.snapshots.find((candidate) => candidate.sessionId === input.sourceId);
  const lookup = lookupSuggestion(input.sessionDirPath, input.targetWorkflow, publishedNames(source));
  const target = targetOf(input.workflows, input.targetWorkflow);
  const block = launchBlockOf(source, lookup, target);
  if (block !== null || lookup.kind !== 'ok' || target.file === null) {
    return { kind: 'blocked', reason: block ?? text('states.suggestionGone') };
  }
  const taskText = requestedTask.trim();
  if (taskText.length === 0 && !allowEmpty) return { kind: 'blocked', reason: text('states.enterTask') };
  return {
    kind: 'ok',
    launch: {
      workflowId: input.targetWorkflow,
      priorSessionId: input.sourceId,
      task: taskText === lookup.suggestion.task ? null : taskText,
      taskText,
      workflowFile: target.file,
    },
  };
}

/**
 * The task stored under a task key. The page this flow replaced stored `{ task, fingerprint }` under the same key,
 * so both shapes are read; anything else, or a blank task, is no remembered task.
 */
export function storedTask(value: unknown): string | undefined {
  const task =
    typeof value === 'object' && value !== null ? (value as { task?: unknown }).task : value;
  return typeof task === 'string' && task.trim().length > 0 ? task : undefined;
}
