import { describe, expect, it } from 'vitest';

import { agentBody, type AgentDraft, emptyAgent } from './agentForm';

describe('agent draft against the contract', () => {
  it('accepts an incomplete agent (no model, empty) and preserved unmodeled keys', () => {
    const empty: AgentDraft = {};
    const preserved: AgentDraft = { effort: 'high', client: { type: 'codex', future: 1 }, extra_key: [1] };
    expect(agentBody(emptyAgent())).toEqual(empty);
    expect(preserved.client?.options).toBeUndefined();
  });

  it('rejects a modeled key with a value outside the contract type', () => {
    // @ts-expect-error model is a string in the contract
    const model: AgentDraft = { model: 3 };
    // @ts-expect-error client.options values are string, number or boolean in the contract
    const options: AgentDraft = { client: { options: { key: null } } };
    expect([model, options]).toHaveLength(2);
  });
});
