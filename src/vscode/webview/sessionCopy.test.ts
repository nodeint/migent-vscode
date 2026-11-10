import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type Node = string | ((...args: never[]) => unknown) | { [key: string]: Node };

const media = path.join(__dirname, '../../../media');

/** Each Session script, the copy file it reads as `text`, and the global that file defines. */
const PAIRS = [
  { script: 'session', copy: 'sessionCopy', global: 'MigentSessionCopy' },
  { script: 'overview', copy: 'overviewCopy', global: 'MigentSessionOverviewCopy' },
  { script: 'results', copy: 'resultsCopy', global: 'MigentSessionResultsCopy' },
  { script: 'metrics', copy: 'metricsCopy', global: 'MigentSessionMetricsCopy' },
  { script: 'workflow', copy: 'sessionWorkflowCopy', global: 'MigentSessionWorkflowCopy' },
  { script: 'questions', copy: 'questionsCopy', global: 'MigentSessionQuestionsCopy' },
];

function load(file: string, global: string): { [key: string]: Node } {
  const window: Record<string, unknown> = {};
  vm.runInContext(readFileSync(path.join(media, file), 'utf8'), vm.createContext({ window }));
  return window[global] as { [key: string]: Node };
}

function resolve(root: { [key: string]: Node }, keys: string[]): Node | undefined {
  let node: Node | undefined = root;
  for (const key of keys) {
    if (node === undefined || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

describe('MigentUtils', () => {
  it('writes a count with its noun', () => {
    const window: Record<string, unknown> = {};
    vm.runInContext(readFileSync(path.join(media, 'shared/utils.js'), 'utf8'), vm.createContext({ window }));
    const { plural } = window.MigentUtils as { plural: (count: number, noun: string) => string };

    expect(plural(1, 'stage')).toBe('1 stage');
    expect(plural(0, 'stage')).toBe('0 stages');
    expect(plural(2, 'stage')).toBe('2 stages');
  });
});

describe.each(PAIRS)('session copy $copy', ({ script, copy, global }) => {
  const text = load(`session/${copy}.js`, global);

  it(`only uses a key that exists in ${copy}.js`, () => {
    const source = readFileSync(path.join(media, `session/${script}.js`), 'utf8');
    const used = [...source.matchAll(/(?<![\w.])text\.([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)/g)].map((match) => match[1].split('.'));

    expect(used.length).toBeGreaterThan(0);
    for (const keys of used) {
      expect(resolve(text, keys), `text.${keys.join('.')}`).not.toBeUndefined();
    }
  });

  it('has no empty text and no function that returns a non-string', () => {
    const walk = (node: Node, where: string): void => {
      if (typeof node === 'string') {
        expect(node.length, where).toBeGreaterThan(0);
      } else if (typeof node === 'function') {
        expect(typeof (node as (...args: unknown[]) => unknown)(['a'], ['b'], ['c'], ['d']), where).toBe('string');
      } else {
        for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`);
      }
    };
    walk(text, 'text');
  });
});
