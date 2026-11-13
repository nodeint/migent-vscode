import type {
  DoctorReport,
  GetClient,
  GetModel,
  GetNativeOption,
  PrepareResult,
  RenameResult,
  Static,
} from '@nodeint/migent-contracts';

import { text } from '../text';
import { type Wire, wireOf } from './contractRead';

type PrepareOutput = Static<typeof PrepareResult>;
type RenameOutput = Static<typeof RenameResult>;
type ClientRow = Static<typeof GetClient>;
type ModelRow = Static<typeof GetModel>;
type NativeOptionRow = Static<typeof GetNativeOption>;
type DoctorCheckRow = DoctorReport['checks'][number];

/** The values the extension compares against, typed by the contract so a field type change fails typecheck. */
const AVAILABLE_FLAG: ClientRow['available'] = true;
const DEFAULT_FLAG: ModelRow['default'] = true;

/**
 * Pure argv builders for the write commands (plans/03-control.md §2). Each value is its own argv entry:
 * nothing here quotes, concatenates or goes through a shell. No `vscode` import.
 */

export interface RunSettings {
  /** Stage dispatches allowed per command (`migent.run.maxDispatches`). */
  maxDispatches: number;
  /** Print each tool call (`migent.run.progress`). */
  progress: boolean;
}

export const DEFAULT_RUN_SETTINGS: RunSettings = { maxDispatches: 20, progress: true };

function runFlags(settings: RunSettings): string[] {
  const flags = ['--max-dispatches', String(Math.max(1, Math.floor(settings.maxDispatches)))];
  if (settings.progress) flags.push('--progress');
  return flags;
}

/** `session run --workflow <id> --task <task>`: creates and starts a new session. */
export function runNewArgs(input: { workflowId: string; task: string }, settings: RunSettings): string[] {
  return ['session', 'run', '--workflow', input.workflowId, '--task', input.task, ...runFlags(settings)];
}

/** `session run --session <id> --workflow <id>`: starts a prepared session (Save & Run). */
export function runPreparedArgs(
  input: { sessionId: string; workflowId: string },
  settings: RunSettings,
): string[] {
  return ['session', 'run', '--session', input.sessionId, '--workflow', input.workflowId, ...runFlags(settings)];
}

/**
 * `session run --workflow <id> --prior <source> [--task <override>]`: a new session whose context comes from a
 * Completed source. Without `task` the CLI takes the declared default (plans/03b-downstream-handoff.md §6).
 */
export function runDownstreamArgs(
  input: { workflowId: string; priorSessionId: string; task: string | null },
  settings: RunSettings,
): string[] {
  const args = ['session', 'run', '--workflow', input.workflowId, '--prior', input.priorSessionId];
  if (input.task !== null) args.push('--task', input.task);
  return [...args, ...runFlags(settings)];
}

/** `session prepare <title> --workflow <id> [--prior <source>]`; the CLI prints one JSON object on stdout. */
export function prepareArgs(input: { title: string; workflowId: string; priorSessionId?: string }): string[] {
  const args = ['session', 'prepare', input.title, '--workflow', input.workflowId];
  if (input.priorSessionId !== undefined) args.push('--prior', input.priorSessionId);
  return args;
}

export interface ContinueInput {
  sessionId: string;
  /** Dispatch one stage without resetting revision counts. */
  once?: boolean;
  /** Re-run the workflow definition the user chose to adopt. */
  refreshWorkflow?: boolean;
}

export function continueArgs(input: ContinueInput, settings: RunSettings): string[] {
  const args = ['session', 'continue', input.sessionId];
  if (input.once === true) args.push('--once');
  if (input.refreshWorkflow === true) args.push('--refresh-workflow');
  return [...args, ...runFlags(settings)];
}

/** `session cancel <id> --json`; the CLI waits up to 15 seconds by default. */
export function cancelArgs(sessionId: string): string[] {
  return ['session', 'cancel', sessionId, '--json'];
}

/** `session complete <id>`: marks a stopped workflow session completed without dispatching a stage. */
export function completeArgs(sessionId: string): string[] {
  return ['session', 'complete', sessionId];
}

/** `session rename <id> <title>`: one argv entry per value, so the title is never quoted or split. */
export function renameArgs(sessionId: string, title: string): string[] {
  return ['session', 'rename', sessionId, title, '--json'];
}

