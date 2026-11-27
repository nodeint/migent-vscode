/**
 * What the workflow editor writes, as drafts of the core keys of the `@nodeint/migent-contracts` workflow input
 * (see `contractCore.ts`). Type-only, no `vscode`. The contract is closed, so a draft has no index signature and the
 * editor never invents keys; the CLI is the only validator and a draft is never asserted to be a valid document.
 */
import type { AgentDraft } from './agentForm';
import type { CoreStage, CoreWorkflow } from './contractCore';
import type { Draft } from './contractDraft';

/** A stage: a draft of the contract's core stage, its inline agent the shared agent draft. */
export type WorkflowStageDraft = Omit<Draft<CoreStage>, 'agent'> & { agent?: string | AgentDraft };

/** A document: a draft of the core workflow whose stages are stage drafts. */
export type WorkflowDraft = Omit<Draft<CoreWorkflow>, 'stages'> & { stages?: WorkflowStageDraft[] };
