import type { WorkflowEntry } from './workflows';

/**
 * The one launch-eligibility policy of a Next step suggestion, shared by the Next step flow (`launchBlockOf`) and
 * the Overview. Pure: it reads no disk and imports neither `nextStep.ts` nor `resultsModel.ts`.
 */

export type TargetWorkflowState = 'available' | 'duplicate' | 'invalid' | 'not-found';

export type LaunchBlockReason =
  | 'sourceNotCompleted'
  | 'notDeclared'
  | 'declarationUnreadable'
  | 'targetNotFound'
  | 'targetInvalid'
  | 'targetDuplicate';

export type LaunchEligibility = { state: 'ready' } | { state: 'blocked'; reason: LaunchBlockReason };

export function targetState(workflow: string, workflows: readonly WorkflowEntry[]): TargetWorkflowState {
  const matches = workflows.filter((entry) => entry.id === workflow);
  if (matches.length === 0) return 'not-found';
  if (matches.length > 1) return 'duplicate';
  return matches[0]?.state === 'ok' ? 'available' : 'invalid';
}

const TARGET_REASONS: Record<Exclude<TargetWorkflowState, 'available'>, LaunchBlockReason> = {
  'not-found': 'targetNotFound',
  invalid: 'targetInvalid',
  duplicate: 'targetDuplicate',
};

export interface LaunchFacts {
  /** The source session's display state name. */
  sourceState: string;
  /** True when the frozen workflow declares the suggestion; null when the declaration could not be read. */
  declared: boolean | null;
  target: TargetWorkflowState;
}

/** The first thing that stops a launch, from the facts of one suggestion. */
export function classifyLaunch(facts: LaunchFacts): LaunchEligibility {
  if (facts.sourceState !== 'completed') return { state: 'blocked', reason: 'sourceNotCompleted' };
  if (facts.declared === null) return { state: 'blocked', reason: 'declarationUnreadable' };
  if (!facts.declared) return { state: 'blocked', reason: 'notDeclared' };
  if (facts.target !== 'available') return { state: 'blocked', reason: TARGET_REASONS[facts.target] };
  return { state: 'ready' };
}
