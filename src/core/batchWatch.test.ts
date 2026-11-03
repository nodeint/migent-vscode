import { describe, expect, it } from 'vitest';

import { BatchWatch } from './batchWatch';
import type { PendingQuestion, SessionSnapshot } from './model';

const question = (id: string, executionId: string): PendingQuestion => ({
  id,
  question: 'Q?',
  context: null,
  selection: 'single',
  options: [],
  recommended: [],
  executionId,
  stageId: 'plan',
  recipient: 'human',
  file: null,
});

function snapshot(...questions: PendingQuestion[]): SessionSnapshot {
  // Only the status questions matter to the watch.
  return { sessionId: 's1', status: { questions } } as unknown as SessionSnapshot;
}

describe('BatchWatch', () => {
  it('stays silent for batches seen while seeding, then reports a new batch once', () => {
    const watch = new BatchWatch();
    expect(watch.observe('p', snapshot(question('1', 'e1')), true)).toEqual([]);
    expect(watch.observe('p', snapshot(question('1', 'e1')), false)).toEqual([]);
    const fresh = watch.observe('p', snapshot(question('1', 'e2'), question('2', 'e2')), false);
    expect(fresh).toEqual([{ sessionId: 's1', stageId: 'plan', executionId: 'e2', count: 2 }]);
    // A file event repeating the same batch does not notify again.
    expect(watch.observe('p', snapshot(question('1', 'e2'), question('2', 'e2')), false)).toEqual([]);
  });

  it('keeps projects apart', () => {
    const watch = new BatchWatch();
    watch.observe('a', snapshot(question('1', 'e1')), true);
    expect(watch.observe('b', snapshot(question('1', 'e1')), false)).toHaveLength(1);
  });
});
