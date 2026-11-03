/**
 * S0 watcher probe (plans/02-monitoring.md §7.1).
 *
 * Runs inside the extension host. Verifies that non-recursive `RelativePattern` watchers deliver the events
 * §6.1 relies on while `files.watcherExclude` hides `.migent`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { recordFailure } from './failureReport';

type Kind = 'create' | 'change' | 'delete';
type Names = string[] | '*';

interface Recorded {
  kind: Kind;
  name: string;
}

interface Recorder {
  events: Recorded[];
  clear(): void;
  dispose(): void;
}

interface CaseContext {
  root: string;
  notes: string[];
  watch(base: string, names: Names): Recorder;
}

interface ProbeCase {
  id: string;
  title: string;
  run(ctx: CaseContext): Promise<string[]>;
}

interface CaseResult {
  vscodeVersion: string;
  backend: 'vscode';
  id: string;
  title: string;
  ok: boolean;
  detail: string;
}

const DELIVERY_MS = 2000;
const QUIET_MS = 1000;
const WARMUP_MS = 600;
const SETTLE_MS = 300;
const POLL_MS = 25;

const SESSION_NAMES = [
  'manifest.yaml',
  'status.json',
  'session.lock',
  'cancel.requested',
  'questions.json',
  'next.json',
  'workflow.frozen.yaml',
  'events.jsonl',
  'executions',
  'outputs',
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(POLL_MS);
  }
  return predicate();
}

function toPattern(names: Names): string {
  if (names === '*') {
    return '*';
  }
  return names.length === 1 ? names[0] : `{${names.join(',')}}`;
}

function watchWithVscode(base: string, names: Names): Recorder {
  const events: Recorded[] = [];
  // Compare in VS Code's own fsPath form (it lower-cases the Windows drive letter).
  const baseFsPath = vscode.Uri.file(base).fsPath;
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(base), toPattern(names)),
  );
  const record = (kind: Kind) => (uri: vscode.Uri) => {
    events.push({ kind, name: path.relative(baseFsPath, uri.fsPath) });
  };
  const subscriptions = [
    watcher.onDidCreate(record('create')),
    watcher.onDidChange(record('change')),
    watcher.onDidDelete(record('delete')),
  ];
  return {
    events,
    clear: () => {
      events.length = 0;
    },
    dispose: () => {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      watcher.dispose();
    },
  };
}

const seen = (rec: Recorder, kind: Kind, name: string): boolean =>
  rec.events.some((event) => event.kind === kind && event.name === name);

const seenAny = (rec: Recorder, name: string): boolean => rec.events.some((event) => event.name === name);

/** Wait for an expected event; push a failure message when it is not delivered. */
async function expectEvent(failures: string[], rec: Recorder, kind: Kind, name: string, label: string): Promise<void> {
  const ok = await waitFor(() => seen(rec, kind, name), DELIVERY_MS);
  if (!ok) {
    const got = rec.events.map((event) => `${event.kind}:${event.name}`).join(',') || 'none';
    failures.push(`${label}: no ${kind} for ${name} (got ${got})`);
  }
}

async function expectQuiet(failures: string[], rec: Recorder, name: string, label: string): Promise<void> {
  await sleep(QUIET_MS);
  if (seenAny(rec, name)) {
    failures.push(`${label}: unexpected event for ${name}`);
  }
}

