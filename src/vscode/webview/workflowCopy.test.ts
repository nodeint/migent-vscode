import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type Node = string | ((...args: never[]) => unknown) | { [key: string]: Node };

const dir = path.join(__dirname, '../../../media/workfloweditor');

function loadCopy(): { [key: string]: Node } {
  const window: Record<string, unknown> = {};
  vm.runInContext(readFileSync(path.join(dir, 'workflowcopy.js'), 'utf8'), vm.createContext({ window }));
  return window.MigentWorkflowCopy as { [key: string]: Node };
}

function resolve(root: { [key: string]: Node }, keys: string[]): Node | undefined {
  let node: Node | undefined = root;
  for (const key of keys) {
    if (node === undefined || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

describe('workflow form copy', () => {
  const copy = loadCopy();

  it('only uses a key that exists in workflowcopy.js', () => {
    const source = readFileSync(path.join(dir, 'workflowform.js'), 'utf8');
    const used = [...source.matchAll(/\btext\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)].map((match) => match[1].split('.'));

    expect(used.length).toBeGreaterThan(50);
    for (const keys of used) {
      expect(resolve(copy, keys), `text.${keys.join('.')}`).not.toBeUndefined();
    }
  });

  it('has no empty text and no stray function', () => {
    const walk = (node: Node, where: string): void => {
      if (typeof node === 'string') {
        expect(node.length, where).toBeGreaterThan(0);
      } else if (typeof node === 'function') {
        expect(typeof (node as (...args: unknown[]) => unknown)(1, 2, 3), where).toBe('string');
      } else {
        for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`);
      }
    };
    walk(copy, 'text');
  });

  it('builds a text with a value as a function', () => {
    const stages = copy.stages as { [key: string]: Node };
    expect((stages.move as (a: string, b: number, c: string) => string)('stage', 2, 'up')).toBe('Move stage 2 up');
    expect((stages.untitled as (n: number) => string)(3)).toBe('untitled stage 3');
    const advanced = stages.advancedFacts as { [key: string]: (n: number) => string };
    expect(advanced.verifyCommands(1)).toBe('1 verify command');
    expect(advanced.verifyCommands(2)).toBe('2 verify commands');
  });
});
