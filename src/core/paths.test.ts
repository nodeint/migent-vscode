import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPath, nextPath, outputsDir, questionsPath, resolveWithin, sessionDir } from './paths';

describe('paths', () => {
  it('resolves a session directory under .migent/sessions', () => {
    expect(sessionDir('/p', 's1')).toBe(path.join('/p', '.migent', 'sessions', 's1'));
  });

  it('resolves the S1 file and directory names', () => {
    const session = path.join('/p', '.migent', 'sessions', 's1');
    expect(configPath('/p')).toBe(path.join('/p', '.migent', 'config.yaml'));
    expect(questionsPath('/p', 's1')).toBe(path.join(session, 'questions.json'));
    expect(nextPath('/p', 's1')).toBe(path.join(session, 'next.json'));
    expect(outputsDir('/p', 's1')).toBe(path.join(session, 'outputs'));
  });
});

describe('resolveWithin', () => {
  const base = path.resolve('/p', '.migent', 'sessions', 's1');

  it('resolves relative paths that stay inside the base', () => {
    expect(resolveWithin(base, 'outputs/note.md')).toBe(path.join(base, 'outputs', 'note.md'));
    expect(resolveWithin(base, 'outputs/../handoff/1/a.md')).toBe(path.join(base, 'handoff', '1', 'a.md'));
    expect(resolveWithin(base, '..hidden.md')).toBe(path.join(base, '..hidden.md'));
  });

  it('rejects empty, absolute, drive-letter and escaping paths', () => {
    expect(resolveWithin(base, '')).toBeNull();
    expect(resolveWithin(base, '.')).toBeNull();
    expect(resolveWithin(base, '..')).toBeNull();
    expect(resolveWithin(base, '../s2/status.json')).toBeNull();
    expect(resolveWithin(base, 'outputs/../../s2/status.json')).toBeNull();
    expect(resolveWithin(base, path.resolve('/etc/passwd'))).toBeNull();
    expect(resolveWithin(base, 'C:\\secret.txt')).toBeNull();
  });
});
