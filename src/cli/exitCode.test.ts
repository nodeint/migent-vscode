import { EXIT_CATALOG } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import { exitCodeOf, LineBuffer, mapExitCode, parseDiagnosticPaths } from './exitCode';

describe('mapExitCode', () => {
  it('maps each documented exit code to its outcome', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 130].map((code) => mapExitCode(code)),
    ).toEqual([
      'Completed',
      'NotFinished',
      'ConfigError',
      'StageFailed',
      'RevisionLimit',
      'DispatchLimit',
      'VerifyExhausted',
      'VerifyFailed',
      'Quota',
      'AwaitingAnswer',
      'Cancelled',
    ]);
  });

  it('does not invent an outcome for an unknown code or a killed process', () => {
    expect(mapExitCode(42)).toBe('Unknown');
    expect(mapExitCode(null)).toBe('Unknown');
  });
});

describe('exit table against the contract catalog', () => {
  it('knows the code of every upstream exit name and maps none of them to Unknown', () => {
    for (const entry of EXIT_CATALOG) {
      expect(exitCodeOf(entry.name)).toBe(entry.code);
      expect(mapExitCode(entry.code)).not.toBe('Unknown');
    }
  });

  it('rejects a name the catalog does not have, and the authoring conflict is the stage_failed code', () => {
    // @ts-expect-error not an upstream exit name
    expect(() => exitCodeOf('not_an_exit')).toThrow();
    expect(exitCodeOf('stage_failed')).toBe(3);
  });
});

describe('parseDiagnosticPaths', () => {
  it('keeps the last response and verify paths, with or without the log prefix', () => {
    const paths = parseDiagnosticPaths([
      '[migent] session_id: abc',
      'response: executions/0001/response.md',
      '[migent] verify: executions/0001/turns/1/verify.md',
      'response: executions/0002/response.md',
    ]);
    expect(paths).toEqual({
      response: 'executions/0002/response.md',
      verify: 'executions/0001/turns/1/verify.md',
    });
  });

  it('ignores unrelated lines', () => {
    expect(parseDiagnosticPaths(['responded: yes', 'no match'])).toEqual({});
  });
});

describe('LineBuffer', () => {
  it('holds back a partial line until it completes, and handles CRLF', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('one\r\ntw')).toEqual(['one']);
    expect(buffer.push('o\nthree')).toEqual(['two']);
    expect(buffer.flush()).toEqual(['three']);
    expect(buffer.flush()).toEqual([]);
  });
});
