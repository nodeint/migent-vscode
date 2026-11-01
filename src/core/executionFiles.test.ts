import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listExecutionFiles } from './executionFiles';
import { capturedDir } from './testHelpers';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempExecution(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-exec-'));
  temps.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

describe('listExecutionFiles', () => {
  it('lists the execution questions.json of the captured question-pending sample, and omits absent files', () => {
    const dir = path.join(capturedDir('question-pending'), 'executions', '0001-planner--attempt-01');
    const listing = listExecutionFiles(dir);
    expect(listing.state).toBe('ok');
    // execution.json is the summary source, not a listed file; no prompt/response exist in the sample.
    expect(listing.files.map((file) => [file.kind, file.relativePath])).toEqual([['questions', 'questions.json']]);
  });

  it('reports no questions.json for the answered execution that has none', () => {
    const dir = path.join(capturedDir('question-answered'), 'executions', '0002-planner--attempt-02');
    expect(listExecutionFiles(dir).files).toEqual([]);
  });

  it('lists fixed files, verify files by turn number, and artifacts', () => {
    const dir = tempExecution({
      'execution.json': '{}',
      'prompt.md': 'p',
      'response.md': 'r',
      'turns/turn-10/verify.md': 'v',
      'turns/turn-2/verify.md': 'v',
      'turns/turn-3/notes.md': 'no verify here',
      'artifacts/b.txt': 'b',
      'artifacts/a.txt': 'a',
    });
    const listing = listExecutionFiles(dir);
    expect(listing.files.map((file) => [file.kind, file.relativePath, file.turn])).toEqual([
      ['prompt', 'prompt.md', null],
      ['response', 'response.md', null],
      ['verify', 'turns/turn-2/verify.md', 2],
      ['verify', 'turns/turn-10/verify.md', 10],
      ['artifact', 'artifacts/a.txt', null],
      ['artifact', 'artifacts/b.txt', null],
    ]);
    expect(listing.files[2]?.absolutePath).toBe(path.join(dir, 'turns', 'turn-2', 'verify.md'));
  });

  it('distinguishes a missing execution directory; an absent artifacts directory is normal', () => {
    expect(listExecutionFiles(path.join(os.tmpdir(), 'migent-vscode-no-such-dir')).state).toBe('missing');
    const dir = tempExecution({ 'prompt.md': 'p' });
    expect(listExecutionFiles(dir)).toMatchObject({ state: 'ok', artifactsError: null });
  });
});
