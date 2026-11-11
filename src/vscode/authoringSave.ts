import { describeCapability } from '../cli/capabilityText';
import { exitCodeOf } from '../cli/exitCode';
import { invokeJson } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import type { CapabilityState } from '../cli/version';
import { type AuthoringDiagnostic, type AuthoringResult, parseAuthoringEnvelope } from '../core/authoring';
import { text } from '../text';
import type { CapabilityService } from './capability';
import type { ProjectKey } from './changes';

/** Exit code of a rejected save because the file no longer matches the base hash (authoring family: `stage_failed`). */
export const EXIT_CONFLICT = exitCodeOf('stage_failed');

export const SAVE_TIMEOUT_MS = 30_000;

export interface Validation {
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
}

export const EMPTY_VALIDATION: Validation = { errors: [], warnings: [] };

export function splitDiagnostics(diagnostics: AuthoringDiagnostic[]): Validation {
  return {
    errors: diagnostics.filter((item) => item.severity === 'error').map((item) => ({ path: item.path, message: item.message })),
    warnings: diagnostics
      .filter((item) => item.severity === 'warning')
      .map((item) => ({ path: item.path, message: item.message })),
  };
}

export function envelopeOf(stdout: string | undefined): AuthoringResult | null {
  if (stdout === undefined || stdout.trim() === '') return null;
  try {
    return parseAuthoringEnvelope(JSON.parse(stdout) as unknown);
  } catch {
    return null;
  }
}

/** A short, safe description of why the CLI could not save. */
export function saveFailure(exitCode: number | undefined, stderr: string): string {
  const last = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);
  if (last !== undefined) return text('prompts.saveFailedLast', { last });
  return exitCode === undefined ? text('prompts.saveCouldNotRun') : text('prompts.saveExited', { code: exitCode });
}

/** The launch to save with, or the message to show when the CLI is not usable. */
export async function usableLaunch(
  capability: CapabilityService,
  project: ProjectKey,
): Promise<{ launch: LaunchSpec } | { message: string }> {
  let state: CapabilityState = capability.state(project);
  if (state.kind === 'checking') state = await capability.windowReady();
  if (state.kind === 'ok' && state.launch !== undefined) return { launch: state.launch };
  const diagnostic = describeCapability(state);
  return {
    message: text('prompts.savingNeedsCli', { detail: diagnostic?.label ?? text('prompts.cliCheckPending') }),
  };
}

/** What one save attempt came to. Only `written` counts as saved. */
export type SaveOutcome =
  | { kind: 'written'; envelope: AuthoringResult }
  | { kind: 'unconfirmed' }
  | { kind: 'conflict'; envelope: AuthoringResult }
  | { kind: 'invalid'; envelope: AuthoringResult }
  | { kind: 'failed'; message: string };

/** Run one `... save -` command with the draft on stdin and classify the result. */
export async function runAuthoringSave(
  launch: LaunchSpec,
  args: readonly string[],
  request: { cwd: string; input: string },
): Promise<SaveOutcome> {
  const result = await invokeJson(launch, args, { cwd: request.cwd, input: request.input, timeoutMs: SAVE_TIMEOUT_MS });
  if (result.kind === 'ok') {
    const envelope = parseAuthoringEnvelope(result.value);
    return envelope?.written === true ? { kind: 'written', envelope } : { kind: 'unconfirmed' };
  }
  const envelope = envelopeOf(result.error.stdout);
  if (envelope !== null) {
    if (result.error.exitCode === EXIT_CONFLICT) return { kind: 'conflict', envelope };
    if (envelope.diagnostics.some((item) => item.severity === 'error')) return { kind: 'invalid', envelope };
  }
  return { kind: 'failed', message: saveFailure(result.error.exitCode, result.error.stderr) };
}