/** What `session rename --json` printed: the new title, or null when it is not the documented object. */
export function parseRenameOutput(text: string): { sessionId: string; title: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const result = wireOf<RenameOutput, 'session_id' | 'title'>(value);
  if (result === null) return null;
  const { session_id: sessionId, title } = result;
  return typeof sessionId === 'string' && typeof title === 'string' ? { sessionId, title } : null;
}

/** What `session prepare` printed, or null when it is not the documented object. */
export function parsePrepared(
  value: unknown,
): { sessionId: PrepareOutput['session_id']; taskPath: PrepareOutput['task_path'] } | null {
  const prepared = wireOf<PrepareOutput, 'session_id' | 'task_path'>(value);
  if (prepared === null) return null;
  const { session_id: sessionId, task_path: taskPath } = prepared;
  if (typeof sessionId !== 'string' || typeof taskPath !== 'string') return null;
  if (sessionId.length === 0 || taskPath.length === 0) return null;
  return { sessionId, taskPath };
}

/**
 * `session continue <id> [--stage <stage>] --reply-file <path>`: submits one complete question batch.
 * Run flags are not added: the reply continues the stage, and the CLI enforces its own budgets.
 */
export function answerArgs(input: { sessionId: string; stageId: string | null; replyFile: string }): string[] {
  const args = ['session', 'continue', input.sessionId];
  if (input.stageId !== null) args.push('--stage', input.stageId);
  return [...args, '--reply-file', input.replyFile];
}

/** `session repair <id>`: rebuilds `status.json` from the session directory. */
export function repairArgs(sessionId: string): string[] {
  return ['session', 'repair', sessionId];
}

/** `doctor --json`: the CLI prints one JSON object and exits 1 when a check fails. */
export function doctorArgs(): string[] {
  return ['doctor', '--json'];
}

/** `get clients --json`: one row per registered CLI client, with PATH facts only and no subprocess. */
export function clientsArgs(): string[] {
  return ['get', 'clients', '--json'];
}

/** `get models --json`: one row per (client, model); a client that is missing or fails has no rows. */
export function modelsArgs(): string[] {
  return ['get', 'models', '--json'];
}

function stringList(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.filter((entry): entry is string => typeof entry === 'string');
}

export interface ClientChoice {
  /** The client id `init --client` accepts, such as `claude-code`. */
  id: ClientRow['name'];
  models: ModelRow['name'][];
  /** The model `get models` marks as default for this client. */
  defaultModel?: ModelRow['name'];
  /** Native option keys the client reports in `get options --native`. */
  optionKeys?: NativeOptionRow['name'][];
}

/** The models of a client with its default first, when it is one of them. */
export function modelsDefaultFirst(choice: ClientChoice): string[] {
  const { defaultModel } = choice;
  if (defaultModel === undefined || !choice.models.includes(defaultModel)) return choice.models;
  return [defaultModel, ...choice.models.filter((model) => model !== defaultModel)];
}

/** The model names a client reports in `get models --json` rows, in CLI order, and its default one. */
function clientModels(
  models: unknown[],
  client: ModelRow['client'],
): { names: ModelRow['name'][]; defaultModel?: ModelRow['name'] } {
  const names: ModelRow['name'][] = [];
  let defaultModel: ModelRow['name'] | undefined;
  for (const item of models) {
    const row = wireOf<ModelRow, 'client' | 'name' | 'default'>(item);
    if (row?.client !== client || typeof row.name !== 'string' || row.name === '') continue;
    names.push(row.name);
    if (row.default === DEFAULT_FLAG) defaultModel = row.name;
  }
  return defaultModel === undefined ? { names } : { names, defaultModel };
}

/**
 * Joins `get clients --json` and `get models --json` into what `migent init --no-input` accepts: the clients that
 * are available on `PATH`, each with the models it reports. Clients without models are dropped.
 */
export function joinClients(clients: unknown, models: unknown): ClientChoice[] {
  if (!Array.isArray(clients) || !Array.isArray(models)) return [];
  const choices: ClientChoice[] = [];
  for (const row of clients as unknown[]) {
    const item = wireOf<ClientRow, 'name' | 'available'>(row);
    if (item === null || typeof item.name !== 'string' || item.name === '' || item.available !== AVAILABLE_FLAG) continue;
    const { names, defaultModel } = clientModels(models as unknown[], item.name);
    if (names.length === 0) continue;
    const choice: ClientChoice = { id: item.name, models: names };
    if (defaultModel !== undefined) choice.defaultModel = defaultModel;
    choices.push(choice);
  }
  return choices;
}

