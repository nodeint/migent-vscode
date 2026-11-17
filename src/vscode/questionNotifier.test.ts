import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuestionBase, SessionSnapshot } from '../core/model';

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

const question = (id: string, executionId: string, stageId: string | null = 'plan'): QuestionBase => ({
  id,
  question: 'q',
  context: null,
  selection: null,
  options: [],
  recommended: [],
  executionId,
  stageId,
  recipient: 'human',
});

function snapshot(questions: QuestionBase[], id = 's1'): SessionSnapshot {
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

// B6: the contract's status file declares no questions, so the extension reads none from it and a status that carries
// them yields no pending batch. Until questions come from another source, this notifier has nothing to announce.
describe('QuestionNotifier', () => {
  it('does not notify for questions a status file carries, at seed or on a later change (B6)', () => {
    start(snapshot([question('1', '0001-plan--attempt-01')]));
    listener(change());
    snapshots.set('s1', snapshot([question('1', '0002-plan--attempt-02'), question('2', '0002-plan--attempt-02')]));
    listener(change());
    listener(change());
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does not notify for several batches of one session (B6)', () => {
    start(snapshot([]));
    snapshots.set(
      's1',
      snapshot([question('1', '0002-a--attempt-01', 'a'), question('1', '0003-b--attempt-01', 'b')]),
    );
    listener(change());
    expect(window.showInformationMessage).not.toHaveBeenCalled();
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it('stays silent with the setting enabled or disabled (B6)', () => {
    start(snapshot([]));
    snapshots.set('s1', snapshot([question('1', '0002-plan--attempt-02')]));
    hoisted.enabled.set('question', true);
    listener(change());
    hoisted.enabled.set('question', false);
    listener(change());
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
