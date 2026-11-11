import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveDisplayState } from '../core/displayState';
import type { SessionSnapshot } from '../core/model';
import { parseStatus } from '../core/statusReader';
import { LABELS, NOTICES } from '../text/notices';

const hoisted = vi.hoisted(() => ({
  enabled: new Map<string, boolean>(),
  window: { showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));
vi.mock('vscode', () => ({
  window: hoisted.window,
  commands: hoisted.commands,
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: boolean) => hoisted.enabled.get(key) ?? fallback,
    }),
  },
}));

const { StateNotifier } = await import('./notifier');
const { window, commands } = hoisted;

type Listener = (change: unknown) => void;

function snapshot(raw: Record<string, unknown>, id = 's1'): SessionSnapshot {
  const status = parseStatus(JSON.stringify(raw));
  return {
    sessionId: id,
    manifest: null,
    status,
    statusError: false,
    lock: { kind: 'none' },
    displayState: deriveDisplayState({ status, statusError: null, manifest: 'ok' }, { kind: 'none' }),
    titleOverride: 'T',
    replyTargets: [],
  };
}

const running = { status: 'active', latest_execution_id: '0001-plan--attempt-01', latest_execution_status: 'running' };
const failed = (id: string) => ({ status: 'active', latest_execution_id: id, latest_execution_status: 'failed' });
const blocked = {
  status: 'blocked',
  latest_execution_id: '0001-plan--attempt-01',
  blocked_by_execution_ids: ['0001-plan--attempt-01'],
};
const completed = { status: 'completed', latest_execution_id: '0003-x--attempt-01' };

let root = '';
let listener: Listener = () => undefined;
const snapshots = new Map<string, SessionSnapshot>();
let isLoaded = true;

const registry = {
  get isLoaded() {
    return isLoaded;
  },
  onDidChange: (fn: Listener) => {
    listener = fn;
    return { dispose: () => undefined };
  },
  projects: () => [context],
  project: (key: string) => (key === 'p' ? context : undefined),
};
const context = {
  key: 'p',
  get root() {
    return root;
  },
  folder: { uri: {} },
  store: { all: () => [...snapshots.values()], snapshot: (id: string) => snapshots.get(id) },
};

const change = (sessionId = 's1') => ({ type: 'session', project: 'p', sessionId, kind: 'updated' });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

let notifier: InstanceType<typeof StateNotifier>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'migent-notifier-'));
  snapshots.clear();
  isLoaded = true;
  hoisted.enabled.clear();
  for (const fn of [...Object.values(window), commands.executeCommand]) fn.mockReset();
  for (const fn of Object.values(window)) fn.mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  notifier.dispose();
  rmSync(root, { recursive: true, force: true });
});

function start(initial?: Record<string, unknown>): void {
  if (initial !== undefined) snapshots.set('s1', snapshot(initial));
  notifier = new StateNotifier(registry as never);
  listener({ type: 'refresh' });
}

