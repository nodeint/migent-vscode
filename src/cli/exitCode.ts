/** What a finished `migent` command means, from its exit code (see plans/03-control.md §1). */
export type RunOutcome =
  | 'Completed'
  | 'NotFinished'
  | 'ConfigError'
  | 'StageFailed'
  | 'RevisionLimit'
  | 'DispatchLimit'
  | 'VerifyExhausted'
  | 'VerifyFailed'
  | 'Quota'
  | 'AwaitingAnswer'
  | 'Cancelled'
  | 'Unknown';

const OUTCOMES: Readonly<Record<number, RunOutcome>> = {
  0: 'Completed',
  1: 'NotFinished',
  2: 'ConfigError',
  3: 'StageFailed',
  4: 'RevisionLimit',
  5: 'DispatchLimit',
  6: 'VerifyExhausted',
  7: 'VerifyFailed',
  8: 'Quota',
  9: 'AwaitingAnswer',
  130: 'Cancelled',
};

/** Exit 9 is a request for input, not a failure. Persisted state still decides what happened. */
export function mapExitCode(code: number | null): RunOutcome {
  if (code === null) return 'Unknown';
  return OUTCOMES[code] ?? 'Unknown';
}

export interface DiagnosticPaths {
  response?: string;
  verify?: string;
}

const DIAGNOSTIC_LINE = /^\s*(?:\[migent\]\s*)?(response|verify):\s*(\S.*?)\s*$/i;

/** The last `response:` and `verify:` paths a command reported on stderr, so the file can be opened. */
export function parseDiagnosticPaths(lines: readonly string[]): DiagnosticPaths {
  const found: DiagnosticPaths = {};
  for (const line of lines) {
    const match = DIAGNOSTIC_LINE.exec(line);
    if (match === null) continue;
    if (match[1].toLowerCase() === 'response') found.response = match[2];
    else found.verify = match[2];
  }
  return found;
}

const SESSION_ID_LINE = /^\s*\[migent\]\s*session_id:\s*(\S+)\s*$/i;

/** The id of the session a command started or resumed, as the CLI reports it on stderr. */
export function parseSessionId(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const match = SESSION_ID_LINE.exec(line);
    if (match !== null) return match[1];
  }
  return undefined;
}

/** Splits a byte stream into complete lines, holding back a trailing partial line until `flush`. */
export class LineBuffer {
  private pending = '';

  public push(chunk: string): string[] {
    const text = this.pending + chunk;
    const parts = text.split(/\r?\n/);
    this.pending = parts.pop() ?? '';
    return parts;
  }

  public flush(): string[] {
    const rest = this.pending;
    this.pending = '';
    return rest.length > 0 ? [rest] : [];
  }
}
