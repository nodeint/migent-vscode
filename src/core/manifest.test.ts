import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { manifestFacts, manifestHandoff, manifestPriorSessionId, manifestRole, parseManifest, readManifest } from './manifest';

const v2Text = `session_id: 00000000-0000-4000-8000-000000000001
title: "Plan the feature"
workflow_id: plan
workflow_path: .migent/workflows/plan.yaml
created_at: 2026-10-26T09:00:00.000+00:00
prior_session_id: 00000000-0000-4000-8000-0000000000ff
schema_version: 2
`;

const legacyText = `session_id: s1
status: completed
created_at: 2026-10-26T09:00:00.000+00:00
`;

/** Rebuild a manifest text from a record so a test can drop or replace one field. */
function manifestWith(base: Record<string, unknown>, field: string, value: unknown): string {
  const record = { ...base };
  if (value === undefined) delete record[field];
  else record[field] = value;
  return Object.entries(record)
    .map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)
    .join('\n');
}

const v2Record = { session_id: 's1', created_at: '2026-10-26T09:00:00.000+00:00', schema_version: 2, workflow_id: 'plan' };
const legacyRecord = { session_id: 's1', created_at: '2026-10-26T09:00:00.000+00:00', status: 'completed' };

describe('parseManifest', () => {
  it('reads a schema 2 manifest as the contract declares it', () => {
    expect(parseManifest(v2Text)).toEqual({
      kind: 'ok',
      manifest: {
        session_id: '00000000-0000-4000-8000-000000000001',
        created_at: '2026-10-26T09:00:00.000+00:00',
        schema_version: 2,
        workflow_id: 'plan',
        title: 'Plan the feature',
        workflow_path: '.migent/workflows/plan.yaml',
        prior_session_id: '00000000-0000-4000-8000-0000000000ff',
      },
    });
  });

  it('reads a legacy manifest with no schema_version, or with schema_version 1', () => {
    expect(parseManifest(legacyText)).toEqual({
      kind: 'ok',
      manifest: { session_id: 's1', created_at: '2026-10-26T09:00:00.000+00:00', status: 'completed' },
    });
    expect(parseManifest(`${legacyText}schema_version: 1\n`)).toMatchObject({ kind: 'ok', manifest: { schema_version: 1 } });
  });

  it('reads unquoted integer ids as the same strings as quoted ones', () => {
    const withIds = (session: string, prior: string): string =>
      v2Text.replace(/^session_id:.*$/m, `session_id: ${session}`).replace(/^prior_session_id:.*$/m, `prior_session_id: ${prior}`);
    const unquoted = parseManifest(withIds('3', '2'));
    expect(unquoted).toEqual(parseManifest(withIds('"3"', '"2"')));
    expect(unquoted).toMatchObject({ kind: 'ok', manifest: { session_id: '3', prior_session_id: '2' } });
  });

  it.each(['1.5', '-1', 'true', '[1]', '1e400'])('rejects a non-integer session id %s', (value) => {
    expect(parseManifest(v2Text.replace(/^session_id:.*$/m, `session_id: ${value}`))).toEqual({ kind: 'invalid' });
  });

  it('drops a wrong-typed optional field and keeps the record', () => {
    const read = parseManifest(`${v2Text}task: 5\nrole: [a]\nhandoff: nope\n`);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.manifest).not.toHaveProperty('task');
    expect(read.manifest).not.toHaveProperty('role');
    expect(read.manifest).not.toHaveProperty('handoff');
  });

  it('reports an unknown schema_version as unsupported, not invalid', () => {
    expect(parseManifest('session_id: s1\nschema_version: 99\n')).toEqual({ kind: 'unsupported', schemaVersion: 99 });
    expect(parseManifest('session_id: s1\nschema_version: 0\n')).toEqual({ kind: 'unsupported', schemaVersion: 0 });
  });

  it('is invalid for unparsable YAML, non-mappings and a missing file, without throwing', () => {
    expect(parseManifest('foo: [unclosed')).toEqual({ kind: 'invalid' });
    expect(parseManifest('- a\n- b\n')).toEqual({ kind: 'invalid' });
    expect(parseManifest('null\n')).toEqual({ kind: 'invalid' });
    expect(readManifest(path.join(path.sep, 'no', 'manifest.yaml'))).toEqual({ kind: 'invalid' });
  });

  // RC1: every required field, missing and wrong-typed, on an otherwise valid record.
  describe.each([
    ['schema 2', v2Record, ['session_id', 'created_at', 'workflow_id', 'schema_version']],
    ['legacy', legacyRecord, ['session_id', 'created_at', 'status']],
  ] as const)('%s required fields', (_name, record, required) => {
    it('accepts the otherwise valid record', () => {
      expect(parseManifest(manifestWith(record, 'session_id', 's1')).kind).toBe('ok');
    });

    it.each(required)('rejects a record without %s', (field) => {
      expect(parseManifest(manifestWith(record, field, undefined))).toEqual({ kind: 'invalid' });
    });

    it.each(required)('rejects a record whose %s has the wrong type', (field) => {
      for (const wrong of [[1, 2], { a: 1 }, true, null]) {
        expect(parseManifest(manifestWith(record, field, wrong))).toEqual({ kind: 'invalid' });
      }
    });

    it.each(required.filter((field) => field !== 'schema_version'))('rejects an empty %s', (field) => {
      expect(parseManifest(manifestWith(record, field, ''))).toEqual({ kind: 'invalid' });
    });
  });

  it('rejects a mapping that matches neither contract member', () => {
    expect(parseManifest(manifestWith(v2Record, 'workflow_id', undefined))).toEqual({ kind: 'invalid' });
    expect(parseManifest(manifestWith(legacyRecord, 'schema_version', '1'))).toEqual({ kind: 'invalid' });
  });
});

