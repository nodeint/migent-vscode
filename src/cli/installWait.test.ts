import { describe, expect, it } from 'vitest';

import { InstallWait } from './installWait';

describe('InstallWait', () => {
  it('ignores the end of an earlier command and settles on the install execution', async () => {
    const wait = new InstallWait<string, string>();
    wait.track('install');
    wait.executionEnded('previous', 0);
    wait.executionEnded('install', 1);
    await expect(wait.promise).resolves.toEqual({ exitCode: 1 });
  });

  it('does not settle for an execution before the install is tracked', async () => {
    const wait = new InstallWait<string, string>();
    wait.executionEnded('previous', 0);
    wait.terminalClosed('other', 't');
    wait.terminalClosed('t', 't');
    await expect(wait.promise).resolves.toEqual({ exitCode: undefined });
  });
});
