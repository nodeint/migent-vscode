import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  QuickPickItemKind: { Separator: -1 },
  ThemeIcon: class {},
  window: { createQuickPick: vi.fn() },
}));

const { modelItems } = await import('./modelPicker');

describe('modelItems', () => {
  it('groups every client and puts its default model first', () => {
    const items = modelItems([
      { id: 'grok', models: ['grok-4', 'grok-4.7'], defaultModel: 'grok-4.7' },
      { id: 'codex', models: ['gpt-5'] },
    ]);

    expect(items.filter((item) => item.kind !== undefined).map((item) => item.label)).toEqual(['grok', 'codex']);
    expect(items.filter((item) => item.model !== undefined).map((item) => `${item.label}|${item.description ?? ''}`)).toEqual([
      'grok-4.7|default',
      'grok-4|',
      'gpt-5|',
    ]);
    expect(items.find((item) => item.label === 'grok-4.7')?.model).toEqual({ client: 'grok', model: 'grok-4.7' });
  });
});
