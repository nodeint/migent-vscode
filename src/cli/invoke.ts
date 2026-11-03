import { execFile } from 'node:child_process';

import type { LaunchSpec } from './locate';

export const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

export type CliErrorKind = 'timeout' | 'spawn' | 'exit' | 'parse';

export interface CliError {
  kind: CliErrorKind;
  detail: string;
  exitCode?: number;
  stderr: string;
  /** Output printed before a non-zero exit; `doctor --json` reports its failed checks there. */
  stdout?: string;
}

export type InvokeResult<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: CliError };

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export type ExecOutcome =
  | { kind: 'done'; stdout: string; stderr: string }
  | { kind: 'failed'; error: CliError };

/** Runs one short command. Injected so callers are testable without a process. */
export type Exec = (launch: LaunchSpec, args: readonly string[], options: ExecOptions) => Promise<ExecOutcome>;

export const execWithExecFile: Exec = (launch, args, options) =>
  new Promise((resolve) => {
    execFile(
      launch.command,
      [...launch.prefixArgs, ...args],
      { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, windowsHide: true, shell: false, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ kind: 'done', stdout, stderr });
          return;
        }
        if (error.killed === true) {
          resolve({ kind: 'failed', error: { kind: 'timeout', detail: `Timed out after ${options.timeoutMs} ms.`, stderr } });
        } else if (typeof error.code === 'number') {
          resolve({ kind: 'failed', error: { kind: 'exit', detail: error.message, exitCode: error.code, stderr, stdout } });
        } else {
          resolve({ kind: 'failed', error: { kind: 'spawn', detail: error.message, stderr } });
        }
      },
    );
  });

export interface InvokeOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  exec?: Exec;
}

/** Run a short command and return its stdout. No shell; `args` are passed as separate argv values. */
export async function invokeText(
  launch: LaunchSpec,
  args: readonly string[],
  options: InvokeOptions,
): Promise<InvokeResult<string>> {
  const exec = options.exec ?? execWithExecFile;
  const outcome = await exec(launch, args, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
  });
  if (outcome.kind === 'failed') return { kind: 'error', error: outcome.error };
  return { kind: 'ok', value: outcome.stdout };
}

/** Like `invokeText`, then parse stdout as JSON. */
export async function invokeJson(
  launch: LaunchSpec,
  args: readonly string[],
  options: InvokeOptions,
): Promise<InvokeResult<unknown>> {
  const result = await invokeText(launch, args, options);
  if (result.kind === 'error') return result;
  try {
    return { kind: 'ok', value: JSON.parse(result.value) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'error', error: { kind: 'parse', detail: `Output is not JSON: ${detail}`, stderr: '' } };
  }
}