/** `get models --client <id> --json`: the models one client reports, with its default. */
export function clientModelsArgs(client: string): string[] {
  return ['get', 'models', '--client', client, '--json'];
}

/** `get options --client <id> --native --json`: the client's native headless options. */
export function clientOptionsArgs(client: string): string[] {
  return ['get', 'options', '--client', client, '--native', '--json'];
}

/** The names of the available clients in `get clients --json`, in CLI order. */
export function availableClients(value: unknown): ClientRow['name'][] {
  if (!Array.isArray(value)) return [];
  const names: ClientRow['name'][] = [];
  for (const item of value as unknown[]) {
    const row = wireOf<ClientRow, 'name' | 'available'>(item);
    if (row !== null && row.available === AVAILABLE_FLAG && typeof row.name === 'string' && row.name !== '') names.push(row.name);
  }
  return names;
}

/**
 * One client's choice for the workflow editor from its `get models` and native `get options` rows; null when the
 * client reports no model.
 */
export function clientChoice(client: ModelRow['client'], models: unknown, options: unknown): ClientChoice | null {
  if (!Array.isArray(models)) return null;
  const { names, defaultModel } = clientModels(models as unknown[], client);
  if (names.length === 0) return null;
  const choice: ClientChoice = { id: client, models: names };
  if (defaultModel !== undefined) choice.defaultModel = defaultModel;
  const optionKeys = Array.isArray(options)
    ? (options as unknown[])
        .map((option) => wireOf<NativeOptionRow, 'name'>(option))
        .map((option): NativeOptionRow['name'] => (typeof option?.name === 'string' ? option.name : ''))
        .filter((name) => name !== '')
    : [];
  if (optionKeys.length > 0) choice.optionKeys = optionKeys;
  return choice;
}

export interface RoleModel {
  client: string;
  model: string;
}

/**
 * The agents of the CLI 0.6.0 project template, with the roles each serves. 0.6.0 exposes no listing before a project
 * exists, so this is the one place to update when the template changes.
 */
export const INIT_AGENTS = [
  { name: 'coding', roles: ['developer', 'operator'] },
  { name: 'planning', roles: ['architect'] },
  { name: 'review', roles: ['reviewer'] },
] as const;

export type InitAgentName = (typeof INIT_AGENTS)[number]['name'];

export type InitInput = Record<InitAgentName, RoleModel>;

/** `init --no-input` with one `--agent NAME=CLIENT:MODEL` value per template agent, each a single argv element. */
export function initArgs(input: InitInput): string[] {
  const args = ['init'];
  for (const { name } of INIT_AGENTS) args.push('--agent', `${name}=${input[name].client}:${input[name].model}`);
  args.push('--no-input');
  return args;
}

/** One doctor check as the extension reads it. `items` is not read; `problems` and `warnings` default to empty. */
export interface DoctorCheck {
  name: DoctorCheckRow['name'];
  ok: DoctorCheckRow['ok'];
  problems: DoctorCheckRow['problems'];
  warnings: DoctorCheckRow['warnings'];
}

/** The checks of `doctor --json`, or null when the output is not the documented object. */
export function parseDoctor(value: unknown): DoctorCheck[] | null {
  const report = wireOf<DoctorReport, 'checks'>(value);
  if (report === null || !Array.isArray(report.checks)) return null;
  const checks: DoctorCheck[] = [];
  for (const raw of report.checks as unknown[]) {
    const item: Wire<DoctorCheckRow> | null = wireOf<DoctorCheckRow>(raw);
    if (item === null || typeof item.name !== 'string') return null;
    checks.push({
      name: item.name,
      ok: item.ok === true,
      problems: stringList(item.problems),
      warnings: stringList(item.warnings),
    });
  }
  return checks;
}

/** `parseDoctor` on raw stdout; null when it is not JSON either. */
export function parseDoctorOutput(text: string): DoctorCheck[] | null {
  try {
    return parseDoctor(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** Text lines for the Output channel: one line per check, then its problems and warnings. */
export function doctorLines(checks: readonly DoctorCheck[]): string[] {
  const lines: string[] = [];
  for (const check of checks) {
    lines.push(text(check.ok ? 'documents.doctorOk' : 'documents.doctorFail', { name: check.name }));
    for (const problem of check.problems) lines.push(text('documents.doctorProblem', { problem }));
    for (const warning of check.warnings) lines.push(text('documents.doctorWarning', { warning }));
  }
  return lines;
}
