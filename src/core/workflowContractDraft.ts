/**
 * What the workflow editor writes, as drafts of the `@nodeint/migent-contracts` workflow input. Type-only, no `vscode`.
 * The contract is closed, so a draft has no index signature and the editor never invents keys; the CLI is the only
 * validator and a draft is never asserted to be a valid document.
 */
import type { InlineAgent, WorkflowDocumentInput, WorkflowStageInput } from '@nodeint/migent-contracts';

import type { AgentDraft } from './agentForm';
import type { Draft, Expect, Same } from './contractDraft';

/** A stage: a draft of the contract's stage, its inline agent the shared agent draft. */
export type WorkflowStageDraft = Omit<Draft<WorkflowStageInput>, 'agent'> & { agent?: string | AgentDraft };

/** A document: a draft of a `WorkflowDocumentInput` whose stages are stage drafts. */
export type WorkflowDraft = Omit<Draft<WorkflowDocumentInput>, 'stages'> & { stages?: WorkflowStageDraft[] };

// The replaced members stay tied to the contract: a change to their shape fails typecheck.
export type WorkflowReplacedMembersMatchContract = [
  Expect<Same<NonNullable<WorkflowDocumentInput['stages']>[number], WorkflowStageInput>>,
  // The shared agent draft is built from `InlineAgent`; the stage's inline agent must be that same contract shape.
  Expect<Same<Exclude<NonNullable<WorkflowStageInput['agent']>, string>, InlineAgent>>,
];
