import { describe, expect, it } from 'vitest';

import type { AttentionSummary } from './attention';
import { statusBarModel } from './statusBarText';

function summary(overrides: Partial<AttentionSummary>): AttentionSummary {
  return { running: 0, needsAttention: 0, blocked: 0, failed: 0, asking: 0, pendingQuestions: 0, ...overrides };
}

describe('statusBarModel', () => {
  it('is hidden when nothing runs and nothing needs attention', () => {
    expect(statusBarModel([])).toBeNull();
    expect(statusBarModel([{ name: 'a', summary: summary({}) }])).toBeNull();
  });

  it('shows both parts, summed across projects', () => {
    const model = statusBarModel([
      { name: 'a', summary: summary({ running: 1, needsAttention: 1, failed: 1 }) },
      { name: 'b', summary: summary({ running: 2, needsAttention: 2, blocked: 1, pendingQuestions: 3 }) },
    ]);
    expect(model?.text).toBe('$(sync~spin) Migent: 3 running · 3 needs attention');
    expect(model?.tooltip).toBe(
      'a: 1 running, 1 need attention, 1 failed\nb: 2 running, 2 need attention, 3 pending question(s), 1 blocked',
    );
  });

  it('shows either part alone', () => {
    expect(statusBarModel([{ name: 'a', summary: summary({ running: 2 }) }])?.text).toBe('$(sync~spin) Migent: 2 running');
    const attention = statusBarModel([{ name: 'a', summary: summary({ needsAttention: 1, asking: 1, pendingQuestions: 1 }) }]);
    expect(attention?.text).toBe('$(sync~spin) Migent: 1 needs attention');
    expect(attention?.tooltip).toBe('1 need attention, 1 pending question(s)');
  });
});
