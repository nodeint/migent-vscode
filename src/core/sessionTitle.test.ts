import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeRenameTitle, parseTitleRecord, readTitleOverride, validateRenameTitle } from './sessionTitle';

describe('parseTitleRecord', () => {
  it('reads the title and ignores history', () => {
    expect(parseTitleRecord('{"title":"New","updated_at":"t","history":[{"title":"Old"}]}')).toBe('New');
  });

  it.each(['', 'not json', '[]', '{}', '{"title":3}', '{"title":""}', '{"title":"   "}', '{"title":"a\\nb"}'])(
    'is null for %j',
    (text) => {
      expect(parseTitleRecord(text)).toBeNull();
    },
  );
});

describe('readTitleOverride', () => {
  it('is null for a missing file and the title for a valid one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-title-'));
    try {
      const file = path.join(dir, 'title.json');
      expect(readTitleOverride(file)).toBeNull();
      writeFileSync(file, '{"title":"Hello"}');
      expect(readTitleOverride(file)).toBe('Hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rename title validation', () => {
  it('rejects a line break in the raw value even when trimming would remove it', () => {
    expect(validateRenameTitle('Title\n')).not.toBeNull();
    expect(validateRenameTitle('a\r\nb')).not.toBeNull();
    expect(normalizeRenameTitle('Title\n')).toBeNull();
  });

  it('rejects empty and whitespace-only input and trims the rest', () => {
    expect(validateRenameTitle('')).not.toBeNull();
    expect(validateRenameTitle('   ')).not.toBeNull();
    expect(validateRenameTitle(' Fine ')).toBeNull();
    expect(normalizeRenameTitle('  Fine ')).toBe('Fine');
  });
});
