import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import type { ClientChoice } from './controlArgs';
import { MIGENT_DIR, WORKFLOWS_DIRNAME } from './paths';
import type { ProjectConfig } from './projectConfig';
import { projectRelative } from './projectPresentation';
import { isRecord } from './record';
import type { WorkflowScan } from './workflows';

/** A complete agent written inline on a stage. Empty fields are omitted when saved. */
export interface WorkflowAgentForm {
  model: string;
  effort: string;
  clientType: string;
  clientOptions: { key: string; value: string }[];
}

/** How a stage selects its agent: the role's own, a named agent, or a complete inline agent. */
export type WorkflowAgentMode = 'role' | 'named' | 'inline';

/** One stage as the editor form shows it. Every field is inert data, never a command. */
export interface WorkflowStageForm {
  id: string;
  description: string;
  role: string;
  ask: string;
  agentMode: WorkflowAgentMode;
  agentName: string;
  agent: WorkflowAgentForm;
  dependsOn: string[];
  maxRevisions: number | null;
  instructions: string[];
  producesArtifact: string;
  sessionResumeFrom: string;
  verify: string[];
  verifyTimeout: number | null;
  maxVerify: number | null;
  runWhenPaths: string[];
  decision: { value: string; when: string; navigate: string }[];
}

export interface WorkflowForm {
  id: string;
  concurrency: number | null;
  constraints: string[];
  stages: WorkflowStageForm[];
  outputs: { name: string; fromStage: string; artifact: string }[];
  downstream: { workflow: string; task: string; artifacts: { key: string; value: string }[] }[];
}

export type WorkflowEditorState = 'ok' | 'invalid' | 'unreadable' | 'unsupported';

/** One diagnostic from `migent workflow validate|save --json`, with its path as the page knows it. */
export interface WorkflowDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
}

/** The parts of one authoring envelope the editor uses. */
export interface WorkflowAuthoringResult {
  valid: boolean;
  diagnostics: WorkflowDiagnostic[];
  file: string | null;
  hash: string | null;
  written: boolean;
  currentHash: string | null;
}

/** One other workflow file a downstream suggestion can name. */
export interface WorkflowEditorWorkflow {
  id: string;
  file: string;
}

export interface WorkflowEditorModel {
  mode: 'edit';
  project: string;
  file: string;
  path: string;
  id: string;
  schemaVersion: number | null;
  state: WorkflowEditorState;
  isSupported: boolean;
  readError: string | null;
  form: WorkflowForm;
  yaml: string;
  roles: string[];
  agents: string[];
  workflows: WorkflowEditorWorkflow[];
  /** Available clients with their models and native option keys; empty when the CLI cannot list them. */
  clients: ClientChoice[];
  duplicateOf: string[];
  validation: { errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] };
  savedHash: string;
  canSave: boolean;
}

export interface WorkflowEditorInput {
  projectKey: string;
  projectName: string;
  projectRoot: string;
  file: string;
  scan: WorkflowScan;
  config: ProjectConfig;
  /** `get clients`, `get models` and `get options` rows; omitted when the caller has no client data yet. */
  clients?: ClientChoice[];
  /** A workflow file outside `.migent/workflows` (a session's `workflow.yaml`); `file` stays its display name. */
  filePath?: string;
}

function emptyAgentForm(): WorkflowAgentForm {
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
    dependsOn: [],
    maxRevisions: null,
    instructions: [],
    producesArtifact: '',
    sessionResumeFrom: '',
    verify: [],
    verifyTimeout: null,
    maxVerify: null,
    runWhenPaths: [],
    decision: [],
  };
}

export function emptyWorkflowForm(): WorkflowForm {
  return { id: '', concurrency: null, constraints: [], stages: [], outputs: [], downstream: [] };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pairs(value: unknown): { key: string; value: string }[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, item]) => ({ key, value: typeof item === 'string' ? item : String(item) }));
}

/** A decision has one destination; an imported list of stage ids is joined and kept as it was. */
function navigationText(value: unknown): string {
  if (typeof value === 'string') return value;
  return strings(value).join(', ');
}

function decisions(value: unknown): WorkflowStageForm['decision'] {
  if (!Array.isArray(value)) return [];
  const routes: WorkflowStageForm['decision'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    for (const [name, route] of Object.entries(entry)) {
      const body = isRecord(route) ? route : {};
      routes.push({ value: name, when: stringValue(body.when), navigate: navigationText(body.navigate) });
    }
  }
  return routes;
}

