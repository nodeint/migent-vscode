import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sessionContextValue } from '../../core/sessionPresentation';
import { capturedDir, snapshotFromDir } from '../../core/testHelpers';

interface MenuItem {
  command: string;
  when?: string;
  submenu?: string;
}

interface Manifest {
  contributes: { menus: Record<string, MenuItem[]> };
}

const manifest = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as Manifest;
const title = manifest.contributes.menus['editor/title'] ?? [];

/** The pattern a `resourcePath =~ /.../` condition applies, decoded the way VS Code sees it. */
function pathPattern(command: string): RegExp {
  const entry = title.find((item) => item.command === command);
  if (entry?.when === undefined) throw new Error(`No editor title condition for ${command}`);
  return new RegExp(entry.when.slice(entry.when.indexOf('/') + 1, entry.when.lastIndexOf('/')));
}

const STORAGE_WINDOWS = String.raw`C:\Users\kenkz447\AppData\Roaming\Code\User\workspaceStorage\d88f\nodeint.migent-vscode`;
const STORAGE_POSIX = '/Users/kenkz447/Library/Application Support/Code/User/workspaceStorage/d88f/nodeint.migent-vscode';
const DRAFT = '/reply-drafts/4117a76e2bc4edb92919912873eb90f0.md';

const cases = [
  {
    command: 'migent.session.start',
    windows: String.raw`C:\repo\.migent\sessions\s1\task.md`,
    posix: '/repo/.migent/sessions/s1/task.md',
  },
  {
    command: 'migent.workflow.run',
    windows: String.raw`C:\repo\.migent\workflows\review.yaml`,
    posix: '/repo/.migent/workflows/review.yaml',
  },
  {
    command: 'migent.session.sendReply',
    windows: STORAGE_WINDOWS + String.raw`\reply-drafts\4117a76e2bc4edb92919912873eb90f0.md`,
    posix: STORAGE_POSIX + DRAFT,
  },
  {
    command: 'migent.session.discardReply',
    windows: STORAGE_WINDOWS + String.raw`\reply-drafts\4117a76e2bc4edb92919912873eb90f0.md`,
    posix: STORAGE_POSIX + DRAFT,
  },
];

describe('editor title path conditions', () => {
  it.each(cases)('$command matches Windows and POSIX paths', ({ command, windows, posix }) => {
    const pattern = pathPattern(command);
    expect(pattern.test(windows)).toBe(true);
    expect(pattern.test(posix)).toBe(true);
  });

  it('does not offer reply actions for a file outside reply-drafts', () => {
    expect(pathPattern('migent.session.sendReply').test('/repo/src/notes.md')).toBe(false);
  });
});

describe('Complete Session menu entries', () => {
  const { menus } = manifest.contributes;
  const entry = (menus['view/item/context'] ?? []).find((item) => item.command === 'migent.session.complete');

  /** Evaluates the `viewItem =~ /re/` and `!(viewItem =~ /re/)` terms of a `when` clause for one context value. */
  function matches(when: string, viewItem: string): boolean {
    return when.split(' && ').every((term) => {
      const negated = term.startsWith('!(');
      const body = negated ? term.slice(2, -1) : term;
      if (!body.startsWith('viewItem =~ ')) return true;
      const pattern = body.slice(body.indexOf('/') + 1, body.lastIndexOf('/'));
      return new RegExp(pattern).test(viewItem) !== negated;
    });
  }

  it('is in the Sessions view row context menu', () => {
    expect(entry?.when).toContain('view == migent.sessions');
  });

  it.each(['stopped', 'failed', 'cancelled', 'blocked', 'question'])('is offered for a %s workflow session', (state) => {
    expect(matches(entry?.when ?? '', `session.${state}`)).toBe(true);
  });

  it.each(['running', 'completed', 'prepared', 'unknown'])('is not offered for a %s session', (state) => {
    expect(matches(entry?.when ?? '', `session.${state}`)).toBe(false);
  });

  it('is not offered for a role session, using the context value the tree builds', () => {
    const role = sessionContextValue(snapshotFromDir(capturedDir('question-answered')));
    expect(role).toContain(';role');
    expect(matches(entry?.when ?? '', role.replace('session.question', 'session.stopped'))).toBe(false);
  });

  it('is in the session page More Actions submenu and hidden from the Command Palette', () => {
    expect((menus['migent.results.more'] ?? []).some((item) => item.command === 'migent.session.complete')).toBe(true);
    const palette = (menus.commandPalette ?? []).find((item) => item.command === 'migent.session.complete');
    expect(palette?.when).toBe('false');
  });
});