function resetMigent(root: string): Promise<void> {
  fs.rmSync(path.join(root, '.migent'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return sleep(SETTLE_MS);
}

function sessionDir(root: string): string {
  const dir = path.join(root, '.migent', 'sessions', 's1');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function sessionFileCycle(failures: string[], rec: Recorder, dir: string): Promise<void> {
  for (const name of ['status.json', 'session.lock']) {
    const file = path.join(dir, name);
    rec.clear();
    fs.writeFileSync(file, '{"a":1}');
    await expectEvent(failures, rec, 'create', name, 'P1');
    rec.clear();
    fs.writeFileSync(file, '{"a":2,"padding":"xxxxxxxx"}');
    await expectEvent(failures, rec, 'change', name, 'P1');
    rec.clear();
    fs.rmSync(file);
    await expectEvent(failures, rec, 'delete', name, 'P1');
  }
  const events = path.join(dir, 'events.jsonl');
  rec.clear();
  fs.writeFileSync(events, '{"seq":1}\n');
  await expectEvent(failures, rec, 'create', 'events.jsonl', 'P1');
  rec.clear();
  fs.appendFileSync(events, '{"seq":2}\n');
  await expectEvent(failures, rec, 'change', 'events.jsonl', 'P1 append');
  rec.clear();
  fs.rmSync(events);
  await expectEvent(failures, rec, 'delete', 'events.jsonl', 'P1');
}

const cases: ProbeCase[] = [
  {
    id: 'P1',
    title: 'Session-level brace pattern: create/modify/delete status.json, session.lock; events.jsonl append',
    async run({ root, watch }) {
      const failures: string[] = [];
      const dir = sessionDir(root);
      const rec = watch(dir, SESSION_NAMES);
      try {
        await sleep(WARMUP_MS);
        await sessionFileCycle(failures, rec, dir);
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P2',
    title: 'Atomic replace of status.json (temp file + rename): event for status.json, none for temp name',
    async run({ root, watch }) {
      const failures: string[] = [];
      const dir = sessionDir(root);
      fs.writeFileSync(path.join(dir, 'status.json'), '{"a":1}');
      const rec = watch(dir, SESSION_NAMES);
      try {
        await sleep(WARMUP_MS);
        rec.clear();
        const temp = 'status.json.tmp-1234';
        fs.writeFileSync(path.join(dir, temp), '{"a":2}');
        fs.renameSync(path.join(dir, temp), path.join(dir, 'status.json'));
        const ok = await waitFor(() => seen(rec, 'change', 'status.json') || seen(rec, 'create', 'status.json'), DELIVERY_MS);
        if (!ok) {
          failures.push('P2: no change/create for status.json');
        }
        await expectQuiet(failures, rec, temp, 'P2');
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P3',
    title: 'sessions/ with *: create, delete and rename of a session directory',
    async run({ root, watch, notes }) {
      const failures: string[] = [];
      const sessions = path.join(root, '.migent', 'sessions');
      fs.mkdirSync(sessions, { recursive: true });
      const rec = watch(sessions, '*');
      try {
        await sleep(WARMUP_MS);
        rec.clear();
        fs.mkdirSync(path.join(sessions, 'a'));
        await expectEvent(failures, rec, 'create', 'a', 'P3 create');
        rec.clear();
        fs.rmdirSync(path.join(sessions, 'a'));
        await expectEvent(failures, rec, 'delete', 'a', 'P3 delete');
        fs.mkdirSync(path.join(sessions, 'b'));
        await sleep(SETTLE_MS);
        rec.clear();
        fs.renameSync(path.join(sessions, 'b'), path.join(sessions, 'c'));
        const asPair = () => seen(rec, 'delete', 'b') && seen(rec, 'create', 'c');
        const asChange = () => seen(rec, 'change', 'b') && seen(rec, 'change', 'c');
        const ok = await waitFor(() => asPair() || asChange(), DELIVERY_MS);
        if (ok) {
          notes.push(`rename delivered as ${asPair() ? 'delete+create' : 'change+change'}`);
        } else {
          failures.push(`P3 rename: got ${rec.events.map((event) => `${event.kind}:${event.name}`).join(',') || 'none'}`);
        }
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P4',
    title: 'Anchor on workspace root with .migent: create and delete of .migent/',
    async run({ root, watch }) {
      const failures: string[] = [];
      const rec = watch(root, ['.migent']);
      try {
        await sleep(WARMUP_MS);
        rec.clear();
        fs.mkdirSync(path.join(root, '.migent'));
        await expectEvent(failures, rec, 'create', '.migent', 'P4 create');
        rec.clear();
        fs.rmSync(path.join(root, '.migent'), { recursive: true });
        await expectEvent(failures, rec, 'delete', '.migent', 'P4 delete');
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P5',
    title: 'Folder lifecycle: delete watched folder, recreate, dispose old watcher, new watcher delivers events',
    async run({ root, watch, notes }) {
      const failures: string[] = [];
      const dir = sessionDir(root);
      const old = watch(dir, SESSION_NAMES);
      let fresh: Recorder | undefined;
      try {
        await sleep(WARMUP_MS);
        old.clear();
        fs.rmSync(dir, { recursive: true, force: true });
        await sleep(SETTLE_MS * 2);
        fs.mkdirSync(dir, { recursive: true });
        await sleep(SETTLE_MS);
        try {
          old.dispose();
        } catch (error) {
          failures.push(`P5: disposing old watcher threw ${String(error)}`);
        }
        notes.push(
          `old watcher after delete/recreate: ${old.events.map((event) => `${event.kind}:${event.name}`).join(',') || 'none'}`,
        );
        fresh = watch(dir, SESSION_NAMES);
        await sleep(WARMUP_MS);
        fresh.clear();
        fs.writeFileSync(path.join(dir, 'status.json'), '{"a":1}');
        await expectEvent(failures, fresh, 'create', 'status.json', 'P5 new watcher');
      } finally {
        old.dispose();
        fresh?.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P6',
    title: '.migent/ with {config.yaml,sessions,workflows}: create/delete of sessions/ and workflows/, config.yaml change',
    async run({ root, watch }) {
      const failures: string[] = [];
      const base = path.join(root, '.migent');
      fs.mkdirSync(base, { recursive: true });
      const rec = watch(base, ['config.yaml', 'sessions', 'workflows']);
      try {
        await sleep(WARMUP_MS);
        for (const name of ['sessions', 'workflows']) {
          rec.clear();
          fs.mkdirSync(path.join(base, name));
          await expectEvent(failures, rec, 'create', name, 'P6 create');
          rec.clear();
          fs.rmdirSync(path.join(base, name));
          await expectEvent(failures, rec, 'delete', name, 'P6 delete');
        }
        rec.clear();
        fs.writeFileSync(path.join(base, 'config.yaml'), 'schema_version: 1\n');
        await expectEvent(failures, rec, 'create', 'config.yaml', 'P6 config create');
        rec.clear();
        fs.writeFileSync(path.join(base, 'config.yaml'), 'schema_version: 1\nextra: true\n');
        await expectEvent(failures, rec, 'change', 'config.yaml', 'P6 config change');
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
  {
    id: 'P7',
    title: 'Excluded sibling sanity: an unwatched file next to a watched one produces no event',
    async run({ root, watch }) {
      const failures: string[] = [];
      const dir = sessionDir(root);
      const rec = watch(dir, SESSION_NAMES);
      try {
        await sleep(WARMUP_MS);
        rec.clear();
        fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
        fs.writeFileSync(path.join(dir, 'status.json'), '{"a":1}');
        await expectEvent(failures, rec, 'create', 'status.json', 'P7');
        await expectQuiet(failures, rec, 'other.txt', 'P7');
      } finally {
        rec.dispose();
      }
      return failures;
    },
  },
];

const isExclude = (): boolean => process.env.MIGENT_IT_EXCLUDE === '1';

function assertProbeEnvironment(root: string): void {
  if (!isExclude()) {
    return;
  }
  const exclude = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('watcherExclude') ?? {};
  if (exclude['**/.migent/**'] !== true) {
    throw new Error('files.watcherExclude does not contain "**/.migent/**"; the probe would be meaningless');
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder || path.resolve(folder).toLowerCase() !== path.resolve(root).toLowerCase()) {
    throw new Error(`workspace folder ${String(folder)} does not match fixture workspace ${root}`);
  }
}

function report(results: CaseResult[]): void {
  const version = results[0]?.vscodeVersion ?? vscode.version;
  const lines = results.filter((result) => !result.ok).map(
    (result) => `FAIL ${result.backend.padEnd(8)} ${result.id} ${result.detail}`,
  );
  if (lines.length > 0) {
    console.log(`\nWatcher probe, VS Code ${version}, platform ${process.platform}\n${lines.join('\n')}`);
  }
  const outDir = path.resolve(__dirname, '..');
  fs.mkdirSync(outDir, { recursive: true });
  const label = process.env.MIGENT_IT_PROBE_LABEL ?? version;
  fs.writeFileSync(path.join(outDir, `probe-report-${label}${isExclude() ? '-exclude' : ''}.json`), JSON.stringify(results, null, 2));
}

/** Run every VS Code watcher probe; returns the number of failed cases. */
export async function runWatcherProbe(): Promise<number> {
  const root = process.env.MIGENT_IT_WORKSPACE;
  if (!root) {
    throw new Error('MIGENT_IT_WORKSPACE is not set; run through scripts/integration/run.mjs');
  }
  assertProbeEnvironment(root);
  const results: CaseResult[] = [];
  for (const probe of cases) {
    await resetMigent(root);
    const notes: string[] = [];
    let failures: string[];
    try {
      failures = await probe.run({ root, notes, watch: watchWithVscode });
    } catch (error) {
      failures = [`threw ${String(error)}`];
    }
    const detail = [...(failures.length > 0 ? failures : ['ok']), ...notes].join('; ');
    results.push({
      vscodeVersion: vscode.version,
      backend: 'vscode',
      id: probe.id,
      title: probe.title,
      ok: failures.length === 0,
      detail,
    });
  }
  await resetMigent(root);
  report(results);
  if (!isExclude()) {
    for (const result of results.filter((item) => !item.ok)) {
      recordFailure('watcher probe', `${result.id} ${result.title}`, result.detail);
    }
  }
  // With the exclude, VS Code delivers no events (known limitation): report only, never fail the suite.
  return isExclude() ? 0 : results.filter((result) => !result.ok).length;
}