function inlineAgent(value: unknown): WorkflowAgentForm {
  const body = isRecord(value) ? value : {};
  const client = isRecord(body.client) ? body.client : {};
  return {
    model: stringValue(body.model),
    effort: stringValue(body.effort),
    clientType: stringValue(client.type),
    clientOptions: pairs(client.options),
  };
}

function agentFields(value: unknown): Pick<WorkflowStageForm, 'agentMode' | 'agentName' | 'agent'> {
  if (typeof value === 'string') return { agentMode: 'named', agentName: value, agent: emptyAgentForm() };
  if (isRecord(value)) return { agentMode: 'inline', agentName: '', agent: inlineAgent(value) };
  return { agentMode: 'role', agentName: '', agent: emptyAgentForm() };
}

function stageForm(value: unknown): WorkflowStageForm {
  const body = isRecord(value) ? value : {};
  const produces = isRecord(body.produces) ? body.produces : {};
  const session = isRecord(body.session) ? body.session : {};
  const runWhen = isRecord(body.run_when) ? body.run_when : {};
  return {
    id: stringValue(body.id),
    description: stringValue(body.description),
    role: stringValue(body.role),
    ask: stringValue(body.ask),
    ...agentFields(body.agent),
    dependsOn: strings(body.depends_on),
    maxRevisions: numberValue(body.max_revisions),
    instructions: strings(body.instructions),
    producesArtifact: stringValue(produces.artifact),
    sessionResumeFrom: stringValue(session.resume_from),
    verify: strings(body.verify),
    verifyTimeout: numberValue(body.verify_timeout),
    maxVerify: numberValue(body.max_verify),
    runWhenPaths: strings(runWhen.changed_paths),
    decision: decisions(body.decision),
  };
}

function formFromBody(body: Record<string, unknown>, fallbackId: string): WorkflowForm {
  const outputs = Array.isArray(body.outputs) ? body.outputs : [];
  const downstream = Array.isArray(body.downstream) ? body.downstream : [];
  return {
    id: stringValue(body.id) || fallbackId,
    concurrency: numberValue(body.concurrency),
    constraints: strings(body.constraints),
    stages: (Array.isArray(body.stages) ? body.stages : []).map(stageForm),
    outputs: outputs.map((value) => {
      const output = isRecord(value) ? value : {};
      return {
        name: stringValue(output.name),
        fromStage: stringValue(output.from_stage),
        artifact: stringValue(output.artifact),
      };
    }),
    downstream: downstream.map((value) => {
      const target = isRecord(value) ? value : {};
      return {
        workflow: stringValue(target.workflow),
        task: stringValue(target.task),
        artifacts: pairs(target.artifacts),
      };
    }),
  };
}

function fallbackId(file: string): string {
  return path.basename(file, path.extname(file));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** SHA-256 of the raw bytes, the base hash `workflow save` compares. */
function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function workflowFilePath(projectRoot: string, file: string): string {
  return path.join(projectRoot, MIGENT_DIR, WORKFLOWS_DIRNAME, file);
}

/** Read one workflow file for the editor. A vanished file is reported, never created. */
export function readWorkflowEditor(input: WorkflowEditorInput): WorkflowEditorModel {
  const filePath = input.filePath ?? workflowFilePath(input.projectRoot, input.file);
  const relative = projectRelative(input.projectRoot, filePath);
  const base = {
    mode: 'edit' as const,
    project: input.projectName,
    file: input.file,
    path: relative,
    roles: input.config.roles,
    agents: input.config.agents,
    workflows: input.scan.entries
      .filter((entry) => entry.state === 'ok' && (input.filePath !== undefined || entry.file !== input.file))
      .map((entry) => ({ id: entry.id, file: entry.file })),
    clients: input.clients ?? [],
    duplicateOf: input.filePath === undefined ? duplicatesOf(input.scan, input.file) : [],
    validation: { errors: [], warnings: [] },
    canSave: false,
  };
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      ...base,
      id: fallbackId(input.file),
      schemaVersion: null,
      state: 'unreadable',
      isSupported: false,
      readError: errorText(error),
      form: emptyWorkflowForm(),
      yaml: '',
      savedHash: hash(''),
    };
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return {
      ...base,
      id: fallbackId(input.file),
      schemaVersion: null,
      state: 'invalid',
      isSupported: false,
      readError: errorText(error),
      form: emptyWorkflowForm(),
      yaml: text,
      savedHash: hash(text),
    };
  }
  const body = isRecord(parsed) ? parsed : {};
  const form = formFromBody(body, fallbackId(input.file));
  const schemaVersion = numberValue(body.schema_version);
  return {
    ...base,
    id: form.id,
    schemaVersion,
    state: 'ok',
    isSupported: true,
    readError: null,
    form,
    yaml: text,
    savedHash: hash(text),
  };
}

