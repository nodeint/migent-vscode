import { describe, expect, it } from 'vitest';

import { DraftStore } from './drafts';
import { type BatchIdentity, Entry } from './entry';

const identity: BatchIdentity = { project: 'p', sessionId: 's', stageId: 'plan', executionId: '0001-plan--attempt-01' };

/** A workspace-state stand-in whose writes can be made to fail. */
function memento(failing: { value: boolean }) {
  const data = new Map<string, unknown>();
  return {
    data,
    keys: () => [...data.keys()],
    get: (key: string) => data.get(key),
    update: (key: string, value: unknown): Promise<void> => {
      if (failing.value) return Promise.reject(new Error('disk full'));
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

function entry(save: (target: Entry) => Promise<void>): Entry {
  const panel = {} as unknown as ConstructorParameters<typeof Entry>[0]['panel'];
  return new Entry({ identity, panel, questions: [], draft: {} }, save, () => undefined);
}

describe('DraftStore', () => {
  it('reports a failed write and settles only when every write finished', async () => {
    const failing = { value: false };
    const store = new DraftStore(memento(failing));
    await store.save(identity, { fingerprint: 'f', questions: [], draft: {} });
    expect(store.load(identity)?.fingerprint).toBe('f');
    failing.value = true;
    const write = store.save(identity, { fingerprint: 'g', questions: [], draft: {} });
    await expect(write).rejects.toThrow('disk full');
    await expect(store.settle()).resolves.toBeUndefined();
    expect(store.load(identity)?.fingerprint).toBe('f');
    await expect(store.saveArchive(identity, { fingerprint: 'h', questions: [], draft: {} })).rejects.toThrow('disk full');
  });
});

describe('Entry draft persistence', () => {
  it('keeps an unsaved draft in memory and reports the failure from flush', async () => {
    const failing = { value: true };
    const target = entry(() => (failing.value ? Promise.reject(new Error('disk full')) : Promise.resolve()));
    target.questions = [
      {
        id: '1',
        question: 'Q?',
        context: 'c',
        selection: 'single',
        options: [],
        recommended: [],
        executionId: identity.executionId,
        stageId: 'plan',
        recipient: 'human',
        file: null,
      },
    ];
    target.setDraft('1', { mode: 'choice', selected: ['A'], text: '' });
    await expect(target.flush()).resolves.toBe('disk full');
    expect(target.saveError).toBe('disk full');
    expect(target.draft['1']?.selected).toEqual(['A']);
    // Still unsaved: the next flush retries and succeeds once storage recovers.
    failing.value = false;
    await expect(target.flush()).resolves.toBeNull();
    expect(target.saveError).toBeNull();
  });

  it('does not mark a newer edit durable when an older save finishes', async () => {
    const stored: string[] = [];
    const releases: (() => void)[] = [];
    const target = entry((saving) => {
      const snapshot = JSON.stringify(saving.draft);
      return new Promise<void>((resolve) => {
        releases.push(() => {
          stored.push(snapshot);
          resolve();
        });
      });
    });
    target.questions = [];
    target.setDraft('1', { mode: 'choice', selected: ['A'], text: '' });
    const first = target.persist();
    target.setDraft('1', { mode: 'choice', selected: ['B'], text: '' });
    releases[0]?.();
    await first;
    expect(target.isUnsaved).toBe(true);
    const flushed = target.flush();
    await Promise.resolve();
    releases[1]?.();
    await expect(flushed).resolves.toBeNull();
    expect(stored).toHaveLength(2);
    expect(stored[1]).toContain('"B"');
    expect(target.isUnsaved).toBe(false);
  });

  it('does not write when nothing changed', async () => {
    let writes = 0;
    const target = entry(() => {
      writes += 1;
      return Promise.resolve();
    });
    await target.flush();
    expect(writes).toBe(0);
  });
});
