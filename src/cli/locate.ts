import * as fs from 'node:fs';
import * as path from 'node:path';

/** How to start the CLI without a shell: `command` with `[...prefixArgs, ...args]`. */
export interface LaunchSpec {
  command: string;
  prefixArgs: string[];
  via: 'native' | 'node-script';
}

export type UnsupportedReason = 'script-shim' | 'unknown-type' | 'not-executable' | 'node-missing';

export type LocateResult =
  | { kind: 'ok'; launch: LaunchSpec; resolvedPath: string }
  | { kind: 'missing'; configured: string }
  | { kind: 'unsupported'; reason: UnsupportedReason; resolvedPath: string; detail: string };

/** File-system probes, injected so resolution is a pure function on every platform. */
export interface LocateProbes {
  isFile: (file: string) => boolean;
  isExecutable: (file: string) => boolean;
}

export interface LocateOptions {
  configured: string;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Base for a workspace-relative `configured` path. */
  workspaceRoot: string;
  probes: LocateProbes;
}

const SCRIPT_SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);
const JS_ENTRY_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

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
  if (extensions.length === 0) return [name];
  const lower = name.toLowerCase();
  const hasKnownExtension = extensions.some((extension) => lower.endsWith(extension));
  const variants = extensions.map((extension) => name + extension);
  return hasKnownExtension ? [name, ...variants] : variants;
}

/** On PATH a POSIX file must be executable (like a shell lookup); an explicit path is reported either way. */
function isUsable(options: LocateOptions, file: string, isOnPath: boolean): boolean {
  if (!options.probes.isFile(file)) return false;
  return !isOnPath || options.platform === 'win32' || options.probes.isExecutable(file);
}

function resolveBareName(options: LocateOptions, name: string): string | null {
  const api = pathApi(options.platform);
  const directories = envValue(options, 'PATH')
    .split(api.delimiter)
    .filter((directory) => directory.length > 0);
  for (const directory of directories) {
    for (const candidate of candidates(options, name)) {
      const file = api.join(directory, candidate);
      if (isUsable(options, file, true)) return file;
    }
  }
  return null;
}

function resolveExplicitPath(options: LocateOptions, configured: string): string | null {
  const api = pathApi(options.platform);
  const base = api.isAbsolute(configured) ? configured : api.resolve(options.workspaceRoot, configured);
  // An explicit path is used exactly as given: no PATHEXT variant is tried.
  return isUsable(options, base, false) ? base : null;
}

function isBareName(configured: string): boolean {
  return !configured.includes('/') && !configured.includes('\\');
}

function classify(options: LocateOptions, resolvedPath: string, isBare: boolean): LocateResult {
  const api = pathApi(options.platform);
  const extension = api.extname(resolvedPath).toLowerCase();
  const instruction = 'Set migent.cli.path to migent.exe or to the CLI JavaScript entry.';
  if (SCRIPT_SHIM_EXTENSIONS.has(extension)) {
    const shimHint = isBare ? ' A bare "migent" resolved to an npm shim (a script wrapper), which is not launched.' : '';
    return {
      kind: 'unsupported',
      reason: 'script-shim',
      resolvedPath,
      detail: `${resolvedPath} is a ${extension} launcher, which the extension does not run.${shimHint} ${instruction}`,
    };
  }
  if (JS_ENTRY_EXTENSIONS.has(extension)) {
    const node = resolveBareName(options, 'node');
    if (node === null) {
      return {
        kind: 'unsupported',
        reason: 'node-missing',
        resolvedPath,
        detail: `${resolvedPath} is a JavaScript entry but "node" was not found on PATH.`,
      };
    }
    return { kind: 'ok', resolvedPath, launch: { command: node, prefixArgs: [resolvedPath], via: 'node-script' } };
  }
  if (options.platform === 'win32') {
    if (extension === '.exe') return { kind: 'ok', resolvedPath, launch: { command: resolvedPath, prefixArgs: [], via: 'native' } };
    return {
      kind: 'unsupported',
      reason: 'unknown-type',
      resolvedPath,
      detail: `${resolvedPath} is not a native executable (.exe) or a JavaScript entry. ${instruction}`,
    };
  }
  if (!options.probes.isExecutable(resolvedPath)) {
    return {
      kind: 'unsupported',
      reason: 'not-executable',
      resolvedPath,
      detail: `${resolvedPath} is not executable. ${instruction}`,
    };
  }
  return { kind: 'ok', resolvedPath, launch: { command: resolvedPath, prefixArgs: [], via: 'native' } };
}

/** Resolve `migent.cli.path` to a shell-free launch spec. Nothing is spawned here. */
export function locateCli(options: LocateOptions): LocateResult {
  const configured = options.configured.trim();
  if (configured.length === 0) return { kind: 'missing', configured };
  const isBare = isBareName(configured);
  const resolved = isBare ? resolveBareName(options, configured) : resolveExplicitPath(options, configured);
  if (resolved === null) return { kind: 'missing', configured };
  return classify(options, resolved, isBare);
}
