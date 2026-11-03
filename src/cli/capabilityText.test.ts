import { describe, expect, it } from 'vitest';

import { describeCapability } from './capabilityText';
import type { CapabilityState } from './version';

const base: CapabilityState = { kind: 'ok', configured: 'migent', required: '0.3.1' };

describe('describeCapability', () => {
  it('has no diagnostic while checking or ok', () => {
    expect(describeCapability({ ...base, kind: 'checking' })).toBeNull();
    expect(describeCapability(base)).toBeNull();
  });

  it('shows detected and required versions and the path for an old CLI', () => {
    const result = describeCapability({ ...base, kind: 'old', detected: '0.2.0', resolvedPath: '/bin/migent' });
    expect(result?.label).toBe('Migent CLI 0.2.0 is older than 0.3.1');
    expect(result?.tooltip).toContain('Detected version: 0.2.0');
    expect(result?.tooltip).toContain('Required version: 0.3.1');
    expect(result?.tooltip).toContain('Executable: /bin/migent');
  });

  it.each(['missing', 'unparsable', 'error'] as const)('has a diagnostic for %s', (kind) => {
    expect(describeCapability({ ...base, kind })?.label).toBeTruthy();
  });
});
