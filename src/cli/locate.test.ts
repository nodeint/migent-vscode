import { describe, expect, it } from 'vitest';

import { locateCli,type LocateOptions } from './locate';

/** `files` exist; `executable` lists those with the POSIX execute bit (default: all). */
function options(
  configured: string,
  platform: NodeJS.Platform,
  files: string[],
  env: Record<string, string>,
  executable: string[] = files,
): LocateOptions {
  return {
    configured,
    platform,
    env,
    workspaceRoot: platform === 'win32' ? 'C:\\work' : '/work',
    probes: { isFile: (file) => files.includes(file), isExecutable: (file) => executable.includes(file) },
  };
}

const WIN_ENV = { Path: 'C:\\npm;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };

describe('locateCli on Windows', () => {
  it('resolves a bare name to a native migent.exe through PATHEXT', () => {
    const result = locateCli(options('migent', 'win32', ['C:\\tools\\migent.exe'], WIN_ENV));
    expect(result).toEqual({
      kind: 'ok',
      resolvedPath: 'C:\\tools\\migent.exe',
      launch: { command: 'C:\\tools\\migent.exe', prefixArgs: [], via: 'native' },
    });
  });

  it('prefers the earlier PATHEXT entry within one directory', () => {
    const result = locateCli(options('migent', 'win32', ['C:\\npm\\migent.cmd', 'C:\\npm\\migent.exe'], WIN_ENV));
    expect(result).toMatchObject({ kind: 'ok', resolvedPath: 'C:\\npm\\migent.exe' });
  });

  it('reports an npm shim found by a bare name as unsupported and names that case', () => {
    const result = locateCli(options('migent', 'win32', ['C:\\npm\\migent.cmd'], WIN_ENV));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'script-shim', resolvedPath: 'C:\\npm\\migent.cmd' });
    expect(result.kind === 'unsupported' && result.detail).toContain('npm shim');
  });

  it('reports Windows script targets as unsupported', () => {
    for (const extension of ['.cmd', '.bat', '.ps1']) {
      const file = `C:\\x\\migent${extension}`;
      expect(locateCli(options(file, 'win32', [file], WIN_ENV))).toMatchObject({
        kind: 'unsupported',
        reason: 'script-shim',
      });
    }
  });

  it('runs a JavaScript entry through node found on PATH', () => {
    const files = ['C:\\cli\\migent.js', 'C:\\tools\\node.exe'];
    expect(locateCli(options('C:\\cli\\migent.js', 'win32', files, WIN_ENV))).toEqual({
      kind: 'ok',
      resolvedPath: 'C:\\cli\\migent.js',
      launch: { command: 'C:\\tools\\node.exe', prefixArgs: ['C:\\cli\\migent.js'], via: 'node-script' },
    });
  });

  it('reports a JavaScript entry without node as unsupported', () => {
    const result = locateCli(options('C:\\cli\\migent.mjs', 'win32', ['C:\\cli\\migent.mjs'], WIN_ENV));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'node-missing' });
  });

  it('uses an explicit path as given and never a PATHEXT variant of it', () => {
    const files = ['C:\\cli\\migent.js', 'C:\\cli\\migent.js.exe', 'C:\\tools\\node.exe'];
    expect(locateCli(options('C:\\cli\\migent.js', 'win32', files, WIN_ENV))).toMatchObject({
      kind: 'ok',
      resolvedPath: 'C:\\cli\\migent.js',
      launch: { via: 'node-script' },
    });
    expect(locateCli(options('C:\\cli\\migent', 'win32', ['C:\\cli\\migent.exe'], WIN_ENV))).toEqual({
      kind: 'missing',
      configured: 'C:\\cli\\migent',
    });
  });

  it('resolves a workspace-relative path against the workspace root', () => {
    const result = locateCli(options('bin\\migent.exe', 'win32', ['C:\\work\\bin\\migent.exe'], WIN_ENV));
    expect(result).toMatchObject({ kind: 'ok', resolvedPath: 'C:\\work\\bin\\migent.exe' });
  });

  it('reports an unknown file type as unsupported', () => {
    const result = locateCli(options('C:\\x\\migent.com', 'win32', ['C:\\x\\migent.com'], WIN_ENV));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'unknown-type' });
  });

  it('reports missing when nothing matches or the setting is blank', () => {
    expect(locateCli(options('migent', 'win32', [], WIN_ENV))).toEqual({ kind: 'missing', configured: 'migent' });
    expect(locateCli(options('  ', 'win32', [], WIN_ENV))).toEqual({ kind: 'missing', configured: '' });
  });
});

describe('locateCli on POSIX', () => {
  const env = { PATH: '/usr/local/bin:/usr/bin' };

  it('runs an executable found on PATH directly, including an npm symlink to a node script', () => {
    expect(locateCli(options('migent', 'linux', ['/usr/local/bin/migent'], env))).toEqual({
      kind: 'ok',
      resolvedPath: '/usr/local/bin/migent',
      launch: { command: '/usr/local/bin/migent', prefixArgs: [], via: 'native' },
    });
  });

  it('skips a non-executable file on PATH', () => {
    const files = ['/usr/local/bin/migent', '/usr/bin/migent'];
    const result = locateCli(options('migent', 'linux', files, env, ['/usr/bin/migent']));
    expect(result).toMatchObject({ kind: 'ok', resolvedPath: '/usr/bin/migent' });
  });

  it('reports a non-executable explicit path as unsupported', () => {
    const result = locateCli(options('/opt/migent', 'linux', ['/opt/migent'], env, []));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'not-executable' });
  });

  it('runs a JavaScript entry through node', () => {
    const files = ['/opt/cli/migent.cjs', '/usr/bin/node'];
    const result = locateCli(options('/opt/cli/migent.cjs', 'linux', files, env, ['/usr/bin/node']));
    expect(result).toMatchObject({
      kind: 'ok',
      launch: { command: '/usr/bin/node', prefixArgs: ['/opt/cli/migent.cjs'], via: 'node-script' },
    });
  });
});
