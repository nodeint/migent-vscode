import { ConfigLayer,isValid } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import { configBodyFromForm, type ConfigDraft, type ConfigForm, emptyConfigForm, type RoleDraft } from './config';

describe('config draft against the contract', () => {
  it('serializes an incomplete draft (no schema_version, inline agent without model, empty agent) as before', () => {
    const form: ConfigForm = {
      schemaVersion: null,
      agents: [{ name: 'empty', agent: { extra: {} } }],
      roles: [{ name: 'dev', agent: { mode: 'inline', agent: { effort: 'high', extra: {} } }, extra: { future: 1 } }],
      extra: { top_future: 1 },
    };
    expect(configBodyFromForm(form, 'project')).toEqual({
      top_future: 1,
      agents: { empty: {} },
      roles: { dev: { agent: { effort: 'high' }, future: 1 } },
    });
  });

  it('renders a complete form as a valid ConfigLayer', () => {
    const form: ConfigForm = {
      ...emptyConfigForm(),
      agents: [{ name: 'fast', agent: { model: 'm', client: { type: 'codex', options: [{ key: 'a', value: 'b' }], extra: {} }, extra: {} } }],
      roles: [
        { name: 'dev', description: 'd', responsibilities: ['x'], agent: { mode: 'named', name: 'fast' }, extra: {} },
        { name: 'qa', agent: { mode: 'inline', agent: { model: 'm', extra: {} } }, extra: {} },
      ],
    };
    expect(isValid(ConfigLayer, configBodyFromForm(form, 'project'))).toBe(true);
  });

  it('rejects a modeled key with a value outside the contract type', () => {
    // @ts-expect-error schema_version is a number in the contract
    const version: ConfigDraft = { schema_version: '7' };
    // @ts-expect-error responsibilities are strings in the contract
    const role: RoleDraft = { responsibilities: [1] };
    expect([version, role]).toHaveLength(2);
  });
});
