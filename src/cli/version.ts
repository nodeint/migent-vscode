import { execFile } from 'node:child_process';

import { CLI_COMMAND, type LaunchSpec, locateCli, type LocateOptions } from './locate';

/**
 * Oldest CLI the readers are written for (captured samples are 0.3.1). It belongs to the extension
 * release, not to user settings: bump it in the release that needs a newer CLI.
 */
export const MINIMUM_CLI_VERSION = '0.3.1';

export const VERSION_CHECK_TIMEOUT_MS = 5000;

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  text: string;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?/;

/** First semver token in `text`, or null. */
export function parseSemver(text: string): Semver | null {
  const match = SEMVER_PATTERN.exec(text);
  if (match === null) return null;
  const [token, major, minor, patch] = match;
  const dash = token.indexOf('-');
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: dash === -1 ? [] : token.slice(dash + 1).split('.'),
    text: token,
  };
}

function compareIdentifier(left: string, right: string): number {
  const isLeftNumeric = /^\d+$/.test(left);
  const isRightNumeric = /^\d+$/.test(right);
  if (isLeftNumeric && isRightNumeric) return Math.sign(Number(left) - Number(right));
  if (isLeftNumeric) return -1;
  if (isRightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Negative when `left` is older than `right`. A prerelease sorts before its release. */
export function compareSemver(left: Semver, right: Semver): number {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return Math.sign(core);
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  // The shorter identifier list is the lower version.
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

export type CapabilityKind = 'checking' | 'ok' | 'missing' | 'unsupported' | 'old' | 'unparsable' | 'error';

export interface CapabilityState {
  kind: CapabilityKind;
  launch?: LaunchSpec;
  resolvedPath?: string;
  detected?: string;
  required: string;
  detail?: string;
  /** Reserved for phase 3 probes (for example `session cancel`). */
  features?: Record<string, boolean>;
}

export type VersionOutput = { kind: 'output'; stdout: string } | { kind: 'failed'; detail: string };

/** Runs `launch` with `args` and returns its stdout. Injected so the check is testable. */
export type RunVersion = (launch: LaunchSpec, args: string[], timeoutMs: number) => Promise<VersionOutput>;

export const runWithExecFile: RunVersion = (launch, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      launch.command,
      [...launch.prefixArgs, ...args],
      { timeout: timeoutMs, windowsHide: true, shell: false, encoding: 'utf8' },
      (error, stdout) => {
        if (error === null) resolve({ kind: 'output', stdout });
        else resolve({ kind: 'failed', detail: error.message });
      },
    );
  });

export interface CapabilityInput {
  locate: LocateOptions;
  /** Defaults to `MINIMUM_CLI_VERSION`; tests inject another value. */
  required?: string;
  run?: RunVersion;
  /** Shares one probe between projects that resolve to the same executable. */
  cache?: Map<string, Promise<VersionOutput>>;
}

function launchKey(launch: LaunchSpec): string {
  return JSON.stringify([launch.command, ...launch.prefixArgs]);
}

const OUTPUT_EXCERPT_LENGTH = 120;

/** Runs `--version` once per executable (when a cache is given) and compares it with `required`. */
async function versionState(
  base: Pick<CapabilityState, 'required' | 'resolvedPath'> & { launch: LaunchSpec },
  input: CapabilityInput,
): Promise<CapabilityState> {
  const run = input.run ?? runWithExecFile;
  const key = launchKey(base.launch);
  let pending = input.cache?.get(key);
  if (pending === undefined) {
    pending = run(base.launch, ['--version'], VERSION_CHECK_TIMEOUT_MS);
    input.cache?.set(key, pending);
  }
  const output = await pending;
  if (output.kind === 'failed') {
    return { ...base, kind: 'error', detail: `"--version" failed: ${output.detail}` };
  }
  const detected = parseSemver(output.stdout);
  const minimum = parseSemver(base.required);
  if (detected === null || minimum === null) {
    const excerpt = output.stdout.trim().slice(0, OUTPUT_EXCERPT_LENGTH);
    return { ...base, kind: 'unparsable', detail: `No version found in: ${excerpt}` };
  }
  const kind = compareSemver(detected, minimum) < 0 ? 'old' : 'ok';
  return { ...base, kind, detected: detected.text };
}

/** Locate the CLI, run `--version` and compare with the required minimum. Never throws. */
export async function probeCapability(input: CapabilityInput): Promise<CapabilityState> {
  const required = input.required ?? MINIMUM_CLI_VERSION;
  const located = locateCli(input.locate);
  if (located.kind === 'missing') {
    return { kind: 'missing', required, detail: `"${CLI_COMMAND}" was not found on PATH.` };
  }
  if (located.kind === 'unsupported') {
    return { kind: 'unsupported', required, resolvedPath: located.resolvedPath, detail: located.detail };
  }
  const base = { required, launch: located.launch, resolvedPath: located.resolvedPath };
  return versionState(base, input);
}
