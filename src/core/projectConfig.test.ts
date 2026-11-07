import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readProjectConfig } from './projectConfig';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(configText?: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-cfg-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.migent'));
  if (configText !== undefined) writeFileSync(path.join(root, '.migent', 'config.yaml'), configText);
  return root;
}

describe('readProjectConfig', () => {
  it('is missing when the file is absent, without creating it', () => {
    const root = project();
    expect(readProjectConfig(root)).toEqual({ state: 'missing', error: null, schemaVersion: null, roles: [], agents: [] });
    expect(() => readProjectConfig(root)).not.toThrow();
  });

  it('reads the raw schema version and the role and agent names', () => {
    const config = readProjectConfig(
      project('schema_version: 5\nroles:\n  planner: {}\n  reviewer: {}\nagents:\n  deep_reasoning: {}\n'),
    );
    expect(config.roles).toEqual(['planner', 'reviewer']);
    expect(config.agents).toEqual(['deep_reasoning']);
    expect(readProjectConfig(project('schema_version: 3\nroles: {}\n'))).toEqual({
      state: 'ok',
      error: null,
      schemaVersion: 3,
      roles: [],
      agents: [],
    });
    expect(readProjectConfig(project('roles: {}\n')).schemaVersion).toBeNull();
    expect(readProjectConfig(project('schema_version: "3"\n')).schemaVersion).toBeNull();
  });

  it('is invalid for unparsable YAML and for a non-mapping root', () => {
    const broken = readProjectConfig(project('a: [unclosed\n'));
    expect(broken.state).toBe('invalid');
    expect(broken.error).toBeTruthy();
    expect(readProjectConfig(project('- just\n- a list\n')).state).toBe('invalid');
  });

  it('is unreadable when the path cannot be read as a file', () => {
    const root = project();
    mkdirSync(path.join(root, '.migent', 'config.yaml'));
    expect(readProjectConfig(root).state).toBe('unreadable');
  });
});
