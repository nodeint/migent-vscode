import { describe, expect, it } from 'vitest';

import { BatchWatch } from './batchWatch';
import type { SessionSnapshot } from './model';

function snapshot(): SessionSnapshot {
  return { sessionId: 's1', status: { session_id: 's1', status: 'active' } } as unknown as SessionSnapshot;
}

// B6: status.json no longer lists pending questions in contracts 0.8.0, so the watch has no source and no batch.
describe('BatchWatch', () => {
  it('reports no batch while the pending-question source is empty, seeding or not', () => {
    const watch = new BatchWatch();
    expect(watch.observe('p', snapshot(), true)).toEqual([]);
    expect(watch.observe('p', snapshot(), false)).toEqual([]);
  });

  it('keeps projects apart and tolerates a missing snapshot', () => {
    const watch = new BatchWatch();
    expect(watch.observe('a', snapshot(), true)).toEqual([]);
    expect(watch.observe('b', undefined, false)).toEqual([]);
  });
});
