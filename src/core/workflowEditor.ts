import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import type { ClientChoice } from './controlArgs';
import { MIGENT_DIR, WORKFLOWS_DIRNAME } from './paths';
import type { ProjectConfig } from './projectConfig';
import { projectRelative } from './projectPresentation';
import { isRecord } from './record';
import {
  EDITABLE_SCHEMA_VERSION,
  type WorkflowAgentForm,
  type WorkflowAgentMode,
  type WorkflowForm,
  type WorkflowLocalArtifactForm,
  type WorkflowRouteArtifacts,
  type WorkflowStageForm,
} from './workflowForm';
import type { WorkflowScan } from './workflows';

export * from './workflowForm';

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

function localArtifactBody(id: string, value: unknown): WorkflowLocalArtifactForm {
  const body = isRecord(value) ? value : {};
  return { id, file: stringValue(body.file), description: stringValue(body.description) };
}

/** A list stays registry ids; a mapping keyed by id holds artifacts local to the decision. */
function routeArtifacts(value: unknown): WorkflowRouteArtifacts {
  if (Array.isArray(value)) return { kind: 'ids', ids: strings(value) };
  if (isRecord(value)) {
    return { kind: 'local', items: Object.entries(value).map(([id, item]) => localArtifactBody(id, item)) };
  }
  return null;
}

