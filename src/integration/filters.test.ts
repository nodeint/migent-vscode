import { describe, expect, it } from 'vitest';

import { isEmptySelection, isProbeSelected, normalizeFilter, shouldRunProbe, shouldRunSuites } from './filters';

const filters = (file?: string, caseName?: string) => ({ file: normalizeFilter(file), case: caseName });

describe('integration filters', () => {
  it('selects the probe for every spelling of its file name, with or without --case', () => {
    for (const file of ['watcherProbe', 'watcherprobe', 'watcherProbe.integration.test.ts', 'probe']) {
      expect(isProbeSelected(filters(file))).toBe(true);
      expect(isProbeSelected(filters(file, 'P1'))).toBe(true);
    }
  });

  it('does not select the probe for other files or a bare --case', () => {
    expect(isProbeSelected(filters('reply'))).toBe(false);
    expect(isProbeSelected(filters(undefined, 'empty reply'))).toBe(false);
    expect(isProbeSelected(filters())).toBe(true);
  });

  it('runs the probe only outside the polling pass, and suites only outside the real pass', () => {
    expect(shouldRunProbe(filters(), 'poll')).toBe(false);
    expect(shouldRunProbe(filters(), 'real')).toBe(true);
    expect(shouldRunSuites('real')).toBe(false);
    expect(shouldRunSuites('poll')).toBe(true);
  });

  it('fails an empty selection in the polling pass, never in the real pass or when the probe is selected', () => {
    expect(isEmptySelection(filters('nomatch'), 'poll', 0)).toBe(true);
    expect(isEmptySelection(filters('nomatch'), 'real', 0)).toBe(false);
    expect(isEmptySelection(filters('watcherProbe.integration.test.ts', 'P1'), 'poll', 0)).toBe(false);
    expect(isEmptySelection(filters('reply'), 'poll', 3)).toBe(false);
    expect(isEmptySelection(filters(), 'poll', 0)).toBe(false);
  });
});
