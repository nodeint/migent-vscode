import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';

import { type DiagnosticPaths, LineBuffer, mapExitCode, parseDiagnosticPaths, type RunOutcome } from './exitCode';
import type { LaunchSpec } from './locate';

/** Recent stderr lines kept for diagnostics; the full text belongs in the session log. */
export const STDERR_TAIL_LINES = 50;

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  /** Called once per complete stderr line, which is the CLI's line-based log. */
  onStderrLine?: (line: string) => void;
}

export type RunResult =
  | ({ kind: 'exited'; exitCode: number | null; outcome: RunOutcome; stderrTail: string[] } & DiagnosticPaths)
  | { kind: 'spawn-failed'; detail: string };

export interface RunHandle {
  pid: number | undefined;
  result: Promise<RunResult>;
}

/**
 * Start a long command (`session run`, `session continue`). No shell, no window. On POSIX the child
 * is detached so it survives a window reload; whether it survives the extension host exiting on
 * Windows is verified separately (plans/03-control.md §1).
 */
export function runLong(launch: LaunchSpec, args: readonly string[], options: RunOptions): RunHandle {
  const platform = options.platform ?? process.platform;
  const start = options.spawn ?? spawn;
  let child: ChildProcess;
  try {
    child = start(launch.command, [...launch.prefixArgs, ...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { pid: undefined, result: Promise.resolve({ kind: 'spawn-failed', detail }) };
  }
  const tail: string[] = [];
  const buffer = new LineBuffer();
  const emit = (line: string): void => {
    tail.push(line);
    if (tail.length > STDERR_TAIL_LINES) tail.shift();
    options.onStderrLine?.(line);
  };
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    for (const line of buffer.push(chunk)) emit(line);
  });
  const result = new Promise<RunResult>((resolve) => {
    let isSettled = false;
    const settle = (value: RunResult): void => {
      if (isSettled) return;
      isSettled = true;
      resolve(value);
    };
    child.once('error', (error) => {
      settle({ kind: 'spawn-failed', detail: error.message });
    });
    child.once('close', (code) => {
      for (const line of buffer.flush()) emit(line);
      settle({
        kind: 'exited',
        exitCode: code,
        outcome: mapExitCode(code),
        stderrTail: [...tail],
        ...parseDiagnosticPaths(tail),
      });
    });
  });
  return { pid: child.pid, result };
}
