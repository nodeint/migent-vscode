import { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { LaunchSpec } from './locate';
import { runLong, type SpawnFn } from './runner';

const launch: LaunchSpec = { command: 'node', prefixArgs: ['cli.js'], via: 'node-script' };

interface FakeChild extends EventEmitter {
  pid: number;
  stderr: PassThrough;
}

type Calls = { args: readonly string[]; options: SpawnOptions }[];

function fakeSpawn(): { spawn: SpawnFn; child: FakeChild; calls: Calls } {
  const child = Object.assign(new EventEmitter(), { pid: 1234, stderr: new PassThrough() }) as FakeChild;
  const calls: Calls = [];
  const spawn: SpawnFn = (_command, args, options) => {
    calls.push({ args, options });
    return child as unknown as ChildProcess;
  };
  return { spawn, child, calls };
}

describe('runLong', () => {
  it('passes argv without a shell, hides the window, and detaches on POSIX', () => {
    const { spawn, child, calls } = fakeSpawn();
    const handle = runLong(launch, ['session', 'run', '--task', 'a "quoted" task'], {
      cwd: '/p',
      platform: 'linux',
      spawn,
    });
    child.emit('close', 0);
    expect(handle.pid).toBe(1234);
    expect(calls[0].args).toEqual(['cli.js', 'session', 'run', '--task', 'a "quoted" task']);
    expect(calls[0].options).toMatchObject({ shell: false, windowsHide: true, detached: true, cwd: '/p' });
  });

  it('does not use detached on Windows, where survival is verified separately', () => {
    const { spawn, child, calls } = fakeSpawn();
    runLong(launch, [], { cwd: 'C:\\p', platform: 'win32', spawn });
    child.emit('close', 0);
    expect(calls[0].options).toMatchObject({ detached: false, windowsHide: true });
  });

  it('streams complete stderr lines, maps the exit code and extracts diagnostic paths', async () => {
    const { spawn, child } = fakeSpawn();
    const lines: string[] = [];
    const handle = runLong(launch, [], { cwd: '/p', spawn, onStderrLine: (line) => lines.push(line) });
    child.stderr.write('[migent] stage plan\nresponse: executions/0001/resp');
    child.stderr.write('onse.md\ntrailing');
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('close', 3);
    const result = await handle.result;
    expect(lines).toEqual(['[migent] stage plan', 'response: executions/0001/response.md', 'trailing']);
    expect(result).toMatchObject({
      kind: 'exited',
      exitCode: 3,
      outcome: 'StageFailed',
      response: 'executions/0001/response.md',
    });
  });

  it('reports a spawn error without fabricating an outcome', async () => {
    const { spawn, child } = fakeSpawn();
    const handle = runLong(launch, [], { cwd: '/p', spawn });
    child.emit('error', new Error('ENOENT'));
    expect(await handle.result).toEqual({ kind: 'spawn-failed', detail: 'ENOENT' });
  });

  it('reports a synchronous spawn throw as spawn-failed', async () => {
    const handle = runLong(launch, [], {
      cwd: '/p',
      spawn: () => {
        throw new Error('EACCES');
      },
    });
    expect(await handle.result).toEqual({ kind: 'spawn-failed', detail: 'EACCES' });
  });
});
