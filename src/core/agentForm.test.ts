import { describe, expect, it } from 'vitest';

import { agentBody, agentFromClient, parseAgent } from './agentForm';

describe('agent codec', () => {
  it('round-trips unknown keys at the agent and its client, edited or not', () => {
    const source = { model: 'm', future: { a: 1 }, client: { type: 'codex', options: { sandbox: 'ro' }, extra_key: true } };
    const agent = parseAgent(source);
    expect(agentBody(agent)).toEqual(source);
    agent.model = 'n';
    expect(agentBody(agent)).toEqual({ ...source, model: 'n' });
  });

  it('keeps an empty present value present and an absent one absent', () => {
    expect(agentBody(parseAgent({ effort: '', client: { options: {} } }))).toEqual({ effort: '', client: { options: {} } });
    expect(agentBody(parseAgent({ model: 'm' }))).toEqual({ model: 'm' });
  });

  it('never lets a stale extra key shadow a modeled field', () => {
    const agent = agentFromClient({ model: 'a', extra: { model: 'stale', other: 1 }, client: { type: 'x', extra: { type: 'old' } } });
    expect(agentBody(agent)).toEqual({ model: 'a', other: 1, client: { type: 'x' } });
  });
});
