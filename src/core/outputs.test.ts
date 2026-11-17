import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listOutputs, publishedOutputs } from './outputs';
import { readStatus } from './statusReader';
import { capturedDir } from './testHelpers';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempSession(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-outputs-'));
  temps.push(dir);
  return dir;
}

describe('listOutputs', () => {
  it('lists the published output of the captured handoff-source session as missing when the file is absent', () => {
    const dir = capturedDir('handoff-source');
    const read = readStatus(path.join(dir, 'status.json'));
    if (read.kind !== 'ok') throw new Error('status did not read');
    const listing = listOutputs(dir, publishedOutputs(read.status));
    // The captured sample does not include outputs/note.md.
    expect(listing.rows).toEqual([
      expect.objectContaining({ name: 'note', path: 'outputs/note.md', state: 'missing' }),
    ]);
    expect(listing.directoryError).toBeNull();
  });

  it('reports present published files and path-only rows for unnamed files', () => {
    const dir = tempSession();
    mkdirSync(path.join(dir, 'outputs'));
    writeFileSync(path.join(dir, 'outputs', 'note.md'), 'n');
    writeFileSync(path.join(dir, 'outputs', 'extra.md'), 'e');
    mkdirSync(path.join(dir, 'outputs', 'nested'));
    const listing = listOutputs(dir, [
      ['note', { path: 'outputs/note.md', source_execution_id: 'e1', published_by_execution_id: 'e1' }],
    ]);
    expect(listing.rows.map((row) => [row.name, row.path, row.state])).toEqual([
      ['note', 'outputs/note.md', 'ok'],
      [null, 'outputs/extra.md', 'ok'],
    ]);
    expect(listing.rows[0]?.absolutePath).toBe(path.join(dir, 'outputs', 'note.md'));
  });

  it('rejects published paths that leave the session directory', () => {
    const dir = tempSession();
    const absolute = path.join(os.tmpdir(), 'secret.txt');
    const listing = listOutputs(dir, [
      ['up', { path: '../secret.txt' }],
      ['abs', { path: absolute }],
      ['win', { path: 'C:\\secret.txt' }],
    ]);
    expect(listing.rows.map((row) => [row.state, row.absolutePath])).toEqual([
      ['rejected', null],
      ['rejected', null],
      ['rejected', null],
    ]);
  });

  it('treats a missing outputs directory, or a file in its place, as no unnamed outputs', () => {
    const dir = tempSession();
    expect(listOutputs(dir, [])).toEqual({ rows: [], directoryError: null });
    writeFileSync(path.join(dir, 'outputs'), 'x');
    expect(listOutputs(dir, [])).toEqual({ rows: [], directoryError: null });
  });
});

describe('publishedOutputs', () => {
  it('lists entries in file order and skips those without a string path', () => {
    const status = { session_id: 's1', status: 'active', outputs: { a: { path: 'outputs/a.md' }, b: {}, c: { path: 3 }, d: { path: 'outputs/d.md' } } };
    expect(publishedOutputs(status).map(([name]) => name)).toEqual(['a', 'd']);
    expect(publishedOutputs(null)).toEqual([]);
    expect(publishedOutputs({ session_id: 's1', status: 'active' })).toEqual([]);
  });
});
