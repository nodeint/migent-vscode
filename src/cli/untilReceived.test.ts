import { describe, expect, it } from 'vitest';

import type { RunResult } from './runner';
import { untilReceivedOrExited } from './untilReceived';

const exited: RunResult = { kind: 'exited', exitCode: 0, outcome: 'Success', stderrTail: [] } as unknown as RunResult;

describe('untilReceivedOrExited', () => {
  it('returns the evidence while the process is still running', async () => {
    let calls = 0;
    const never = new Promise<RunResult>(() => undefined);
    const outcome = await untilReceivedOrExited(never, () => (++calls >= 3 ? 'resumed' : null), 1);
    expect(outcome).toEqual({ kind: 'received', value: 'resumed' });
    expect(calls).toBe(3);
  });

  it('returns the exit when the process ends before any evidence shows', async () => {
    const exit = new Promise<RunResult>((resolve) => {
      setTimeout(() => resolve(exited), 5);
    });
    const outcome = await untilReceivedOrExited(exit, () => null, 1);
    expect(outcome).toEqual({ kind: 'exited', result: exited });
  });

  it('prefers the exit when both are ready, without probing again', async () => {
    let calls = 0;
    const outcome = await untilReceivedOrExited(
      Promise.resolve(exited),
      () => {
        calls += 1;
        return 'late';
      },
      1,
    );
    expect(outcome.kind).toBe('exited');
    expect(calls).toBe(0);
  });
});
