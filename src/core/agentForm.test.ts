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

  it('reads number and boolean option values (CLI 0.6.0) as strings and saves them as strings', () => {
    const agent = parseAgent({ client: { type: 'codex', options: { retries: 3, verbose: true, mode: 'fast' } } });
    expect(agent.client?.options).toEqual([
      { key: 'retries', value: '3' },
      { key: 'verbose', value: 'true' },
      { key: 'mode', value: 'fast' },
    ]);
    expect(agentBody(agent)).toEqual({ client: { type: 'codex', options: { retries: '3', verbose: 'true', mode: 'fast' } } });
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
