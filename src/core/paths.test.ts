import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPath, nextPath, outputsDir, questionsPath, sessionDir } from './paths';

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
