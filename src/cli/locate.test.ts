import { describe, expect, it } from 'vitest';

import { locateCli, type LocateOptions } from './locate';

/**
 * `files` maps a path to its text (empty for a binary); `executable` lists those with the POSIX execute bit
 * (default: all).
 */
function options(
  platform: NodeJS.Platform,
  files: Record<string, string>,
  env: Record<string, string>,
  executable: string[] = Object.keys(files),
): LocateOptions {
  return {
    platform,
    env,
    probes: {
      isFile: (file) => file in files,
      isExecutable: (file) => executable.includes(file),
      readText: (file) => files[file] ?? null,
    },
  };
}

const WIN_ENV = { Path: 'C:\\npm;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };

const NPM_GLOBAL_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  ')',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@nodeint\\migent\\dist\\index.js" %*',
].join('\r\n');

const PNPM_SHIM = [
  '@SETLOCAL',
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\@nodeint\\migent\\dist\\index.js" %*',
  ') ELSE (',
  '  node  "%~dp0\\..\\@nodeint\\migent\\dist\\index.js" %*',
  ')',
].join('\r\n');

const NPM_ENTRY = 'C:\\npm\\node_modules\\@nodeint\\migent\\dist\\index.js';

describe('locateCli on Windows', () => {
  it('resolves a native migent.exe through PATHEXT', () => {
    const result = locateCli(options('win32', { 'C:\\tools\\migent.exe': '' }, WIN_ENV));
    expect(result).toEqual({
      kind: 'ok',
      resolvedPath: 'C:\\tools\\migent.exe',
      launch: { command: 'C:\\tools\\migent.exe', prefixArgs: [], via: 'native' },
    });
  });

  it('prefers the earlier PATHEXT entry within one directory', () => {
    const files = { 'C:\\npm\\migent.cmd': NPM_GLOBAL_SHIM, 'C:\\npm\\migent.exe': '' };
    expect(locateCli(options('win32', files, WIN_ENV))).toMatchObject({ kind: 'ok', resolvedPath: 'C:\\npm\\migent.exe' });
  });

  it('runs the entry of an npm global shim with the node.exe beside it', () => {
    const files = {
      'C:\\npm\\migent.cmd': NPM_GLOBAL_SHIM,
      [NPM_ENTRY]: '',
      'C:\\npm\\node.exe': '',
      'C:\\tools\\node.exe': '',
    };
    expect(locateCli(options('win32', files, WIN_ENV))).toEqual({
      kind: 'ok',
      resolvedPath: NPM_ENTRY,
      launch: { command: 'C:\\npm\\node.exe', prefixArgs: [NPM_ENTRY], via: 'node-script' },
    });
  });

  it('reads the pnpm shim layout and falls back to node from PATH', () => {
    // The shim lives in C:\npm, so its "..\@nodeint" resolves beside that folder.
    const entry = 'C:\\@nodeint\\migent\\dist\\index.js';
    const files = { 'C:\\npm\\migent.cmd': PNPM_SHIM, [entry]: '', 'C:\\tools\\node.exe': '' };
    expect(locateCli(options('win32', files, WIN_ENV))).toMatchObject({
      kind: 'ok',
      resolvedPath: entry,
      launch: { command: 'C:\\tools\\node.exe', prefixArgs: [entry], via: 'node-script' },
    });
  });

  it('reports a shim without a readable entry as unsupported', () => {
    const files = { 'C:\\npm\\migent.cmd': '@echo off\r\n' };
    expect(locateCli(options('win32', files, WIN_ENV))).toMatchObject({
      kind: 'unsupported',
      reason: 'script-shim',
      resolvedPath: 'C:\\npm\\migent.cmd',
    });
  });

  it('reports a shim whose entry file is gone as unsupported', () => {
    const files = { 'C:\\npm\\migent.cmd': NPM_GLOBAL_SHIM };
    expect(locateCli(options('win32', files, WIN_ENV))).toMatchObject({ kind: 'unsupported', reason: 'script-shim' });
  });

  it('reports an entry without node as unsupported', () => {
    const files = { 'C:\\npm\\migent.cmd': NPM_GLOBAL_SHIM, [NPM_ENTRY]: '' };
    expect(locateCli(options('win32', files, WIN_ENV))).toMatchObject({ kind: 'unsupported', reason: 'node-missing' });
  });

  it('reports an unknown file type as unsupported', () => {
    const env = { ...WIN_ENV, PATHEXT: '.COM' };
    const result = locateCli(options('win32', { 'C:\\npm\\migent.com': '' }, env));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'unknown-type' });
  });

  it('reports missing when nothing is on PATH', () => {
    expect(locateCli(options('win32', {}, WIN_ENV))).toEqual({ kind: 'missing' });
  });
});

describe('locateCli on POSIX', () => {
  const env = { PATH: '/usr/local/bin:/usr/bin' };

  it('runs an executable found on PATH directly, including an npm symlink to a node script', () => {
    expect(locateCli(options('linux', { '/usr/local/bin/migent': '' }, env))).toEqual({
      kind: 'ok',
      resolvedPath: '/usr/local/bin/migent',
      launch: { command: '/usr/local/bin/migent', prefixArgs: [], via: 'native' },
    });
  });

  it('skips a non-executable file on PATH', () => {
    const files = { '/usr/local/bin/migent': '', '/usr/bin/migent': '' };
    const result = locateCli(options('linux', files, env, ['/usr/bin/migent']));
    expect(result).toMatchObject({ kind: 'ok', resolvedPath: '/usr/bin/migent' });
  });

  it('reports missing when only a non-executable file exists', () => {
    expect(locateCli(options('linux', { '/usr/bin/migent': '' }, env, []))).toEqual({ kind: 'missing' });
  });
});
