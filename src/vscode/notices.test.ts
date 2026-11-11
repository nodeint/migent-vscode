import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(),
  },
}));
vi.mock('vscode', () => ({ window: hoisted.window, ProgressLocation: { Notification: 15, Window: 10 } }));

const { LABELS, NOTICES } = await import('../core/notices');
const { confirm, notify, progress, show } = await import('./notices');
const { window } = hoisted;

beforeEach(() => {
  for (const fn of Object.values(window)) fn.mockReset();
});

describe('show', () => {
  it('uses the entry severity and button labels and returns the picked key', async () => {
    window.showErrorMessage.mockResolvedValue(LABELS.viewLog);
    const picked = await show('control.repairFailed', { detail: 'boom' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      NOTICES['control.repairFailed'].text({ detail: 'boom' }),
      LABELS.viewLog,
    );
    expect(picked).toBe('viewLog');
  });

  it('offers the requested ordered subset and maps back to keys', async () => {
    window.showWarningMessage.mockResolvedValue(LABELS.refresh);
    const picked = await show('reply.statusNotConfirmed', undefined, ['refresh', 'viewLog']);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      NOTICES['reply.statusNotConfirmed'].text(undefined),
      LABELS.refresh,
      LABELS.viewLog,
    );
    expect(picked).toBe('refresh');
  });

  it('resolves to undefined when dismissed and for a toast without buttons', async () => {
    window.showInformationMessage.mockResolvedValue(undefined);
    expect(await show('draft.prepared', undefined)).toBeUndefined();
    window.showErrorMessage.mockResolvedValue(undefined);
    await notify('control.taskEmpty');
    expect(window.showErrorMessage).toHaveBeenCalledWith(NOTICES['control.taskEmpty'].text(undefined));
  });

  it('reads vscode.window when called, so a replaced member is used', async () => {
    const replacement = vi.fn().mockResolvedValue(LABELS.recheck);
    const saved = window.showWarningMessage;
    window.showWarningMessage = replacement;
    try {
      expect(await show('install.notReady', { message: 'm' })).toBe('recheck');
    } finally {
      window.showWarningMessage = saved;
    }
    expect(replacement).toHaveBeenCalledWith('m', LABELS.recheck);
  });
});

describe('confirm', () => {
  it('is modal with detail and true only for the confirming button', async () => {
    window.showWarningMessage.mockResolvedValue(LABELS.delete);
    expect(await confirm('deleteSession.confirm', { label: 'S' })).toBe(true);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      NOTICES['deleteSession.confirm'].text({ label: 'S' }),
      { modal: true, detail: NOTICES['deleteSession.confirm'].detail?.({ label: 'S' }) },
      LABELS.delete,
    );
    window.showWarningMessage.mockResolvedValue(undefined);
    expect(await confirm('deleteSession.confirm', { label: 'S' })).toBe(false);
  });

  it('omits detail when the entry has none', async () => {
    window.showWarningMessage.mockResolvedValue(LABELS.discardReply);
    expect(await confirm('reply.discardConfirm')).toBe(true);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      NOTICES['reply.discardConfirm'].text(undefined),
      { modal: true },
      LABELS.discardReply,
    );
  });
});

describe('progress', () => {
  it('passes the entry title, location and cancellable flag, and hands the task the reporter and token', async () => {
    const reporter = { report: vi.fn() };
    const token = { isCancellationRequested: true };
    window.withProgress.mockImplementation((_options: unknown, task: (r: unknown, t: unknown) => unknown) =>
      task(reporter, token),
    );
    const seen: unknown[] = [];
    const result = await progress('init.loadingClients', undefined, (r, t) => {
      r.report({ message: 'x' });
      seen.push(r, t);
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(seen).toEqual([reporter, token]);
    expect(reporter.report).toHaveBeenCalledWith({ message: 'x' });
    expect(window.withProgress).toHaveBeenCalledWith(
      { location: 15, title: NOTICES['init.loadingClients'].title(undefined), cancellable: true },
      expect.any(Function),
    );
  });

  it('keeps cancellable unset for a plain entry and uses the window location', async () => {
    window.withProgress.mockImplementation((_options: unknown, task: () => unknown) => task());
    await progress('control.stopping', { label: 'S' }, () => Promise.resolve());
    expect(window.withProgress).toHaveBeenCalledWith({ location: 10, title: NOTICES['control.stopping'].title({ label: 'S' }) }, expect.any(Function));
  });

  it('propagates the task rejection unchanged', async () => {
    const failure = new Error('nope');
    window.withProgress.mockImplementation((_options: unknown, task: () => unknown) => task());
    await expect(progress('init.running', undefined, () => Promise.reject(failure))).rejects.toBe(failure);
  });
});
