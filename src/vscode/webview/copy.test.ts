import { readdirSync,readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

interface Copy {
  tab: Record<string, string>;
  menu: Record<string, string>;
  file: Record<string, string>;
  sessionUnavailable: { title: string; body: (sessionId: string) => string };
  remove: (item: string, number: number) => string;
}

const media = path.join(__dirname, '../../../media');

function loadCopy(): Copy {
  const window: Record<string, unknown> = {};
  vm.runInContext(readFileSync(path.join(media, 'shared/copy.js'), 'utf8'), vm.createContext({ window }));
  return window.MigentCopy as Copy;
}

describe('shared copy', () => {
  const copy = loadCopy();

  it('names every session page tab', () => {
    expect(Object.keys(copy.tab)).toEqual(['questions', 'overview', 'metrics', 'workflow', 'task']);
    expect(Object.values(copy.tab).every((label) => label.length > 0)).toBe(true);
  });

  it('builds a text with a value as a function, not by concatenation at the call site', () => {
    expect(copy.remove('stage', 2)).toBe('Remove stage 2');
    expect(copy.sessionUnavailable.body('abc')).toContain('abc');
  });

  it('is the one place the session menu and the file-state suffixes are written', () => {
    const wanted = [copy.menu.viewLog, copy.menu.revealInExplorer, copy.menu.reloadFromDisk, copy.file.missing];
    const pages = readdirSync(media, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
      .flatMap((entry) =>
        readdirSync(path.join(media, entry.name))
          .filter((name) => name.endsWith('.js'))
          .map((name) => path.join(media, entry.name, name)),
      );

    for (const file of pages) {
      const source = readFileSync(file, 'utf8');
      for (const text of wanted) expect(source, `${path.basename(file)} repeats "${text}"`).not.toContain(`'${text}'`);
    }
  });
});
