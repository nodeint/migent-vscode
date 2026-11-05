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
    if (state.detected !== undefined) lines.push(`Detected version: ${state.detected}`);
    lines.push(`Required version: ${state.required} or newer`);
  };
  let label: string;
  switch (state.kind) {
    case 'checking':
    case 'ok':
      return null;
    case 'missing':
      label = 'Migent CLI not found';
      lines.push('Install it with "npm install -g @nodeint/migent", then restart VS Code if it was installed just now.');
      versions();
      break;
    case 'unsupported':
      label = 'Migent CLI launcher is not supported';
      versions();
      break;
    case 'old':
      label = `Migent CLI ${state.detected ?? ''} is older than ${state.required}`.replace('  ', ' ');
      versions();
      break;
    case 'unparsable':
      label = 'Migent CLI version not recognized';
      versions();
      break;
    case 'error':
      label = 'Migent CLI could not be run';
      versions();
      break;
  }
  if (state.resolvedPath !== undefined) lines.push(`Executable: ${state.resolvedPath}`);
  if (state.detail !== undefined) lines.push(state.detail);
  lines.push('Sessions on disk stay visible. Use the Recheck action after fixing it.');
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
    return { kind: 'ready', message: `Migent CLI ${state.detected ?? ''} is ready.`.replace('  ', ' ') };
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'failed', message: 'Install failed. See the "Migent: Install CLI" terminal.' };
  }
  return {
    kind: 'restart',
    message:
      'The install finished, but VS Code still cannot use the Migent CLI. Your shell may resolve a different "migent" ' +
      'than VS Code does (PATH, nvm, or another package manager). Restart VS Code, then use Recheck.',
  };
}