function duplicatesOf(scan: WorkflowScan, file: string): string[] {
  const entry = scan.entries.find((candidate) => candidate.file === file);
  if (entry?.state !== 'ok') return [];
  return scan.entries
    .filter((candidate) => candidate.state === 'ok' && candidate.id === entry.id && candidate.file !== file)
    .map((candidate) => candidate.file);
}

// ---------- the page's draft, treated as inert data ----------

function pairList(value: unknown): { key: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({ key: stringValue(item.key), value: stringValue(item.value) }));
}

function agentMode(value: unknown): WorkflowAgentMode {
  return value === 'named' || value === 'inline' ? value : 'role';
}

function clientStage(value: unknown): WorkflowStageForm {
  const body = isRecord(value) ? value : {};
  const agent = isRecord(body.agent) ? body.agent : {};
  return {
    ...emptyStageForm(),
    id: stringValue(body.id),
    description: stringValue(body.description),
    role: stringValue(body.role),
    ask: stringValue(body.ask),
    agentMode: agentMode(body.agentMode),
    agentName: stringValue(body.agentName),
    agent: {
      model: stringValue(agent.model),
      effort: stringValue(agent.effort),
      clientType: stringValue(agent.clientType),
      clientOptions: pairList(agent.clientOptions),
    },
    dependsOn: strings(body.dependsOn),
    maxRevisions: numberValue(body.maxRevisions),
    instructions: strings(body.instructions),
    producesArtifact: stringValue(body.producesArtifact),
    sessionResumeFrom: stringValue(body.sessionResumeFrom),
    verify: strings(body.verify),
    verifyTimeout: numberValue(body.verifyTimeout),
    maxVerify: numberValue(body.maxVerify),
    runWhenPaths: strings(body.runWhenPaths),
    decision: (Array.isArray(body.decision) ? body.decision : []).filter(isRecord).map((route) => ({
      value: stringValue(route.value),
      when: stringValue(route.when),
      navigate: stringValue(route.navigate),
    })),
  };
}

/** Normalize an untrusted page draft into the form shape. Unknown fields are dropped, never executed. */
export function workflowFormFromClient(raw: unknown): WorkflowForm {
  const body = isRecord(raw) ? raw : {};
  return {
    id: stringValue(body.id),
    concurrency: numberValue(body.concurrency),
    constraints: strings(body.constraints),
    stages: (Array.isArray(body.stages) ? body.stages : []).map(clientStage),
    outputs: (Array.isArray(body.outputs) ? body.outputs : []).filter(isRecord).map((output) => ({
      name: stringValue(output.name),
      fromStage: stringValue(output.fromStage),
      artifact: stringValue(output.artifact),
    })),
    downstream: (Array.isArray(body.downstream) ? body.downstream : []).filter(isRecord).map((target) => ({
      workflow: stringValue(target.workflow),
      task: stringValue(target.task),
      artifacts: pairList(target.artifacts),
    })),
  };
}

// ---------- the canonical schema 5 draft the CLI saves ----------

function pairsToRecord(values: { key: string; value: string }[]): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const pair of values) {
    if (pair.key === '') continue;
    record[pair.key] = pair.value;
  }
  return Object.keys(record).length === 0 ? undefined : record;
}

function agentBody(stage: WorkflowStageForm): unknown {
  if (stage.agentMode === 'named') {
    const name = stage.agentName.trim();
    return name === '' ? undefined : name;
  }
  if (stage.agentMode !== 'inline') return undefined;
  const agent: Record<string, unknown> = {};
  if (stage.agent.model !== '') agent.model = stage.agent.model;
  if (stage.agent.effort !== '') agent.effort = stage.agent.effort;
  const client: Record<string, unknown> = {};
  if (stage.agent.clientType !== '') client.type = stage.agent.clientType;
  const options = pairsToRecord(stage.agent.clientOptions);
  if (options !== undefined) client.options = options;
  if (Object.keys(client).length > 0) agent.client = client;
  return agent;
}

