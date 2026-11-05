import type { RunResult } from './runner';

export type ReceivedOrExited<T> = { kind: 'received'; value: T } | { kind: 'exited'; result: RunResult };

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for a long CLI command (`session continue --reply-file`) to be received or to exit, whichever is first.
 *
 * The command runs the whole stage and exits only when the stage is done, but what it was sent is received within
 * moments, and the session shows it. `probe` looks at that evidence and returns it, or null while there is none. It
 * runs once per `pollMs` until the process exits, so the caller can settle early and let the process carry on.
 * The process is never stopped here.
 */
export async function untilReceivedOrExited<T>(
  exit: Promise<RunResult>,
  probe: () => T | null,
  pollMs: number,
): Promise<ReceivedOrExited<T>> {
  let result: RunResult | undefined;
  void exit.then((value) => {
    result = value;
  });
  for (;;) {
    await Promise.race([exit, pause(pollMs)]);
    if (result !== undefined) return { kind: 'exited', result };
    const value = probe();
    if (value !== null) return { kind: 'received', value };
  }
}
