import type { ClientChoice } from './controlArgs';
import { listExecutions } from './executions';
import type { SessionSnapshot } from './model';
import { sessionDir, workflowDraftPath } from './paths';
import type { ProjectConfig } from './projectConfig';
import { titleCase } from './resultsModel';
import { buildSessionMeta, NO_SESSION_META, type SessionMeta } from './sessionMeta';
import { sessionTitle } from './sessionPresentation';
import { readWorkflowEditor, type WorkflowEditorModel } from './workflowEditor';
import type { WorkflowScan } from './workflows';

/** The editor model of one session's `workflow.yaml`, locked once any stage has run. */
export interface SessionWorkflowModel extends WorkflowEditorModel {
  sessionId: string;
  /** True when a stage has already run; the page then disables every field. */
  isLocked: boolean;
  /** Ids of the stages that have an execution, in run order. */
  ranStages: string[];
  /** Session header data, the same on every session page. */
  title: string;
  sessionState: string;
  workflowId: string | null;
  meta: SessionMeta;
}

export interface SessionWorkflowInput {
  projectRoot: string;
  projectName: string;
  projectKey: string;
  sessionId: string;
  scan: WorkflowScan;
  config: ProjectConfig;
  clients?: ClientChoice[];
  snapshot?: SessionSnapshot;
}

export function readSessionWorkflow(input: SessionWorkflowInput): SessionWorkflowModel {
  const base = readWorkflowEditor({
    projectKey: input.projectKey,
    projectName: input.projectName,
    projectRoot: input.projectRoot,
    file: 'workflow.yaml',
    filePath: workflowDraftPath(input.projectRoot, input.sessionId),
    scan: input.scan,
    config: input.config,
    clients: input.clients,
  });
  const ranStages = [...new Set(listExecutions(sessionDir(input.projectRoot, input.sessionId)).map((e) => e.stage))];
  const { snapshot } = input;
  return {
    ...base,
    canSave: base.canSave && ranStages.length === 0,
    sessionId: input.sessionId,
    isLocked: ranStages.length > 0,
    ranStages,
    title: snapshot === undefined ? input.sessionId : sessionTitle(snapshot),
    sessionState: snapshot === undefined ? 'Unavailable' : titleCase(snapshot.displayState.state),
    workflowId: snapshot?.status?.workflowId ?? snapshot?.manifest?.workflowId ?? null,
    meta: snapshot === undefined ? NO_SESSION_META : buildSessionMeta(snapshot),
  };
}
