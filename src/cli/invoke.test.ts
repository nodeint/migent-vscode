import { describe, expect, it } from 'vitest';

import { type Exec, invokeJson, invokeText } from './invoke';
import type { LaunchSpec } from './locate';

const launch: LaunchSpec = { command: 'migent', prefixArgs: [], via: 'native' };

type Seen = { args: readonly string[]; timeoutMs: number }[];

function exec(outcome: Awaited<ReturnType<Exec>>): { exec: Exec; seen: Seen } {
  const seen: Seen = [];
  return {
    seen,
    exec: (_launch, args, options) => {
      seen.push({ args, timeoutMs: options.timeoutMs });
      return Promise.resolve(outcome);
    },
  };
}

describe('invokeJson', () => {
  it('parses stdout and uses the given timeout', async () => {
    const fake = exec({ kind: 'done', stdout: '{"id":"s1"}', stderr: '' });
    const result = await invokeJson(launch, ['session', 'show', 's1', '--json'], {
      cwd: '/p',
      timeoutMs: 1000,
      exec: fake.exec,
    });
    expect(result).toEqual({ kind: 'ok', value: { id: 's1' } });
    expect(fake.seen[0]).toEqual({ args: ['session', 'show', 's1', '--json'], timeoutMs: 1000 });
  });

  it('returns a typed parse error for non-JSON output', async () => {
    const fake = exec({ kind: 'done', stdout: 'not json', stderr: '' });
    const result = await invokeJson(launch, [], { cwd: '/p', exec: fake.exec });
    expect(result).toMatchObject({ kind: 'error', error: { kind: 'parse' } });
  });
});

describe('invokeText', () => {
  it('passes through a typed exit error with stderr', async () => {
    const fake = exec({ kind: 'failed', error: { kind: 'exit', detail: 'failed', exitCode: 2, stderr: 'bad config' } });
    const result = await invokeText(launch, ['doctor'], { cwd: '/p', exec: fake.exec });
    expect(result).toEqual({
      kind: 'error',
      error: { kind: 'exit', detail: 'failed', exitCode: 2, stderr: 'bad config' },
    });
  });
});
