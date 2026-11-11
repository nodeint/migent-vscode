import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  configBodyFromForm,
  configDraftFromForm,
  configFormFromBody,
  configFormFromClient,
  duplicateNameProblem,
  effectiveAgentNames,
  readConfigTab,
} from './config';

const SOURCE = {
  schema_version: 7,
  top_future: { a: 1 },
  agents: {
    fast: { model: 'm', effort: '', future: 1, client: { type: 'codex', options: {}, more: 'x' } },
  },
  roles: {
    dev: {
      description: '',
      responsibilities: [],
      agent: 'fast',
      role_future: [1],
    },
    rev: { agent: { model: 'm2', inline_future: true, client: { type: 'claude-code', extra_c: 1 } } },
  },
};

function roundTrip(body: Record<string, unknown>, scope: 'project' | 'local' = 'project'): unknown {
  return configBodyFromForm(configFormFromClient(JSON.parse(JSON.stringify(configFormFromBody(body)))), scope);
}

describe('config form', () => {
  it('round-trips unknown keys and empty present values at every rebuilt mapping', () => {
    expect(roundTrip(SOURCE)).toEqual(SOURCE);
  });

  it('keeps unknown keys after editing a known sibling, and drops the old inline extra when the mode changes', () => {
    const form = configFormFromBody(SOURCE);
    form.roles[0].description = 'changed';
    form.roles[1].agent = { mode: 'named', name: 'fast' };
    const body = configBodyFromForm(form, 'project') as { roles: Record<string, Record<string, unknown>> };
    expect(body.roles.dev).toEqual({ ...SOURCE.roles.dev, description: 'changed' });
    expect(body.roles.rev).toEqual({ agent: 'fast' });
  });

  it('writes an absent field as absent on the local overlay and omits entries with nothing present', () => {
    const local = { schema_version: 7, agents: { fast: { effort: 'high' } }, roles: { dev: { responsibilities: [] } } };
    expect(roundTrip(local, 'local')).toEqual(local);
    const form = configFormFromBody(local);
    form.agents.push({ name: 'idle', agent: { extra: {} } });
    form.roles.push({ name: 'idle', agent: { mode: 'absent' }, extra: {} });
    expect(configBodyFromForm(form, 'local')).toEqual(local);
  });

  it('serializes to YAML the CLI can read back', () => {
    expect(parse(configDraftFromForm(configFormFromBody(SOURCE), 'project'))).toEqual(SOURCE);
  });

  it('refuses a repeated or empty name before serializing', () => {
    const form = configFormFromBody(SOURCE);
    form.agents.push({ name: 'fast', agent: { extra: {} } });
    expect(duplicateNameProblem(form)).toMatch(/"fast"/);
    expect(duplicateNameProblem(configFormFromBody(SOURCE))).toBeNull();
  });

  it('words each name problem for agents and roles', () => {
    const agents = configFormFromBody(SOURCE);
    agents.agents.push({ name: '', agent: { extra: {} } });
    expect(duplicateNameProblem(agents)).toBe('Every agent needs a name.');
    const repeatedAgent = configFormFromBody(SOURCE);
    repeatedAgent.agents.push({ name: 'fast', agent: { extra: {} } });
    expect(duplicateNameProblem(repeatedAgent)).toBe('The agent name "fast" is used more than once.');
    const roles = configFormFromBody(SOURCE);
    roles.roles.push({ name: '', agent: { mode: 'absent' }, extra: {} });
    expect(duplicateNameProblem(roles)).toBe('Every role needs a name.');
    const repeatedRole = configFormFromBody(SOURCE);
    repeatedRole.roles.push({ name: 'dup', agent: { mode: 'absent' }, extra: {} });
    repeatedRole.roles.push({ name: 'dup', agent: { mode: 'absent' }, extra: {} });
    expect(duplicateNameProblem(repeatedRole)).toBe('The role name "dup" is used more than once.');
  });

  it('lists the agent names of both files once', () => {
    const a = configFormFromBody({ agents: { x: {}, y: {} } });
    const b = configFormFromBody({ agents: { y: {}, z: {} } });
    expect(effectiveAgentNames(a, b)).toEqual(['x', 'y', 'z']);
  });
});

describe('readConfigTab', () => {
  function project(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'config-'));
    mkdirSync(path.join(root, '.migent'));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, '.migent', name), text);
    return root;
  }

  it('reports a missing local file as an empty schema 7 draft that a save can create', () => {
    const tab = readConfigTab(project({ 'config.yaml': 'schema_version: 7\n' }), 'local');
    expect(tab).toMatchObject({ state: 'missing', exists: false, canSave: true, schemaVersion: 7 });
    expect(tab.form).toEqual({ schemaVersion: 7, agents: [], roles: [], extra: {} });
  });

  it('reads an existing file with its hash, and refuses other schema versions and bad YAML', () => {
    const root = project({ 'config.yaml': 'schema_version: 7\nagents: {a: {model: m}}\n', 'config.local.yaml': 'schema_version: 5\n' });
    expect(readConfigTab(root, 'project')).toMatchObject({ state: 'ok', exists: true, canSave: true });
    expect(readConfigTab(root, 'project').hash).toMatch(/^[0-9a-f]{64}$/);
    expect(readConfigTab(root, 'local')).toMatchObject({ state: 'unsupported', canSave: false });
    expect(readConfigTab(project({ 'config.yaml': 'a: [' }), 'project')).toMatchObject({ state: 'invalid', canSave: false });
  });
});
