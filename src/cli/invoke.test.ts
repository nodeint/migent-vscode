import { describe, expect, it } from 'vitest';

import { type Exec, invokeCaptured, invokeJson, invokeText } from './invoke';
import type { LaunchSpec } from './locate';

const launch: LaunchSpec = { command: 'migent', prefixArgs: [], via: 'native' };

type Seen = { args: readonly string[]; timeoutMs: number; input?: string }[];

function exec(outcome: Awaited<ReturnType<Exec>>): { exec: Exec; seen: Seen } {
  const seen: Seen = [];
  return {
    seen,
    exec: (_launch, args, options) => {
      seen.push({
        args,
        timeoutMs: options.timeoutMs,
        ...(options.input === undefined ? {} : { input: options.input }),
      });
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

  it('forwards a draft on stdin for commands that read `-`', async () => {
    const fake = exec({ kind: 'done', stdout: '{"valid":true}', stderr: '' });
    await invokeJson(launch, ['workflow', 'save', '-'], { cwd: '/p', input: 'schema_version: 5\n', exec: fake.exec });
    expect(fake.seen[0]).toEqual({
      args: ['workflow', 'save', '-'],
      timeoutMs: 30_000,
      input: 'schema_version: 5\n',
    });
  });
});

describe('invokeCaptured', () => {
  it('keeps the stderr of a successful run, which invokeText drops', async () => {
    const fake = exec({ kind: 'done', stdout: 'ok', stderr: 'warning: missing artifact' });
    const result = await invokeCaptured(launch, ['session', 'complete', 's'], { cwd: '/p', exec: fake.exec });
    expect(result).toEqual({ kind: 'ok', value: { stdout: 'ok', stderr: 'warning: missing artifact' } });
    expect(await invokeText(launch, [], { cwd: '/p', exec: fake.exec })).toEqual({ kind: 'ok', value: 'ok' });
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
