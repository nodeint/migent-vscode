import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { childrenOf, readHandoff } from './handoff';
import { manifestPriorSessionId, parseManifest, readManifest } from './manifest';
import type { SessionSnapshot } from './model';
import { capturedDir } from './testHelpers';

/** A complete schema 2 manifest text for `id`, with extra lines appended. */
function v2(id: string, extra = ''): string {
  return `session_id: ${id}\ncreated_at: 2026-11-01T00:00:00.000+00:00\nschema_version: 2\nworkflow_id: plan\n${extra}`;
}

function manifestOf(text: string): SessionSnapshot['manifest'] {
  const read = parseManifest(text);
  return read.kind === 'ok' ? read.manifest : null;
}

function snapshot(sessionId: string, priorSessionId: string | null): SessionSnapshot {
  return {
    sessionId,
    manifest: manifestOf(v2(sessionId, priorSessionId === null ? '' : `prior_session_id: ${priorSessionId}\n`)),
    unsupportedManifestVersion: null,
    status: null,
    statusError: false,
    lock: { kind: 'none' },
    displayState: { state: 'completed', icon: 'pass', writable: true },
    titleOverride: null,
    replyTargets: [],
  };
}

describe('readHandoff with numeric ids', () => {
  it('reads an unquoted integer source_session_id', () => {
    const manifest = manifestOf(v2('3', 'handoff: {"source_session_id": 2, "artifacts": {}}\n'));
    expect(readHandoff(manifest, '/tmp/x')).toMatchObject({ kind: 'ok', sourceSessionId: '2' });
  });

  it('links numeric-id sessions through childrenOf', () => {
    const source = snapshot('2', null);
    const child = snapshot('3', '2');
    expect(childrenOf([source, child], '2').map((s) => s.sessionId)).toEqual(['3']);
  });
});

function okManifest(file: string): SessionSnapshot['manifest'] {
  const read = readManifest(file);
  return read.kind === 'ok' ? read.manifest : null;
}

describe('readHandoff', () => {
  const dir = capturedDir('handoff-target');

  it('parses the inline JSON mapping of the captured manifest (schema_version 2)', () => {
    const manifest = okManifest(path.join(dir, 'manifest.yaml'));
    expect(manifest).toMatchObject({ schema_version: 2 });
    expect(manifestPriorSessionId(manifest)).toBe('00000000-0000-4000-8000-0000000000b1');
    const read = readHandoff(manifest, dir);
    expect(read).toMatchObject({ kind: 'ok', sourceSessionId: '00000000-0000-4000-8000-0000000000b1' });
    if (read.kind !== 'ok') return;
    expect(read.artifacts).toEqual([
      {
        name: 'context_note',
        output: 'note',
        sourcePath: expect.stringContaining('note.md'),
        path: 'handoff/1/note.md',
        localPath: path.join(dir, 'handoff', '1', 'note.md'),
        sha256: '02edbc066ee4147972f6aa6d611524c74135a06528ec94a2450cc84dd3bf084b',
      },
    ]);
  });

  it('confines the local path to the target session but keeps source_path as inert text', () => {
    const manifest = manifestOf(
      v2('t', 'handoff: {"source_session_id":"s","artifacts":{"a":{"output":"o","source_path":"C:\\\\x\\\\o.md","path":"../escape.md","sha256":"h"}}}\n'),
    );
    const read = readHandoff(manifest, dir);
    expect(read.kind === 'ok' && read.artifacts[0]).toMatchObject({
      localPath: null,
      sourcePath: 'C:\\x\\o.md',
    });
  });

  it('is absent without a handoff mapping and invalid outside the observed shape', () => {
    expect(readHandoff(okManifest(path.join(capturedDir('handoff-source'), 'manifest.yaml')), dir)).toEqual({
      kind: 'absent',
    });
    expect(readHandoff(null, dir)).toEqual({ kind: 'absent' });
    // The contract declares `handoff` as a mapping; the manifest reader drops a scalar, so it reads as absent.
    expect(readHandoff(manifestOf(v2('t', 'handoff: text\n')), dir).kind).toBe('absent');
    expect(readHandoff(manifestOf(v2('t', 'handoff: {"artifacts": {}}\n')), dir).kind).toBe('invalid');
    expect(
      readHandoff(manifestOf(v2('t', 'handoff: {"source_session_id":"s","artifacts":{"a":{"output":"o"}}}\n')), dir),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('artifact a') });
  });
});

describe('childrenOf', () => {
  it('returns retained sessions that name the source as prior, keeping the given order', () => {
    const all = [snapshot('c2', 's'), snapshot('other', 'x'), snapshot('s', null), snapshot('c1', 's')];
    expect(childrenOf(all, 's').map((child) => child.sessionId)).toEqual(['c2', 'c1']);
    expect(childrenOf(all, 'none')).toEqual([]);
  });
});
