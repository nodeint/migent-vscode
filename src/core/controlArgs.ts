import { isRecord } from './record';

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

/** `session continue <source>` on a Completed session: regenerates `next.json` and dispatches no stage. */
export function regenerateNextArgs(sessionId: string): string[] {
  return ['session', 'continue', sessionId];
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

/** What `session prepare` printed, or null when it is not the documented object. */
export function parsePrepared(value: unknown): { sessionId: string; taskPath: string } | null {
  if (!isRecord(value)) return null;
  const { session_id: sessionId, task_path: taskPath } = value;
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

export function providersArgs(): string[] {
  return ['provider', 'list', '--json'];
}

function stringList(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.filter((entry): entry is string => typeof entry === 'string');
}

export interface ProviderChoice {
  name: string;
  models: string[];
}

/** The available providers of `provider list --json` with their models; unavailable ones are dropped. */
export function parseProviders(value: unknown): ProviderChoice[] {
  if (!isRecord(value) || !Array.isArray(value.providers)) return [];
  const choices: ProviderChoice[] = [];
  for (const item of value.providers as unknown[]) {
    if (!isRecord(item) || typeof item.name !== 'string' || item.available !== true) continue;
    const models = stringList(item.models);
    if (models.length > 0) choices.push({ name: item.name, models });
  }
  return choices;
}

export interface RoleModel {
  provider: string;
  model: string;
}

export interface InitInput {
  planner: RoleModel;
  reviewer: RoleModel;
  developer: RoleModel;
}

/** `init --no-input` with every role's provider and model as separate argv values. */
export function initArgs(input: InitInput): string[] {
  return [
    'init',
    '--planner-provider',
    input.planner.provider,
    '--planner-model',
    input.planner.model,
    '--reviewer-provider',
    input.reviewer.provider,
    '--reviewer-model',
    input.reviewer.model,
    '--provider',
    input.developer.provider,
    '--model',
    input.developer.model,
    '--no-input',
  ];
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/** The checks of `doctor --json`, or null when the output is not the documented object. */
export function parseDoctor(value: unknown): DoctorCheck[] | null {
  if (!isRecord(value) || !Array.isArray(value.checks)) return null;
  const checks: DoctorCheck[] = [];
  for (const item of value.checks as unknown[]) {
    if (!isRecord(item) || typeof item.name !== 'string') return null;
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
    lines.push(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`);
    for (const problem of check.problems) lines.push(`     problem: ${problem}`);
    for (const warning of check.warnings) lines.push(`     warning: ${warning}`);
  }
  return lines;
}
