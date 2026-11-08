import { describe, expect, it } from 'vitest';

import { parseConfigMessage } from './configIntent';

const HASH = 'a'.repeat(64);

describe('parseConfigMessage', () => {
  it('accepts a closed set that names a tab and never a path', () => {
    expect(parseConfigMessage({ type: 'selectTab', tab: 'local' })).toEqual({ type: 'selectTab', tab: 'local' });
    expect(parseConfigMessage({ type: 'openFile', tab: 'project', path: '/etc/passwd' })).toEqual({ type: 'openFile', tab: 'project' });
    expect(parseConfigMessage({ type: 'openFile', tab: '../x' })).toBeNull();
    expect(parseConfigMessage({ type: 'run', tab: 'project' })).toBeNull();
  });

  it('requires a valid save intent', () => {
    const form = { agents: [] };
    expect(parseConfigMessage({ type: 'saveForm', tab: 'local', form, base: { kind: 'create' } })).toEqual({
      type: 'saveForm', tab: 'local', form, base: { kind: 'create' },
    });
    expect(parseConfigMessage({ type: 'saveForm', tab: 'local', form, base: { kind: 'replace', hash: HASH } })).not.toBeNull();
    for (const base of [undefined, {}, { kind: 'replace' }, { kind: 'replace', hash: 'abc' }, { kind: 'other' }]) {
      expect(parseConfigMessage({ type: 'saveForm', tab: 'local', form, base })).toBeNull();
    }
    expect(parseConfigMessage({ type: 'saveForm', tab: 'local', form: [], base: { kind: 'create' } })).toBeNull();
  });
});
