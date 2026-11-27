import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RECOMMENDATIONS_RELATIVE_PATH } from './paths';
import { readRecommendations } from './recommendations';
import { syntheticDir } from './testHelpers';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session(content?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-recs-'));
  temps.push(dir);
  if (content !== undefined) {
    mkdirSync(path.join(dir, path.dirname(RECOMMENDATIONS_RELATIVE_PATH)), { recursive: true });
    writeFileSync(path.join(dir, RECOMMENDATIONS_RELATIVE_PATH), content);
  }
  return dir;
}

const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  stage_id: 's',
  execution_id: 'e',
  workflow: 'w',
  reason: 'r',
  ...overrides,
});

describe('readRecommendations', () => {
  it('reads the synthetic fixture in file order, with the warning kept', () => {
    const read = readRecommendations(syntheticDir('recommendations'));
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.entries.map((item) => [item.stage_id, item.workflow, item.warning !== null])).toEqual([
      ['design', 'plan', false],
      ['review', null, false],
      ['verify', 'release', true],
    ]);
  });

  it('is missing without the file or the plugins folder', () => {
    expect(readRecommendations(session())).toEqual({ kind: 'missing' });
  });

  it('is invalid for non-JSON, a non-object or a missing list', () => {
    expect(readRecommendations(session('{')).kind).toBe('invalid');
    expect(readRecommendations(session('[]')).kind).toBe('invalid');
    expect(readRecommendations(session(JSON.stringify({ schema_version: 1 }))).kind).toBe('invalid');
  });

  it('is unsupported for another or a missing schema_version', () => {
    expect(readRecommendations(session(JSON.stringify({ schema_version: 2, recommendations: [] })))).toEqual({
      kind: 'unsupported',
      schemaVersion: 2,
    });
    expect(readRecommendations(session(JSON.stringify({ recommendations: [] })))).toEqual({
      kind: 'unsupported',
      schemaVersion: null,
    });
  });

  it('is unreadable when the path is not a readable file', () => {
    const dir = session();
    mkdirSync(path.join(dir, RECOMMENDATIONS_RELATIVE_PATH), { recursive: true });
    expect(readRecommendations(dir).kind).toBe('unreadable');
  });

  it('skips an entry with a missing or mistyped required field and keeps the rest', () => {
    const body = {
      schema_version: 1,
      recommendations: [
        entry({ stage_id: 'a' }),
        entry({ stage_id: undefined }),
        entry({ execution_id: 1 }),
        entry({ reason: null }),
        entry({ workflow: 3 }),
        'text',
        entry({ stage_id: 'b', workflow: null, warning: 'w' }),
      ],
    };
    const read = readRecommendations(session(JSON.stringify(body)));
    expect(read.kind === 'ok' && read.entries.map((item) => item.stage_id)).toEqual(['a', 'b']);
  });
});
