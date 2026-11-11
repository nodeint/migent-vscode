import * as fs from 'node:fs';
import * as path from 'node:path';

import { text } from '../text';

/** How to start the CLI without a shell: `command` with `[...prefixArgs, ...args]`. */
export interface LaunchSpec {
  command: string;
  prefixArgs: string[];
  via: 'native' | 'node-script';
}

export type UnsupportedReason = 'script-shim' | 'unknown-type' | 'node-missing';

export type LocateResult =
  | { kind: 'ok'; launch: LaunchSpec; resolvedPath: string }
  | { kind: 'missing' }
  | { kind: 'unsupported'; reason: UnsupportedReason; resolvedPath: string; detail: string };

/** File-system probes, injected so resolution is a pure function on every platform. */
export interface LocateProbes {
  isFile: (file: string) => boolean;
  isExecutable: (file: string) => boolean;
  /** File text, or null when it cannot be read. */
  readText: (file: string) => string | null;
}

export interface LocateOptions {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  probes: LocateProbes;
}

/** The command name npm installs for the `@nodeint/migent` package (its `bin`). */
export const CLI_COMMAND = 'migent';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const CMD_SHIM_EXTENSIONS = new Set(['.cmd', '.bat']);
/** A quoted JavaScript path in a package-manager `.cmd` shim, such as `"%dp0%\node_modules\...\index.js"`. */
const SHIM_ENTRY_PATTERN = /"([^"\r\n]*\.(?:js|mjs|cjs))"/gi;
/** `%dp0%` (npm) or `%~dp0` (pnpm): the directory of the shim, with a trailing separator. */
const SHIM_DIRECTORY_PATTERN = /%(?:~dp0|dp0%)/i;

export const nodeProbes: LocateProbes = {
  isFile: (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
  isExecutable: (file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  readText: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
};

function pathApi(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function envValue(options: LocateOptions, name: string): string {
  const { env, platform } = options;
  if (platform !== 'win32') return env[name] ?? '';
  // Windows environment variable names are case-insensitive.
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? '' : (env[key] ?? '');
}

function pathExtensions(options: LocateOptions): string[] {
  if (options.platform !== 'win32') return [];
  const raw = envValue(options, 'PATHEXT') || DEFAULT_PATHEXT;
  return raw
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0);
}

/** Candidate file names for `name` in one directory, in lookup order. */
function candidates(options: LocateOptions, name: string): string[] {
  const extensions = pathExtensions(options);
  return extensions.length === 0 ? [name] : extensions.map((extension) => name + extension);
}

/** Like a shell lookup: the first PATH directory holding a file; on POSIX that file must be executable. */
function resolveOnPath(options: LocateOptions, name: string): string | null {
  const api = pathApi(options.platform);
  const directories = envValue(options, 'PATH')
    .split(api.delimiter)
    .filter((directory) => directory.length > 0);
  for (const directory of directories) {
    for (const candidate of candidates(options, name)) {
      const file = api.join(directory, candidate);
      if (!options.probes.isFile(file)) continue;
      if (options.platform === 'win32' || options.probes.isExecutable(file)) return file;
    }
  }
  return null;
}

/**
 * The JavaScript entry a Windows `.cmd` shim runs. npm and pnpm shims quote it relative to the shim's own
 * directory, but the layout differs between global, local and pnpm installs, so the shim is read, not guessed.
 */
function shimEntry(options: LocateOptions, shim: string): string | null {
  const text = options.probes.readText(shim);
  if (text === null) return null;
  const directory = path.win32.dirname(shim);
  for (const match of text.matchAll(SHIM_ENTRY_PATTERN)) {
    const [, quoted] = match;
    if (!SHIM_DIRECTORY_PATTERN.test(quoted)) continue;
    const relative = quoted.replace(SHIM_DIRECTORY_PATTERN, '');
    const entry = path.win32.resolve(directory, relative.replace(/^[\\/]+/, ''));
    if (options.probes.isFile(entry)) return entry;
  }
  return null;
}

/** `node.exe` next to the shim (as the shim itself prefers), otherwise `node` from `PATH`. */
function resolveNode(options: LocateOptions, shimDirectory: string): string | null {
  const beside = pathApi(options.platform).join(shimDirectory, 'node.exe');
  return options.probes.isFile(beside) ? beside : resolveOnPath(options, 'node');
}

function classify(options: LocateOptions, resolvedPath: string): LocateResult {
  const extension = pathApi(options.platform).extname(resolvedPath).toLowerCase();
  if (options.platform !== 'win32') {
    // npm links `migent` to the script (or pnpm writes a `#!/bin/sh` wrapper); both start without a shell.
    return { kind: 'ok', resolvedPath, launch: { command: resolvedPath, prefixArgs: [], via: 'native' } };
  }
  if (extension === '.exe') return { kind: 'ok', resolvedPath, launch: { command: resolvedPath, prefixArgs: [], via: 'native' } };
  if (!CMD_SHIM_EXTENSIONS.has(extension)) {
    return {
      kind: 'unsupported',
      reason: 'unknown-type',
      resolvedPath,
      detail: text('states.cliUnknownType', { path: resolvedPath }),
    };
  }
  const entry = shimEntry(options, resolvedPath);
  if (entry === null) {
    return {
      kind: 'unsupported',
      reason: 'script-shim',
      resolvedPath,
      detail: text('states.cliShimEntryMissing', { path: resolvedPath, extension }),
    };
  }
  const node = resolveNode(options, path.win32.dirname(resolvedPath));
  if (node === null) {
    return {
      kind: 'unsupported',
      reason: 'node-missing',
      resolvedPath: entry,
      detail: text('states.cliNodeMissing', { entry }),
    };
  }
  return { kind: 'ok', resolvedPath: entry, launch: { command: node, prefixArgs: [entry], via: 'node-script' } };
}

/** Find the Migent CLI on `PATH` and resolve it to a shell-free launch spec. Nothing is spawned here. */
export function locateCli(options: LocateOptions): LocateResult {
  const resolved = resolveOnPath(options, CLI_COMMAND);
  return resolved === null ? { kind: 'missing' } : classify(options, resolved);
}
