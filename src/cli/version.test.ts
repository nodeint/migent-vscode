import { describe, expect, it } from 'vitest';

import type { LocateOptions } from './locate';
import {
  compareSemver,
  MINIMUM_CLI_VERSION,
  parseSemver,
  probeCapability,
  type RunVersion,
  type VersionOutput,
} from './version';

function parse(text: string) {
  const parsed = parseSemver(text);
  if (parsed === null) throw new Error(`not a version: ${text}`);
  return parsed;
}

describe('parseSemver and compareSemver', () => {
  it('takes the first semver token', () => {
    expect(parseSemver('migent 0.3.1 (build 7)')?.text).toBe('0.3.1');
    expect(parseSemver('no version')).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(compareSemver(parse('0.10.0'), parse('0.9.9'))).toBeGreaterThan(0);
    expect(compareSemver(parse('0.3.1'), parse('0.3.1'))).toBe(0);
    expect(compareSemver(parse('0.3.0'), parse('0.3.1'))).toBeLessThan(0);
  });

  it('sorts a prerelease before its release', () => {
    expect(compareSemver(parse('1.0.0-rc.1'), parse('1.0.0'))).toBeLessThan(0);
    expect(compareSemver(parse('1.0.0-rc.2'), parse('1.0.0-rc.10'))).toBeLessThan(0);
  });
});

describe('probeCapability', () => {
  const locate = (): LocateOptions => ({
    platform: 'linux',
    env: { PATH: '/bin' },
    probes: { isFile: (file) => file === '/bin/migent', isExecutable: () => true, readText: () => null },
  });
  const outputting =
    (output: VersionOutput): RunVersion =>
    () =>
      Promise.resolve(output);

  it('is ok when the detected version meets the minimum', async () => {
    const state = await probeCapability({
      locate: locate(),
      run: outputting({ kind: 'output', stdout: '0.5.4\n' }),
    });
    expect(state).toMatchObject({ kind: 'ok', detected: '0.5.4', required: '0.5.4', resolvedPath: '/bin/migent' });
  });

  it('is old just below the built-in minimum', async () => {
    const state = await probeCapability({
      locate: locate(),
      run: outputting({ kind: 'output', stdout: '0.4.9' }),
    });
    expect(state).toMatchObject({ kind: 'old', detected: '0.4.9', required: MINIMUM_CLI_VERSION });
  });

  it('is old when below the effective minimum, even if above the constant', async () => {
    const state = await probeCapability({
      locate: locate(),
      required: '0.6.0',
      run: outputting({ kind: 'output', stdout: '0.5.5' }),
    });
    expect(state).toMatchObject({ kind: 'old', detected: '0.5.5', required: '0.6.0' });
  });

  it('is old against the built-in minimum when no minimum is injected', async () => {
    const state = await probeCapability({
      locate: locate(),
      run: outputting({ kind: 'output', stdout: '0.2.0' }),
    });
    expect(state).toMatchObject({ kind: 'old', detected: '0.2.0', required: MINIMUM_CLI_VERSION });
  });

  it('is unparsable when --version prints no version', async () => {
    const state = await probeCapability({
      locate: locate(),
      run: outputting({ kind: 'output', stdout: 'hello' }),
    });
    expect(state.kind).toBe('unparsable');
  });

  it('is error when --version fails', async () => {
    const state = await probeCapability({
      locate: locate(),
      run: outputting({ kind: 'failed', detail: 'timed out' }),
    });
    expect(state.kind).toBe('error');
    expect(state.detail).toContain('timed out');
  });

  it('is missing and runs nothing when the CLI is not found', async () => {
    let calls = 0;
    const state = await probeCapability({
      locate: { ...locate(), env: { PATH: '/empty' } },
      run: () => {
        calls += 1;
        return Promise.resolve({ kind: 'output', stdout: '' });
      },
    });
    expect(state.kind).toBe('missing');
    expect(calls).toBe(0);
  });

  it('shares one probe between callers with the same executable', async () => {
    let calls = 0;
    const cache = new Map<string, Promise<VersionOutput>>();
    const run: RunVersion = () => {
      calls += 1;
      return Promise.resolve({ kind: 'output', stdout: '0.5.4' });
    };
    await probeCapability({ locate: locate(), run, cache });
    await probeCapability({ locate: locate(), run, cache });
    expect(calls).toBe(1);
  });
});
