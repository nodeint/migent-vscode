import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Releasable, WatchBackend, WatchEventKind } from './watchBackend';

/** Scan interval of the test-only polling backend. */
export const POLL_INTERVAL_MS = 50;

interface Entry {
  isDirectory: boolean;
  mtimeMs: number;
  size: number;
}

/**
 * Turn a `WatchSpec.pattern` into a matcher for one file name. Supports the forms `watchPlan` uses:
 * literal names, `*`, and `{a,b}` alternatives (alone or inside a name such as `*.{yaml,yml}`).
 */
export function patternMatcher(pattern: string): (name: string) => boolean {
  let source = '';
  let isInGroup = false;
  for (const char of pattern) {
    if (char === '*') source += '[^/\\\\]*';
    else if (char === '{') {
      isInGroup = true;
      source += '(?:';
    } else if (char === '}') {
      isInGroup = false;
      source += ')';
    } else if (char === ',' && isInGroup) source += '|';
    else source += char.replaceAll(/[$()+.?[\\\]^|]/g, String.raw`\$&`);
  }
  const regex = new RegExp(`^${source}$`);
  return (name) => regex.test(name);
}

/** Direct children of `folder` matching `isMatch`; a missing or unreadable folder or entry is skipped. */
function scan(folder: string, isMatch: (name: string) => boolean): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (!isMatch(name)) continue;
    try {
      const stats = statSync(path.join(folder, name));
      entries.set(name, { isDirectory: stats.isDirectory(), mtimeMs: stats.mtimeMs, size: stats.size });
    } catch {
      // Removed or locked between readdir and stat: treated as absent in this scan.
    }
  }
  return entries;
}

function changed(before: Entry, after: Entry): boolean {
  // A directory's mtime moves with its children; the folder's own watcher reports those.
  if (before.isDirectory || after.isDirectory) return before.isDirectory !== after.isDirectory;
  return before.mtimeMs !== after.mtimeMs || before.size !== after.size;
}

/**
 * Test-only backend: polls the folder on a timer and diffs `mtimeMs` and `size`. It holds no OS watch
 * handles, so it cannot fail with `EPERM` when watched folders are deleted or renamed. Same semantics as
 * the `RelativePattern` watcher: direct children only, events after creation.
 */
export const pollingWatchBackend: WatchBackend = {
  create: (spec, onEvent): Releasable => {
    const isMatch = patternMatcher(spec.pattern);
    let known = scan(spec.folder, isMatch);
    const emit = (kind: WatchEventKind, name: string): void => {
      onEvent(kind, path.join(spec.folder, name));
    };
    const timer = setInterval(() => {
      const current = scan(spec.folder, isMatch);
      const previous = known;
      known = current;
      for (const [name, entry] of current) {
        const before = previous.get(name);
        if (before === undefined) emit('create', name);
        else if (changed(before, entry)) emit('change', name);
      }
      for (const name of previous.keys()) {
        if (!current.has(name)) emit('delete', name);
      }
    }, POLL_INTERVAL_MS);
    timer.unref();
    return { dispose: () => clearInterval(timer) };
  },
};
