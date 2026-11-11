import { text } from '../text';
import type { CapabilityState } from './version';

export interface CapabilityDiagnostic {
  label: string;
  /** Multi-line detail: versions, executable path, how to fix. */
  tooltip: string;
}

/** The diagnostic shown for an unusable CLI; null while checking or when the CLI is usable. */
export function describeCapability(state: CapabilityState): CapabilityDiagnostic | null {
  const lines: string[] = [];
  const versions = (): void => {
    if (state.detected !== undefined) lines.push(text('states.cliDetected', { version: state.detected }));
    lines.push(text('states.cliRequired', { version: state.required }));
  };
  let label: string;
  switch (state.kind) {
    case 'checking':
    case 'ok':
      return null;
    case 'missing':
      label = text('states.cliMissing');
      lines.push(text('states.cliInstallHint'));
      versions();
      break;
    case 'unsupported':
      label = text('states.cliUnsupported');
      versions();
      break;
    case 'old':
      label =
        state.detected === undefined
          ? text('states.cliOldUnknown', { required: state.required })
          : text('states.cliOld', { detected: state.detected, required: state.required });
      versions();
      break;
    case 'unparsable':
      label = text('states.cliUnparsable');
      versions();
      break;
    case 'error':
      label = text('states.cliError');
      versions();
      break;
  }
  if (state.resolvedPath !== undefined) lines.push(text('states.cliExecutable', { path: state.resolvedPath }));
  if (state.detail !== undefined) lines.push(state.detail);
  lines.push(text('states.cliSessionsVisible'));
  return { label, tooltip: lines.join('\n') };
}

/** Fixed text sent to the user's terminal to install or update the CLI. It never contains user input. */
export const INSTALL_CLI_COMMAND = 'npm install -g @nodeint/migent@latest';

export type InstallOutcome =
  | { kind: 'ready'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'restart'; message: string };

/**
 * What to tell the user after the install command ended. `exitCode` is undefined when the terminal could not
 * report it. A non-zero exit is a failure; a zero or unknown exit that still leaves the CLI unusable usually means
 * the shell and VS Code resolve a different `migent` (PATH, nvm, another package manager).
 */
export function describeInstallOutcome(state: CapabilityState, exitCode: number | undefined): InstallOutcome {
  if (state.kind === 'ok') {
    return { kind: 'ready', message: state.detected === undefined ? text('states.cliReadyUnknown') : text('states.cliReady', { detected: state.detected }) };
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'failed', message: text('states.cliInstallFailed') };
  }
  return {
    kind: 'restart',
    message: text('states.cliRestart'),
  };
}
