import { AGENT_CORE_PROPERTIES, ConfigLayer, extensionKeys, InlineAgent, PLUGIN_EXTENSIONS, STAGE_CORE_PROPERTIES, WorkflowStage } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import { AGENT_MODELED_KEYS } from './agentForm';
import { ROOT_PASSTHROUGH_KEYS } from './config';

// Contracts 0.10.1 lose plugin-claimed keys from their static types, so the lists that mirror them are pinned here.
describe('contract keys the types no longer carry', () => {
  it('agent keys are the core keys plus the plugin-claimed ones', () => {
    const contract = Object.keys(InlineAgent.properties).sort();
    expect(contract).toEqual([...AGENT_MODELED_KEYS, ...extensionKeys(PLUGIN_EXTENSIONS, 'agent')].sort());
    expect([...AGENT_MODELED_KEYS].sort()).toEqual(Object.keys(AGENT_CORE_PROPERTIES).sort());
  });

  it('config root keys are the modeled ones plus the passthrough ones', () => {
    expect(Object.keys(ConfigLayer.properties).sort()).toEqual(
      ['schema_version', 'agents', 'roles', ...ROOT_PASSTHROUGH_KEYS].sort(),
    );
  });

  it('stage keys are the core keys plus the plugin-claimed ones', () => {
    expect(Object.keys(WorkflowStage.properties).sort()).toEqual(
      [...Object.keys(STAGE_CORE_PROPERTIES), ...extensionKeys(PLUGIN_EXTENSIONS, 'stage')].sort(),
    );
  });
});