describe('StateNotifier', () => {
  it('stays silent for what exists at startup, then notifies a later failure once', () => {
    start(failed('0001-plan--attempt-01'));
    listener(change());
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    listener(change());
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    const [text, ...labels] = window.showErrorMessage.mock.calls[0] as string[];
    expect(text).toBe(NOTICES['notify.failed'].text({ label: 'T', where: '', cause: null, quota: null }));
    expect(labels).toEqual([LABELS.continue, LABELS.viewLog]);
  });

  it('shows the blocked and completed entries with their buttons', async () => {
    start(running);
    snapshots.set('s1', snapshot(blocked));
    listener(change());
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      NOTICES['notify.blocked'].text({ label: 'T', stage: 'A stage' }),
      LABELS.reply,
    );
    snapshots.set('s2', snapshot(completed, 's2'));
    listener(change('s2'));
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      NOTICES['notify.completed'].text({ label: 'T' }),
      LABELS.openOverview,
    );
  });

  it('runs a picked button against the session and execution it announced', async () => {
    start(running);
    window.showWarningMessage.mockResolvedValueOnce(LABELS.reply);
    snapshots.set('s1', snapshot(blocked));
    listener(change());
    await flush();
    expect(commands.executeCommand).toHaveBeenCalledWith('migent.session.reply', {
      project: 'p',
      sessionId: 's1',
      executionId: '0001-plan--attempt-01',
    });
  });

  it('runs View log on the failure with the captured target', async () => {
    start(running);
    window.showErrorMessage.mockResolvedValueOnce(LABELS.viewLog);
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    await flush();
    expect(commands.executeCommand).toHaveBeenCalledWith('migent.session.showLog', { project: 'p', sessionId: 's1' });
  });

  it('offers Open failure report only for an execution that wrote one', async () => {
    start(running);
    const dir = join(root, '.migent', 'sessions', 's1', 'executions', '0002-plan--attempt-02');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'failure.md'), '# failed');
    window.showErrorMessage.mockResolvedValueOnce(LABELS.failureReport);
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    expect(window.showErrorMessage.mock.calls[0]?.slice(1)).toEqual([
      LABELS.continue,
      LABELS.failureReport,
      LABELS.viewLog,
    ]);
    await flush();
    expect(commands.executeCommand).toHaveBeenCalledWith('migent.session.openFailure', {
      project: 'p',
      sessionId: 's1',
      executionId: '0002-plan--attempt-02',
    });
  });

  /** Make every call of `fn` return its own pending promise and expose how to settle each open notification. */
  function manual(fn: typeof window.showErrorMessage): ((picked?: string) => void)[] {
    const settle: ((picked?: string) => void)[] = [];
    fn.mockImplementation(
      () => new Promise<string | undefined>((resolve) => settle.push((picked) => resolve(picked))),
    );
    return settle;
  }

  function writeExecution(id: string, record: Record<string, unknown>): void {
    const dir = join(root, '.migent', 'sessions', 's1', 'executions', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'execution.json'), JSON.stringify(record));
  }

  it('queues while one is open, shows only the latest rebuilt from fresh state, and skips the superseded one', async () => {
    start(running);
    const open = manual(window.showErrorMessage);
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    snapshots.set('s1', snapshot(failed('0003-plan--attempt-03')));
    listener(change());
    snapshots.set('s1', snapshot(failed('0004-plan--attempt-04')));
    listener(change());
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);

    // The queued notification is built when shown: what the execution records by then is what the text names.
    writeExecution('0004-plan--attempt-04', { failure_reason: 'verify_failed', error: 'late cause' });
    open[0]?.(undefined);
    await flush();

    expect(window.showErrorMessage).toHaveBeenCalledTimes(2);
    const [text] = window.showErrorMessage.mock.calls[1] as string[];
    expect(text).toContain('late cause');
    // Attempt 03 was replaced in the queue and never shows, not even after the second one is dismissed.
    open[1]?.(undefined);
    await flush();
    expect(window.showErrorMessage).toHaveBeenCalledTimes(2);
  });

  it('drops a queued notification that no longer applies and frees the session', async () => {
    start(running);
    const open = manual(window.showErrorMessage);
    snapshots.set('s1', snapshot(failed('0005-plan--attempt-05')));
    listener(change());
    snapshots.set('s1', snapshot(blocked));
    listener(change());
    expect(window.showWarningMessage).not.toHaveBeenCalled();

    snapshots.set('s1', snapshot(running));
    open[0]?.(undefined);
    await flush();
    expect(window.showWarningMessage).not.toHaveBeenCalled();

    // The gate was released, so the next transition shows at once.
    snapshots.set('s1', snapshot(failed('0006-plan--attempt-06')));
    listener(change());
    expect(window.showErrorMessage).toHaveBeenCalledTimes(2);
  });

  it('shows a queued notification that still applies after the open one closes', async () => {
    start(running);
    const open = manual(window.showErrorMessage);
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    snapshots.set('s1', snapshot(blocked));
    listener(change());
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    open[0]?.(undefined);
    await flush();
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      NOTICES['notify.blocked'].text({ label: 'T', stage: 'A stage' }),
      LABELS.reply,
    );
  });

  it('does not let one session hold back another', () => {
    start(running);
    snapshots.set('s2', snapshot(running, 's2'));
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    snapshots.set('s2', snapshot(failed('0002-plan--attempt-02'), 's2'));
    listener(change('s2'));
    expect(window.showErrorMessage).toHaveBeenCalledTimes(2);
  });

  it('is suppressed by a disabled setting', () => {
    start(running);
    hoisted.enabled.set('failed', false);
    snapshots.set('s1', snapshot(failed('0002-plan--attempt-02')));
    listener(change());
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });
});