describe('manifest accessors', () => {
  it('read the v2-only fields and return null for a legacy manifest or none', () => {
    const v2 = parseManifest(`${v2Text}role: developer\nhandoff:\n  a: 1\n`);
    const legacy = parseManifest(legacyText);
    if (v2.kind !== 'ok' || legacy.kind !== 'ok') throw new Error('did not read');
    expect(manifestRole(v2.manifest)).toBe('developer');
    expect(manifestPriorSessionId(v2.manifest)).toBe('00000000-0000-4000-8000-0000000000ff');
    expect(manifestHandoff(v2.manifest)).toEqual({ a: 1 });
    expect(manifestRole(legacy.manifest)).toBeNull();
    expect(manifestPriorSessionId(legacy.manifest)).toBeNull();
    expect(manifestHandoff(legacy.manifest)).toBeNull();
    expect(manifestRole(null)).toBeNull();
  });
});

describe('manifestFacts', () => {
  it('maps each read onto the snapshot value and the display state', () => {
    expect(manifestFacts({ kind: 'invalid' })).toEqual({ manifest: null, unsupportedManifestVersion: null, state: 'invalid' });
    expect(manifestFacts({ kind: 'unsupported', schemaVersion: 9 })).toEqual({
      manifest: null,
      unsupportedManifestVersion: 9,
      state: 'unsupported',
    });
    expect(manifestFacts(parseManifest(v2Text)).state).toBe('ok');
  });
});

// RC2: the extension accepts every manifest the contract describes. `unknown-schema` is the one fixture that is not
// conforming by design (it declares a schema_version the contract does not know).
describe('fixture manifests', () => {
  const root = path.join(__dirname, 'fixtures');
  const manifests: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'manifest.yaml') manifests.push(full);
    }
  };
  walk(root);

  it('finds the fixture manifests', () => {
    expect(manifests.length).toBeGreaterThan(15);
  });

  // The value each fixture must read as: the file's own fields, with only the approved normalization (a numeric id
  // becomes a string) and the contract member that applies (the legacy member has no workflow_path, task or role).
  const expectedOf = (raw: Record<string, unknown>): Record<string, unknown> => {
    const isV2 = raw.schema_version === 2;
    const names = isV2
      ? ['session_id', 'created_at', 'workflow_id', 'title', 'workflow_path', 'task', 'role']
      : ['session_id', 'created_at', 'status', 'title', 'workflow_id'];
    const expected: Record<string, unknown> = {};
    for (const name of names) {
      const value = raw[name];
      if (typeof value === 'string' && value !== '') expected[name] = value;
      else if (name === 'session_id' && typeof value === 'number') expected[name] = String(value);
    }
    if (raw.schema_version === 1 || isV2) expected.schema_version = raw.schema_version;
    const prior = raw.prior_session_id;
    if (isV2 && (typeof prior === 'number' || (typeof prior === 'string' && prior !== ''))) expected.prior_session_id = String(prior);
    if (isV2 && typeof raw.handoff === 'object' && raw.handoff !== null) expected.handoff = raw.handoff;
    return expected;
  };

  it.each(manifests.map((file) => [path.relative(root, file).replaceAll('\\', '/'), file]))('accepts %s', (name, file) => {
    const read = readManifest(file);
    if (name === 'sessions/unknown-schema/manifest.yaml') {
      expect(read.kind).toBe('unsupported');
      return;
    }
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.manifest).toEqual(expectedOf(parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
  });
});
