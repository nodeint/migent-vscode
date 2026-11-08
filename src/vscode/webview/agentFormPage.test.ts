import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const media = path.join(__dirname, '../../../media');

interface AgentForm {
  EFFORT_SUGGESTIONS: string[];
  clientChoices: (model: unknown) => unknown[];
  optionKeySuggestions: (model: unknown, client: string) => string[];
  isKnownModel: (model: unknown, client: string, name: string) => boolean;
  agentModelLabel: (agent: { clientType?: string; model?: string }) => string;
  namedOptions: (names: string[], current: string) => { value: string; label: string }[];
}

function load(): { agents: AgentForm; copy: Record<string, unknown> } {
  const window: Record<string, unknown> = {};
  const context = vm.createContext({ window });
  vm.runInContext(readFileSync(path.join(media, 'shared/copy.js'), 'utf8'), context);
  window.MigentForm = {};
  vm.runInContext(readFileSync(path.join(media, 'shared/agentform.js'), 'utf8'), context);
  return { agents: window.MigentAgentForm as AgentForm, copy: window.MigentCopy as Record<string, unknown> };
}

describe('shared agent form', () => {
  const { agents, copy } = load();
  const model = { clients: [{ id: 'codex', models: ['gpt-5'], optionKeys: ['sandbox'] }] };

  it('labels the model picker with both halves, or names the missing one', () => {
    expect(agents.agentModelLabel({ clientType: 'codex', model: 'gpt-5' })).toBe('codex · gpt-5');
    expect(agents.agentModelLabel({ model: 'gpt-5' })).toBe('gpt-5 (no client)');
    expect(agents.agentModelLabel({ clientType: 'codex' })).toBe('codex (no model)');
    expect(agents.agentModelLabel({})).toBe('');
  });

  it('knows only a model its client lists, and suggests that client\'s option keys', () => {
    expect(agents.isKnownModel(model, 'codex', 'gpt-5')).toBe(true);
    expect(agents.isKnownModel({ clients: [] }, 'codex', 'gpt-5')).toBe(false);
    expect(agents.isKnownModel(model, 'codex', '')).toBe(false);
    expect(agents.optionKeySuggestions(model, 'codex')).toEqual(['sandbox']);
    expect(agents.optionKeySuggestions(model, 'other')).toEqual([]);
  });

  it('keeps an unknown named agent visible and flagged', () => {
    expect(agents.namedOptions(['a'], 'ghost').map((option) => option.value)).toEqual(['', 'a', 'ghost']);
    expect(agents.namedOptions(['a'], 'ghost').at(-1)?.label).toContain('not in config');
    expect(agents.namedOptions([], '')[0].label).toBe((copy.agent as { named: { none: string } }).named.none);
  });
});
