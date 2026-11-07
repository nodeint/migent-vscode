import { describe, expect, it } from 'vitest';

import { describeCapability, describeInstallOutcome } from './capabilityText';
import type { CapabilityState } from './version';

const base: CapabilityState = { kind: 'ok', required: '0.4.1' };

describe('describeCapability', () => {
  it('has no diagnostic while checking or ok', () => {
    expect(describeCapability({ ...base, kind: 'checking' })).toBeNull();
    expect(describeCapability(base)).toBeNull();
  });

  it('shows detected and required versions and the path for an old CLI', () => {
    const result = describeCapability({ ...base, kind: 'old', detected: '0.2.0', resolvedPath: '/bin/migent' });
    expect(result?.label).toBe('Migent CLI 0.2.0 is older than 0.4.1');
    expect(result?.tooltip).toContain('Detected version: 0.2.0');
    expect(result?.tooltip).toContain('Required version: 0.4.1');
    expect(result?.tooltip).toContain('Executable: /bin/migent');
  });

  it.each(['missing', 'unparsable', 'error'] as const)('has a diagnostic for %s', (kind) => {
    expect(describeCapability({ ...base, kind })?.label).toBeTruthy();
  });
});

describe('describeInstallOutcome', () => {
  it('is ready once the CLI is usable', () => {
    expect(describeInstallOutcome({ ...base, detected: '0.4.1' }, 0)).toEqual({ kind: 'ready', message: 'Migent CLI 0.4.1 is ready.' });
  });

  it('reports a failure for a non-zero exit', () => {
    expect(describeInstallOutcome({ ...base, kind: 'missing' }, 1).kind).toBe('failed');
  });

  it.each([0, undefined])('hints at a restart when the CLI is still unusable after exit %s', (code) => {
    expect(describeInstallOutcome({ ...base, kind: 'old' }, code).kind).toBe('restart');
  });
});
