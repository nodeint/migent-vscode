import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingQuestion, SessionSnapshot } from '../core/model';
import { LABELS, NOTICES } from '../text/notices';

const hoisted = vi.hoisted(() => ({
  enabled: new Map<string, boolean>(),
  window: { showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));
vi.mock('vscode', () => ({
  window: hoisted.window,
  commands: hoisted.commands,
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback: boolean) => hoisted.enabled.get(key) ?? fallback }),
  },
}));

const { QuestionNotifier } = await import('./questionNotifier');
const { window, commands } = hoisted;

const question = (id: string, executionId: string, stageId: string | null = 'plan'): PendingQuestion => ({
  id,
  question: 'q',
  context: null,
  selection: null,
  options: [],
  recommended: [],
  executionId,
  stageId,
  recipient: 'human',
  file: null,
});

function snapshot(questions: PendingQuestion[], id = 's1'): SessionSnapshot {
  return { sessionId: id, manifest: null, status: { questions }, titleOverride: 'T' } as unknown as SessionSnapshot;
}

let listener: (change: unknown) => void = () => undefined;
const snapshots = new Map<string, SessionSnapshot>();
const context = {
  key: 'p',
  folder: { uri: {} },
  store: { all: () => [...snapshots.values()], snapshot: (id: string) => snapshots.get(id) },
};
const registry = {
  isLoaded: true,
  onDidChange: (fn: (change: unknown) => void) => {
    listener = fn;
    return { dispose: () => undefined };
  },
  projects: () => [context],
  project: () => context,
};
const change = (sessionId = 's1') => ({ type: 'session', project: 'p', sessionId, kind: 'updated' });

let notifier: InstanceType<typeof QuestionNotifier>;
beforeEach(() => {
  snapshots.clear();
  hoisted.enabled.clear();
  for (const fn of [...Object.values(window), commands.executeCommand]) fn.mockReset();
  window.showInformationMessage.mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  notifier.dispose();
});

function start(initial?: SessionSnapshot): void {
  if (initial !== undefined) snapshots.set(initial.sessionId, initial);
  notifier = new QuestionNotifier(registry as never);
  listener({ type: 'refresh' });
}

describe('QuestionNotifier', () => {
  it('seeds silently, then notifies each fresh batch once', () => {
    start(snapshot([question('1', '0001-plan--attempt-01')]));
    listener(change());
    expect(window.showInformationMessage).not.toHaveBeenCalled();
    snapshots.set('s1', snapshot([question('1', '0002-plan--attempt-02'), question('2', '0002-plan--attempt-02')]));
    listener(change());
    listener(change());
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      NOTICES['notify.questions'].text({ label: 'T', stage: 'plan', count: 2 }),
      LABELS.answerQuestions,
    );
  });

  it('notifies several batches of one session independently, without a gate', () => {
    start(snapshot([]));
    snapshots.set(
      's1',
      snapshot([question('1', '0002-a--attempt-01', 'a'), question('1', '0003-b--attempt-01', 'b')]),
    );
    listener(change());
    expect(window.showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it('opens the batch it announced', async () => {
    start(snapshot([]));
    window.showInformationMessage.mockResolvedValueOnce(LABELS.answerQuestions);
    snapshots.set('s1', snapshot([question('1', '0002-plan--attempt-02')]));
    listener(change());
    await Promise.resolve();
    await Promise.resolve();
    expect(commands.executeCommand).toHaveBeenCalledWith('migent.session.open', {
      project: 'p',
      sessionId: 's1',
      tab: 'questions',
      stageId: 'plan',
      executionId: '0002-plan--attempt-02',
    });
  });

  it('is suppressed by a disabled setting', () => {
    start(snapshot([]));
    hoisted.enabled.set('question', false);
    snapshots.set('s1', snapshot([question('1', '0002-plan--attempt-02')]));
    listener(change());
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
