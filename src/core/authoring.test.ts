import { describe, expect, it } from 'vitest';

import { parseAuthoringEnvelope } from './authoring';

describe('parseAuthoringEnvelope', () => {
  it('keeps the source layer and draft flag of each diagnostic', () => {
    const result = parseAuthoringEnvelope({
      schema_version: 1,
      valid: false,
      diagnostics: [
        { severity: 'error', code: 'c', message: 'm', path: ['roles', 'dev', 'agent'], source: 'project', draft: false },
        { severity: 'warning', code: 'w', message: 'x' },
        { message: '' },
      ],
      written: true,
      hash: 'h',
    });
    expect(result?.diagnostics).toEqual([
      { severity: 'error', code: 'c', message: 'm', path: 'roles.dev.agent', source: 'project', draft: false },
      { severity: 'warning', code: 'w', message: 'x', path: '' },
    ]);
    expect(result?.written).toBe(true);
  });

  it('refuses output that is not an envelope', () => {
    expect(parseAuthoringEnvelope({ schema_version: 1, valid: true })).toBeNull();
    expect(parseAuthoringEnvelope(null)).toBeNull();
  });

  it('refuses a missing or unsupported envelope version, even when it claims to be written', () => {
    const body = { valid: true, diagnostics: [], written: true, hash: 'h' };
    expect(parseAuthoringEnvelope(body)).toBeNull();
    expect(parseAuthoringEnvelope({ ...body, schema_version: 2 })).toBeNull();
    expect(parseAuthoringEnvelope({ ...body, schema_version: '1' })).toBeNull();
    expect(parseAuthoringEnvelope({ ...body, schema_version: 1 })?.written).toBe(true);
  });
});
