/** The workflow editor's form shapes: inert data the page edits and the host serializes. No `vscode`. */
import type { WORKFLOW_SCHEMA_VERSION } from '@nodeint/migent-contracts';

/** A complete agent written inline on a stage. Empty fields are omitted when saved. */
export interface WorkflowAgentForm {
  model: string;
  effort: string;
  clientType: string;
  clientOptions: { key: string; value: string }[];
}

/** How a stage selects its agent: the role's own, a named agent, or a complete inline agent. */
export type WorkflowAgentMode = 'role' | 'named' | 'inline';

/** Schema version the editor reads and writes. Older files are shown read-only; `migent migrate` upgrades them. */
export const EDITABLE_SCHEMA_VERSION: typeof WORKFLOW_SCHEMA_VERSION = 7;

/** Who a stage asks: nobody (`''`) or the human, the only value the contract accepts. */
export type WorkflowAsk = '' | 'human';

/** One entry of the top-level artifact registry. `required` is tri-state: null leaves the key out on save. */
export interface WorkflowArtifactForm {
  id: string;
  file: string;
  description: string;
  required: boolean | null;
}

/** A decision-local artifact (no `required`; the CLI treats it as optional). */
export interface WorkflowLocalArtifactForm {
  id: string;
  file: string;
  description: string;
}

/**
 * A decision route's artifacts, in the shape the file used: registry ids, or decision-local definitions.
 * Absent routes carry `null`.
 */
export type WorkflowRouteArtifacts =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'local'; items: WorkflowLocalArtifactForm[] }
  | null;

export interface WorkflowRouteForm {
  value: string;
  when: string;
  navigate: string;
  artifacts: WorkflowRouteArtifacts;
}

/** One stage as the editor form shows it. Every field is inert data, never a command. */
export interface WorkflowStageForm {
  id: string;
  description: string;
  role: string;
  ask: WorkflowAsk;
  agentMode: WorkflowAgentMode;
  agentName: string;
  agent: WorkflowAgentForm;
  depends_on: string[];
  max_revisions: number | null;
  instructions: string[];
  artifacts: string[];
  sessionResumeFrom: string;
  verify: string[];
  verify_timeout: number | null;
  max_verify: number | null;
  runWhenPaths: string[];
  decision: WorkflowRouteForm[];
}

export interface WorkflowForm {
  id: string;
  concurrency: number | null;
  constraints: string[];
  stages: WorkflowStageForm[];
  artifacts: WorkflowArtifactForm[];
  /** `artifacts: null` means the key is absent: every published artifact is passed under its own id. */
  downstream: { workflow: string; task: string; artifacts: { key: string; value: string }[] | null }[];
}

export function emptyAgentForm(): WorkflowAgentForm {
  return { model: '', effort: '', clientType: '', clientOptions: [] };
}

export function emptyStageForm(): WorkflowStageForm {
  return {
    id: '',
    description: '',
    role: '',
    ask: '',
    agentMode: 'role',
    agentName: '',
    agent: emptyAgentForm(),
    depends_on: [],
    max_revisions: null,
    instructions: [],
    artifacts: [],
    sessionResumeFrom: '',
    verify: [],
    verify_timeout: null,
    max_verify: null,
    runWhenPaths: [],
    decision: [],
  };
}

export function emptyWorkflowForm(): WorkflowForm {
  return { id: '', concurrency: null, constraints: [], stages: [], artifacts: [], downstream: [] };
}

/** The starting form of a new workflow: its id and one stage. The CLI judges the rest when the user saves. */
export function newWorkflowForm(id: string, roles: readonly string[]): WorkflowForm {
  return { ...emptyWorkflowForm(), id, stages: [{ ...emptyStageForm(), id: 'implement', role: roles[0] ?? '' }] };
}
