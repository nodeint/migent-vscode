import { childrenOf } from './handoff';
import type { SessionSnapshot } from './model';
import { markDeclared, type NextSuggestion, readFrozenDownstream, readNext, type SuggestionArtifact } from './nextWorkflows';
import { targetState, type TargetWorkflowState } from './resultsModel';
import { sessionTitle } from './sessionPresentation';
import type { WorkflowEntry } from './workflows';

/**
 * The data a Next step page shows (plans/03b-downstream-handoff.md §5), as inert JSON. The suggestion is
 * presentation only: `launchBlock` is derived from the frozen declaration, the source state and the
 * current target workflow, and a launch is re-derived from fresh data by `resolveLaunch` before dispatch.
 */

export interface NextStepChild {
  sessionId: string;
  title: string;
  state: string;
  /** Prepared or Running: reopen instead of creating another by accident. */
  isActive: boolean;
}

export interface NextStepTarget {
  workflow: string;
  state: TargetWorkflowState;
  /** File name inside `.migent/workflows`; null unless exactly one valid entry matches. */
  file: string | null;
  error: string | null;
}

export interface NextStepModel {
  availability: 'ok' | 'unavailable';
  sourceId: string;
  sourceTitle: string;
  sourceState: string;
  target: NextStepTarget;
  /** The canonical default task of the suggestion; null when it has none or it is not listed. */
  suggestedTask: string | null;
  /** The effective task: the user's override, else the suggestion. */
  task: string;
  isOverridden: boolean;
  /** The suggestion changed since the override was typed. The override is kept. */
  suggestionChanged: boolean;
  artifacts: SuggestionArtifact[];
  /** Why Run and Prepare are disabled; null when launching is allowed. */
  launchBlock: string | null;
  children: NextStepChild[];
}

export interface TaskOverride {
  task: string;
  /** Suggestion fingerprint at the time the override was typed. */
  fingerprint: string;
}

export interface NextStepInput {
  sourceId: string;
  sessionDirPath: string;
  snapshots: readonly SessionSnapshot[];
  workflows: readonly WorkflowEntry[];
  targetWorkflow: string;
  override: TaskOverride | null;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function fingerprintOf(suggestion: NextSuggestion | null): string {
  if (suggestion === null) return '';
  return JSON.stringify([
    suggestion.task,
    suggestion.artifacts.map((artifact) => [artifact.name, artifact.output, artifact.path]),
  ]);
}

/** A suggestion that the frozen declaration confirms, or the reason it cannot be launched. */
export type SuggestionLookup =
  | { kind: 'ok'; suggestion: NextSuggestion }
  | { kind: 'blocked'; reason: string; suggestion: NextSuggestion | null };

export function lookupSuggestion(sessionDirPath: string, targetWorkflow: string): SuggestionLookup {
  const read = readNext(sessionDirPath);
  if (read.kind === 'missing') return { kind: 'blocked', reason: 'next.json was not found.', suggestion: null };
  if (read.kind !== 'ok') {
    return { kind: 'blocked', reason: 'next.json is unreadable, invalid or unsupported.', suggestion: null };
  }
  const frozen = readFrozenDownstream(sessionDirPath);
  const marked = markDeclared(read.suggestions, frozen);
  const suggestion = marked.find((candidate) => candidate.workflow === targetWorkflow) ?? null;
  if (suggestion === null) {
    return { kind: 'blocked', reason: `${targetWorkflow} is not a suggestion of this session.`, suggestion: null };
  }
  if (suggestion.declared !== true) {
    const reason =
      suggestion.declared === null
        ? 'The downstream declaration of this session could not be read.'
        : `${targetWorkflow} is not declared by the session's workflow.`;
    return { kind: 'blocked', reason, suggestion };
  }
  return { kind: 'ok', suggestion };
}

export function targetOf(workflows: readonly WorkflowEntry[], workflow: string): NextStepTarget {
  const state = targetState(workflow, workflows);
  const match = workflows.find((entry) => entry.id === workflow);
  const reasons: Record<TargetWorkflowState, string | null> = {
    available: null,
    duplicate: 'More than one workflow file has this id.',
    invalid: match?.error ?? 'The target workflow file is invalid.',
    'not-found': 'No workflow with this id in the project.',
  };
  return { workflow, state, file: state === 'available' ? (match?.file ?? null) : null, error: reasons[state] };
}

/** The first thing that stops a launch, from fresh data. Null when Run and Prepare may proceed. */
export function launchBlockOf(
  source: SessionSnapshot | undefined,
  lookup: SuggestionLookup,
  target: NextStepTarget,
): string | null {
  if (source === undefined) return 'The source session is not loaded.';
  if (source.displayState.state !== 'completed') return 'The source session is not completed.';
  if (lookup.kind === 'blocked') return lookup.reason;
  return target.error;
}

export function buildNextStepModel(input: NextStepInput): NextStepModel {
  const source = input.snapshots.find((candidate) => candidate.sessionId === input.sourceId);
  const target = targetOf(input.workflows, input.targetWorkflow);
  const lookup = lookupSuggestion(input.sessionDirPath, input.targetWorkflow);
  const suggestion = lookup.suggestion ?? null;
  const suggestedTask = suggestion?.task ?? null;
  const { override } = input;
  const task = override?.task ?? suggestedTask ?? '';
  return {
    availability: source === undefined ? 'unavailable' : 'ok',
    sourceId: input.sourceId,
    sourceTitle: source === undefined ? input.sourceId : sessionTitle(source),
    sourceState: source === undefined ? 'Unavailable' : titleCase(source.displayState.state),
    target,
    suggestedTask,
    task,
    isOverridden: override !== null && override.task !== (suggestedTask ?? ''),
    suggestionChanged: override !== null && override.fingerprint !== fingerprintOf(suggestion),
    artifacts: suggestion?.artifacts ?? [],
    launchBlock: launchBlockOf(source, lookup, target),
    children: childrenOf(input.snapshots, input.sourceId)
      .filter((child) => child.manifest?.workflowId === input.targetWorkflow)
      .map((child) => ({
        sessionId: child.sessionId,
        title: sessionTitle(child),
        state: titleCase(child.displayState.state),
        isActive: child.displayState.state === 'prepared' || child.displayState.state === 'running',
      })),
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

/** Re-derive a launch from fresh data immediately before dispatch. Errors are specific and user-facing. */
export function resolveLaunch(
  input: Omit<NextStepInput, 'override'>,
  requestedTask: string,
): { kind: 'ok'; launch: ResolvedLaunch } | { kind: 'blocked'; reason: string } {
  const source = input.snapshots.find((candidate) => candidate.sessionId === input.sourceId);
  const lookup = lookupSuggestion(input.sessionDirPath, input.targetWorkflow);
  const target = targetOf(input.workflows, input.targetWorkflow);
  const block = launchBlockOf(source, lookup, target);
  if (block !== null || lookup.kind !== 'ok' || target.file === null) {
    return { kind: 'blocked', reason: block ?? 'The suggestion is no longer available.' };
  }
  const taskText = requestedTask.trim();
  if (taskText.length === 0) return { kind: 'blocked', reason: 'Enter a task.' };
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
