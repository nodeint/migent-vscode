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
