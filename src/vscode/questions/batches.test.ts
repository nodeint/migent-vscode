import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { showWarningMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));

import type { SessionSnapshot } from '../../core/model';
import type { AnswerSubmitter } from '../answers';
import type { ControlService } from '../control';
import type { BatchIdentity } from './entry';

const { QuestionBatches } = await import('./batches');

const identity: BatchIdentity = { project: 'k', sessionId: 's1', stageId: 'plan', executionId: 'e1' };

function question(id: string, executionId: string, stageId: string) {
  return {
    id,
    question: `Question ${id}`,
    context: null,
    selection: 'single',
    options: [{ id: 'A', label: 'A', description: null }],
    recommended: [],
    executionId,
    stageId,
    recipient: 'human',
    file: null,
  };
}

const QUESTIONS = [question('1', 'e1', 'plan'), question('2', 'e2', 'review')];

function setup() {
  const snapshot = {
    sessionId: 's1',
    manifest: { title: 'Session', workflowId: 'wf' },
    status: { workflowId: 'wf', questions: QUESTIONS, runningStages: [], outputs: [] },
    displayState: { state: 'question', icon: '', writable: true },
    titleOverride: null,
    replyTargets: [],
  } as unknown as SessionSnapshot;
  const context = { key: 'k', root: '/tmp/batches', store: { snapshot: () => snapshot } };
  const registry = { project: () => context, onDidChange: () => ({ dispose: () => undefined }) };
  const control = { showLog: vi.fn(), answerBlock: () => null, continueSession: vi.fn() } as unknown as ControlService;
  const submitter = { pending: () => null } as unknown as AnswerSubmitter;
  const data = new Map<string, unknown>();
  const memento = {
    get: (key: string) => data.get(key),
    update: (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
  return {
    batches: new QuestionBatches(registry as never, { control, submitter }, memento as never),
    data,
  };
}

const surface = () => ({ post: vi.fn(), close: vi.fn() });

function edit(model: { generation: number; fingerprint: string }, value: string, questionId = '1') {
  return {
    type: 'edit',
    generation: model.generation,
    fingerprint: model.fingerprint,
    questionId,
    draft: { mode: 'choice', selected: [value], text: '' },
  };
}

describe('QuestionBatches', () => {
  it('runs the session command of a header action for the batch session', async () => {
    const { batches } = setup();
    batches.attach(identity, surface());
    const execute = vi.mocked((await import('vscode')).commands.executeCommand);
    execute.mockClear();
    await batches.handle(identity, { type: 'sessionAction', action: 'copyId' });
    expect(execute).toHaveBeenCalledWith('migent.session.copyId', {
      project: identity.project,
      sessionId: identity.sessionId,
    });
  });

  it('posts the selected batch and updates it from an edit', async () => {
    const { batches } = setup();
    const target = surface();
    batches.attach(identity, target);
    const first = batches.lastModel(identity);
    expect(first?.questions.map((item) => item.id)).toEqual(['1']);
    expect(target.post).toHaveBeenCalledTimes(1);

    await batches.handle(identity, edit(first ?? { generation: 0, fingerprint: '' }, 'A'));
    const edited = batches.lastModel(identity);
    expect(edited?.draft['1']?.selected).toEqual(['A']);
    expect(target.post).toHaveBeenCalledTimes(2);
  });

  it('keeps a detached batch and republishes it on the next attach', async () => {
    const { batches } = setup();
    const target = surface();
    batches.attach(identity, target);
    await batches.handle(identity, edit(batches.lastModel(identity) ?? { generation: 0, fingerprint: '' }, 'A'));
    batches.detach(identity);

    const posted = target.post.mock.calls.length;
    await batches.handle(identity, edit(batches.lastModel(identity) ?? { generation: 0, fingerprint: '' }, 'B'));
    expect(target.post.mock.calls.length).toBe(posted);
    expect(batches.lastModel(identity)?.draft['1']?.selected).toEqual(['B']);

    const next = surface();
    batches.attach(identity, next);
    expect(next.post).toHaveBeenCalledTimes(1);
    expect(next.post.mock.calls[0]?.[0].draft['1'].selected).toEqual(['B']);
  });

  it('keeps batches of one session independent', async () => {
    const { batches } = setup();
    const plan = surface();
    const review = surface();
    const other: BatchIdentity = { ...identity, stageId: 'review', executionId: 'e2' };
    batches.attach(identity, plan);
    batches.attach(other, review);

    await batches.handle(identity, edit(batches.lastModel(identity) ?? { generation: 0, fingerprint: '' }, 'A'));
    expect(batches.lastModel(other)?.draft['2']).toBeUndefined();
    expect(batches.lastModel(other)?.questions.map((item) => item.id)).toEqual(['2']);
  });

  it('flushes a draft to workspace storage and drops the batch on release', async () => {
    const { batches, data } = setup();
    batches.attach(identity, surface());
    await batches.handle(identity, edit(batches.lastModel(identity) ?? { generation: 0, fingerprint: '' }, 'A'));
    await batches.release(identity);
    expect(batches.has(identity)).toBe(false);
    expect([...data.keys()].some((key) => key.startsWith('migent.answerDraft:'))).toBe(true);
  });
});
