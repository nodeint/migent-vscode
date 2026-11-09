import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { patternMatcher, POLL_INTERVAL_MS, pollingWatchBackend } from './pollingWatchBackend';
import type { Releasable, WatchEventKind } from './watchBackend';

const TICKS = 4;
const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * TICKS));

describe('patternMatcher', () => {
  it('matches literals, star and alternatives', () => {
    expect(patternMatcher('.migent')('.migent')).toBe(true);
    expect(patternMatcher('.migent')('xmigent')).toBe(false);
    expect(patternMatcher('*')('anything.md')).toBe(true);
    expect(patternMatcher('{a.json,b.json}')('b.json')).toBe(true);
    expect(patternMatcher('{a.json,b.json}')('c.json')).toBe(false);
    expect(patternMatcher('*.{yaml,yml}')('x.yml')).toBe(true);
    expect(patternMatcher('*.{yaml,yml}')('x.json')).toBe(false);
  });
});

describe('pollingWatchBackend', () => {
  let folder = '';
  let watcher: Releasable | undefined;
  let events: [WatchEventKind, string][] = [];

  const start = (pattern: string, target = folder): void => {
    watcher = pollingWatchBackend.create({ id: target, folder: target, pattern }, (kind, fsPath) => {
      events.push([kind, path.basename(fsPath)]);
    });
  };

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'migent-poll-'));
    events = [];
  });
  afterEach(() => {
    watcher?.dispose();
    watcher = undefined;
    rmSync(folder, { recursive: true, force: true });
  });

  it('reports create, change and delete of matching children only', async () => {
    start('*.json');
    writeFileSync(path.join(folder, 'a.json'), '1');
    writeFileSync(path.join(folder, 'skip.txt'), '1');
    await wait();
    writeFileSync(path.join(folder, 'a.json'), '12');
    await wait();
    rmSync(path.join(folder, 'a.json'));
    await wait();
    expect(events).toEqual([
      ['create', 'a.json'],
      ['change', 'a.json'],
      ['delete', 'a.json'],
    ]);
  });

  it('does not report files that existed before start', async () => {
    writeFileSync(path.join(folder, 'a.json'), '1');
    start('*');
    await wait();
    expect(events).toEqual([]);
  });

  it('reports an atomic replace as a change', async () => {
    writeFileSync(path.join(folder, 'a.json'), 'old');
    start('a.json');
    writeFileSync(path.join(folder, 'a.json.tmp'), 'newer content');
    renameSync(path.join(folder, 'a.json.tmp'), path.join(folder, 'a.json'));
    await wait();
    expect(events).toEqual([['change', 'a.json']]);
  });

  it('is non-recursive', async () => {
    mkdirSync(path.join(folder, 'sub'));
    start('*');
    await wait();
    events = [];
    writeFileSync(path.join(folder, 'sub', 'deep.json'), '1');
    await wait();
    expect(events).toEqual([]);
  });

  it('treats a missing folder as empty and picks up its creation', async () => {
    const missing = path.join(folder, 'later');
    start('*', missing);
    await wait();
    expect(events).toEqual([]);
    mkdirSync(missing);
    writeFileSync(path.join(missing, 'a.json'), '1');
    await wait();
    expect(events).toEqual([['create', 'a.json']]);
  });

  it('stops reporting after dispose', async () => {
    start('*');
    watcher?.dispose();
    writeFileSync(path.join(folder, 'a.json'), '1');
    await wait();
    expect(events).toEqual([]);
  });
});