/** One destination stays a string; an imported list keeps its list shape until it is edited. */
function navigateValue(text: string): string | string[] | undefined {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

function decisionBody(routes: WorkflowStageForm['decision']): Record<string, unknown>[] {
  return routes.map((route) => {
    const body: Record<string, unknown> = {};
    if (route.when !== '') body.when = route.when;
    const navigate = navigateValue(route.navigate);
    if (navigate !== undefined) body.navigate = navigate;
    return { [route.value]: body };
  });
}

function stageBody(stage: WorkflowStageForm): Record<string, unknown> {
  const body: Record<string, unknown> = { id: stage.id };
  if (stage.description !== '') body.description = stage.description;
  if (stage.role !== '') body.role = stage.role;
  const agent = agentBody(stage);
  if (agent !== undefined) body.agent = agent;
  if (stage.ask !== '') body.ask = stage.ask;
  if (stage.dependsOn.length > 0) body.depends_on = stage.dependsOn;
  if (stage.maxRevisions !== null) body.max_revisions = stage.maxRevisions;
  if (stage.instructions.length > 0) body.instructions = stage.instructions;
  if (stage.producesArtifact !== '') body.produces = { artifact: stage.producesArtifact };
  if (stage.verify.length > 0) body.verify = stage.verify;
  if (stage.verifyTimeout !== null) body.verify_timeout = stage.verifyTimeout;
  if (stage.maxVerify !== null) body.max_verify = stage.maxVerify;
  if (stage.sessionResumeFrom !== '') body.session = { resume_from: stage.sessionResumeFrom };
  if (stage.runWhenPaths.length > 0) body.run_when = { changed_paths: stage.runWhenPaths };
  if (stage.decision.length > 0) body.decision = decisionBody(stage.decision);
  return body;
}

/**
 * The mapping the form describes. `schemaVersion` is the opened file's own; the CLI judges it.
 * Keys the form does not expose are never invented. */
export function workflowBodyFromForm(form: WorkflowForm, schemaVersion: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (schemaVersion !== null) body.schema_version = schemaVersion;
  if (form.id !== '') body.id = form.id;
  if (form.concurrency !== null) body.concurrency = form.concurrency;
  if (form.constraints.length > 0) body.constraints = form.constraints;
  body.stages = form.stages.map(stageBody);
  if (form.outputs.length > 0) {
    body.outputs = form.outputs.map((output) => ({
      name: output.name,
      from_stage: output.fromStage,
      artifact: output.artifact,
    }));
  }
  if (form.downstream.length > 0) {
    body.downstream = form.downstream.map((target) => {
      const entry: Record<string, unknown> = { workflow: target.workflow, task: target.task };
      const artifacts = pairsToRecord(target.artifacts);
      if (artifacts !== undefined) entry.artifacts = artifacts;
      return entry;
    });
  }
  return body;
}

/** The canonical YAML sent to `migent workflow save -`; `--preserve-comments` keeps the target's layout. */
export function workflowDraftFromForm(form: WorkflowForm, schemaVersion: number | null): string {
  return stringify(workflowBodyFromForm(form, schemaVersion), { lineWidth: 0 });
}

/** Parse one `migent workflow validate|save --json` envelope. Malformed output is reported, never trusted. */
export function parseWorkflowAuthoringEnvelope(raw: unknown): WorkflowAuthoringResult | null {
  if (!isRecord(raw) || typeof raw.valid !== 'boolean' || !Array.isArray(raw.diagnostics)) return null;
  const diagnostics: WorkflowDiagnostic[] = [];
  for (const item of raw.diagnostics) {
    if (!isRecord(item)) continue;
    const message = stringValue(item.message);
    if (message === '') continue;
    diagnostics.push({
      severity: item.severity === 'warning' ? 'warning' : 'error',
      code: stringValue(item.code),
      message,
      path: Array.isArray(item.path) ? item.path.map(String).join('.') : '',
    });
  }
  return {
    valid: raw.valid,
    diagnostics,
    file: typeof raw.file === 'string' ? raw.file : null,
    hash: typeof raw.hash === 'string' ? raw.hash : null,
    written: raw.written === true,
    currentHash: typeof raw.current_hash === 'string' ? raw.current_hash : null,
  };
}