function decisions(value: unknown): WorkflowStageForm['decision'] {
  if (!Array.isArray(value)) return [];
  const routes: WorkflowStageForm['decision'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    for (const [name, route] of Object.entries(entry)) {
      const body = isRecord(route) ? route : {};
      routes.push({
        value: name,
        when: stringValue(body.when),
        navigate: navigationText(body.navigate),
        artifacts: routeArtifacts(body.artifacts),
      });
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
  const session = isRecord(body.session) ? body.session : {};
  const runWhen = isRecord(body.run_when) ? body.run_when : {};
  return {
    id: stringValue(body.id),
    description: stringValue(body.description),
    role: stringValue(body.role),
    ask: stringValue(body.ask),
    ...agentFields(body.agent),
    depends_on: strings(body.depends_on),
    max_revisions: numberValue(body.max_revisions),
    instructions: strings(body.instructions),
    artifacts: strings(body.artifacts),
    sessionResumeFrom: stringValue(session.resume_from),
    verify: strings(body.verify),
    verify_timeout: numberValue(body.verify_timeout),
    max_verify: numberValue(body.max_verify),
    runWhenPaths: strings(runWhen.changed_paths),
    decision: decisions(body.decision),
  };
}

function formFromBody(body: Record<string, unknown>, fallbackId: string): WorkflowForm {
  const registry = isRecord(body.artifacts) ? Object.entries(body.artifacts) : [];
  const downstream = Array.isArray(body.downstream) ? body.downstream : [];
  return {
    id: stringValue(body.id) || fallbackId,
    concurrency: numberValue(body.concurrency),
    constraints: strings(body.constraints),
    stages: (Array.isArray(body.stages) ? body.stages : []).map(stageForm),
    artifacts: registry.map(([id, value]) => {
      const item = isRecord(value) ? value : {};
      return {
        id,
        file: stringValue(item.file),
        description: stringValue(item.description),
        required: typeof item.required === 'boolean' ? item.required : null,
      };
    }),
    downstream: downstream.map((value) => {
      const target = isRecord(value) ? value : {};
      return {
        workflow: stringValue(target.workflow),
        task: stringValue(target.task),
        artifacts: isRecord(target.artifacts) ? pairs(target.artifacts) : null,
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
  const isSupported = schemaVersion === EDITABLE_SCHEMA_VERSION;
  return {
    ...base,
    id: form.id,
    schemaVersion,
    state: isSupported ? 'ok' : 'unsupported',
    isSupported,
    canSave: isSupported,
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

function clientLocalArtifact(value: unknown): WorkflowLocalArtifactForm {
  const body = isRecord(value) ? value : {};
  return { id: stringValue(body.id), file: stringValue(body.file), description: stringValue(body.description) };
}

function clientRouteArtifacts(value: unknown): WorkflowRouteArtifacts {
  if (!isRecord(value)) return null;
  if (value.kind === 'ids') return { kind: 'ids', ids: strings(value.ids) };
  if (value.kind === 'local') {
    return { kind: 'local', items: (Array.isArray(value.items) ? value.items : []).map(clientLocalArtifact) };
  }
  return null;
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
    depends_on: strings(body.depends_on),
    max_revisions: numberValue(body.max_revisions),
    instructions: strings(body.instructions),
    artifacts: strings(body.artifacts),
    sessionResumeFrom: stringValue(body.sessionResumeFrom),
    verify: strings(body.verify),
    verify_timeout: numberValue(body.verify_timeout),
    max_verify: numberValue(body.max_verify),
    runWhenPaths: strings(body.runWhenPaths),
    decision: (Array.isArray(body.decision) ? body.decision : []).filter(isRecord).map((route) => ({
      value: stringValue(route.value),
      when: stringValue(route.when),
      navigate: stringValue(route.navigate),
      artifacts: clientRouteArtifacts(route.artifacts),
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
    artifacts: (Array.isArray(body.artifacts) ? body.artifacts : []).filter(isRecord).map((item) => ({
      id: stringValue(item.id),
      file: stringValue(item.file),
      description: stringValue(item.description),
      required: typeof item.required === 'boolean' ? item.required : null,
    })),
    downstream: (Array.isArray(body.downstream) ? body.downstream : []).filter(isRecord).map((target) => ({
      workflow: stringValue(target.workflow),
      task: stringValue(target.task),
      artifacts: Array.isArray(target.artifacts) ? pairList(target.artifacts) : null,
    })),
  };
}

// ---------- the canonical schema 7 draft the CLI saves ----------

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

/** Decision-local artifacts are a mapping keyed by id. */
function localArtifactsRecord(items: WorkflowLocalArtifactForm[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const item of items) {
    const entry: Record<string, unknown> = { file: item.file };
    if (item.description !== '') entry.description = item.description;
    record[item.id] = entry;
  }
  return record;
}

function decisionBody(routes: WorkflowStageForm['decision']): Record<string, unknown>[] {
  return routes.map((route) => {
    const body: Record<string, unknown> = {};
    if (route.when !== '') body.when = route.when;
    const navigate = navigateValue(route.navigate);
    if (navigate !== undefined) body.navigate = navigate;
    if (route.artifacts?.kind === 'ids') body.artifacts = route.artifacts.ids;
    else if (route.artifacts?.kind === 'local') body.artifacts = localArtifactsRecord(route.artifacts.items);
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
  if (stage.depends_on.length > 0) body.depends_on = stage.depends_on;
  if (stage.max_revisions !== null) body.max_revisions = stage.max_revisions;
  if (stage.instructions.length > 0) body.instructions = stage.instructions;
  if (stage.artifacts.length > 0) body.artifacts = stage.artifacts;
  if (stage.verify.length > 0) body.verify = stage.verify;
  if (stage.verify_timeout !== null) body.verify_timeout = stage.verify_timeout;
  if (stage.max_verify !== null) body.max_verify = stage.max_verify;
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
  if (form.artifacts.length > 0) {
    // The registry is a mapping keyed by artifact id.
    const registry: Record<string, unknown> = {};
    for (const item of form.artifacts) {
      const entry: Record<string, unknown> = { file: item.file };
      if (item.description !== '') entry.description = item.description;
      if (item.required !== null) entry.required = item.required;
      registry[item.id] = entry;
    }
    body.artifacts = registry;
  }
  body.stages = form.stages.map(stageBody);
  if (form.downstream.length > 0) {
    body.downstream = form.downstream.map((target) => {
      const entry: Record<string, unknown> = { workflow: target.workflow };
      if (target.task !== '') entry.task = target.task;
      // Absent passes every published artifact; an explicit mapping, even an empty one, passes only what it names.
      if (target.artifacts !== null) entry.artifacts = pairsToRecord(target.artifacts) ?? {};
      return entry;
    });
  }
  return body;
}

/**
 * The first artifact id used twice, in the registry or within one decision's local artifacts, as a message; null when
 * none. Both serializations are mappings keyed by id, so a duplicate would silently discard the earlier definition
 * and the CLI could not see it. Hosts refuse to save before serializing.
 */
export function duplicateArtifactProblem(form: WorkflowForm): string | null {
  const repeated = (ids: string[]): string | undefined => ids.find((id, index) => ids.indexOf(id) !== index);
  const registry = repeated(form.artifacts.map((item) => item.id));
  if (registry !== undefined) return `The artifact id "${registry}" is used more than once. Give each artifact its own id.`;
  for (const stage of form.stages) {
    for (const route of stage.decision) {
      if (route.artifacts?.kind !== 'local') continue;
      const local = repeated(route.artifacts.items.map((item) => item.id));
      if (local !== undefined) {
        return `Decision "${route.value}" of stage "${stage.id}" defines the artifact id "${local}" more than once.`;
      }
    }
  }
  return null;
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
