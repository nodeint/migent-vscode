import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseManifest, readManifest } from './manifest';

const manifestText = `session_id: 00000000-0000-4000-8000-000000000001
title: "Plan the feature"
workflow_id: plan
workflow_path: .migent/workflows/plan.yaml
created_at: 2026-10-26T09:00:00.000+00:00
prior_session_id: 00000000-0000-4000-8000-0000000000ff
schema_version: 2
`;

describe('parseManifest', () => {
  it('parses a schema 2 manifest', () => {
    const manifest = parseManifest(manifestText);
    expect(manifest?.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(manifest?.title).toBe('Plan the feature');
    expect(manifest?.workflowId).toBe('plan');
    expect(manifest?.priorSessionId).toBe('00000000-0000-4000-8000-0000000000ff');
    expect(manifest?.schemaVersion).toBe(2);
    expect(manifest?.schemaSupported).toBe(true);
  });

  it('accepts a v1 manifest with a status line and no schema_version', () => {
    const manifest = parseManifest('session_id: s1\nstatus: completed\n');
    expect(manifest?.schemaVersion).toBeNull();
    expect(manifest?.schemaSupported).toBe(true);
    expect(manifest?.title).toBeNull();
  });

  it('rejects an unknown schema_version', () => {
    const manifest = parseManifest('session_id: s1\nschema_version: 99\n');
    expect(manifest?.schemaVersion).toBe(99);
    expect(manifest?.schemaSupported).toBe(false);
  });

  it('null for unparsable YAML and non-mappings', () => {
    expect(parseManifest('foo: [unclosed')).toBeNull();
    expect(parseManifest('- a\n- b\n')).toBeNull();
    expect(parseManifest('null\n')).toBeNull();
  });

  it('reads a fixture manifest', () => {
    const manifest = readManifest(
      path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', 'completed', 'manifest.yaml'),
    );
    expect(manifest?.workflowId).toBe('plan');
    expect(manifest?.schemaSupported).toBe(true);
  });

  it('null for a missing file', () => {
    expect(readManifest(path.join(path.sep, 'no', 'manifest.yaml'))).toBeNull();
  });
});
