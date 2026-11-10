import type { EXIT_CATALOG } from '@nodeint/migent-contracts';

import type { Expect, SameKeys } from '../core/contractDraft';

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

type CatalogEntry = (typeof EXIT_CATALOG)[number];
/** Each upstream `(code, name)` pair as a union member, so a code cannot be paired with another code's name. */
type PairOf<Entry> = Entry extends { code: infer Code; name: infer Name } ? { code: Code; name: Name } : never;
type CatalogPair = PairOf<CatalogEntry>;
type UpstreamExitName = CatalogEntry['name'];

/**
 * The one place where upstream exit names become the extension's `RunOutcome`. Every row must be a pair from the
 * contract's `EXIT_CATALOG`, and the rows must name every catalog entry, or typecheck fails.
 */
const EXIT_TABLE = [
  { code: 0, name: 'completed', outcome: 'Completed' },
  { code: 1, name: 'blocked', outcome: 'NotFinished' },
  { code: 2, name: 'config', outcome: 'ConfigError' },
  { code: 3, name: 'stage_failed', outcome: 'StageFailed' },
  { code: 4, name: 'revisions_exhausted', outcome: 'RevisionLimit' },
  { code: 5, name: 'dispatch_limit', outcome: 'DispatchLimit' },
  { code: 6, name: 'verify_exhausted', outcome: 'VerifyExhausted' },
  { code: 7, name: 'verify_failed', outcome: 'VerifyFailed' },
  { code: 8, name: 'quota', outcome: 'Quota' },
  { code: 9, name: 'question', outcome: 'AwaitingAnswer' },
  { code: 130, name: 'cancelled', outcome: 'Cancelled' },
] as const satisfies readonly (CatalogPair & { outcome: RunOutcome })[];

export type ExitTableCoversCatalog = Expect<SameKeys<(typeof EXIT_TABLE)[number]['name'], UpstreamExitName>>;

const OUTCOMES: ReadonlyMap<number, RunOutcome> = new Map(EXIT_TABLE.map((row) => [row.code, row.outcome]));

/** The process exit code the CLI uses for an upstream exit name. Family meaning stays with each caller. */
export function exitCodeOf(name: UpstreamExitName): number {
  const row = EXIT_TABLE.find((entry) => entry.name === name);
  if (row === undefined) throw new Error(`Unknown exit name: ${name}`);
  return row.code;
}

/** Exit 9 is a request for input, not a failure. Persisted state still decides what happened. */
export function mapExitCode(code: number | null): RunOutcome {
  if (code === null) return 'Unknown';
  return OUTCOMES.get(code) ?? 'Unknown';
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
