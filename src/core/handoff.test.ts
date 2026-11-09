import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { childrenOf, readHandoff } from './handoff';
import { parseManifest, readManifest } from './manifest';
import type { SessionSnapshot } from './model';
import { capturedDir } from './testHelpers';

function snapshot(sessionId: string, priorSessionId: string | null): SessionSnapshot {
  return {
    sessionId,
    manifest: parseManifest(`session_id: ${sessionId}\n${priorSessionId === null ? '' : `prior_session_id: ${priorSessionId}\n`}`),
    status: null,
    statusError: false,
    lock: { kind: 'none' },
    displayState: { state: 'completed', icon: 'pass', writable: true },
    replyTargets: [],
  };
}

describe('readHandoff', () => {
  const dir = capturedDir('handoff-target');

  it('parses the inline JSON mapping of the captured manifest (schema_version 2)', () => {
    const manifest = readManifest(path.join(dir, 'manifest.yaml'));
    expect(manifest).toMatchObject({ schemaVersion: 2, schemaSupported: true });
    expect(manifest?.priorSessionId).toBe('00000000-0000-4000-8000-0000000000b1');
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
    const manifest = parseManifest(
      'session_id: t\nhandoff: {"source_session_id":"s","artifacts":{"a":{"output":"o","source_path":"C:\\\\x\\\\o.md","path":"../escape.md","sha256":"h"}}}\n',
    );
    const read = readHandoff(manifest, dir);
    expect(read.kind === 'ok' && read.artifacts[0]).toMatchObject({
      localPath: null,
      sourcePath: 'C:\\x\\o.md',
    });
  });

  it('is absent without handoff and invalid outside the observed shape', () => {
    expect(readHandoff(readManifest(path.join(capturedDir('handoff-source'), 'manifest.yaml')), dir)).toEqual({
      kind: 'absent',
    });
    expect(readHandoff(null, dir)).toEqual({ kind: 'absent' });
    expect(readHandoff(parseManifest('session_id: t\nhandoff: text\n'), dir).kind).toBe('invalid');
    expect(readHandoff(parseManifest('session_id: t\nhandoff: {"artifacts": {}}\n'), dir).kind).toBe('invalid');
    expect(
      readHandoff(parseManifest('session_id: t\nhandoff: {"source_session_id":"s","artifacts":{"a":{"output":"o"}}}\n'), dir),
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
