import { describe, expect, it } from 'vitest';

import { LineBuffer, mapExitCode, parseDiagnosticPaths } from './exitCode';

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
