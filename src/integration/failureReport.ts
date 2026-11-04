import * as fs from 'node:fs';
import { SourceMap } from 'node:module';
import * as path from 'node:path';

import * as vscode from 'vscode';

export interface Failure {
  type: string;
  suite: string;
  name: string;
  message: string;
  /** `src/...:line:col` of the first test-code frame in the stack, when the stack has one. */
  location?: string;
  stack?: string;
}

const failures: Failure[] = [];
const JSON_INDENT = 2;
let suite = 'startup';

export function setFailureSuite(name: string): void {
  suite = name;
}

export function failureCount(): number {
  return failures.length;
}

/** Test code outranks harness code, which outranks product code, so the location names the failing check. */
const FRAME_PREFERENCE = [
  /[\\/]src[\\/]integration[\\/][^\\/:()]*\.integration\.test\.ts:\d+:\d+/,
  /[\\/]src[\\/][^:()]+\.ts:\d+:\d+/,
];

export function locationOf(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  for (const pattern of FRAME_PREFERENCE) {
    const match = pattern.exec(stack);
    if (match) return match[0].replace(/^.*?([\\/]src[\\/])/, 'src/').replaceAll('\\', '/');
  }
  return undefined;
}

let sourceMap: SourceMap | null | undefined;
type SourceMapPayload = ConstructorParameters<typeof SourceMap>[0];

function isPayload(value: unknown): value is SourceMapPayload {
  return typeof value === 'object' && value !== null && 'mappings' in value && 'sources' in value;
}

function loadSourceMap(): SourceMap | null {
  if (sourceMap !== undefined) return sourceMap;
  try {
    const payload: unknown = JSON.parse(fs.readFileSync(`${__filename}.map`, 'utf8'));
    sourceMap = isPayload(payload) ? new SourceMap(payload) : null;
  } catch {
    sourceMap = null;
  }
  return sourceMap;
}

const slashes = (file: string): string => file.replaceAll('\\', '/');

/** Map one `file:line:column` frame of the bundle to its TypeScript source; other frames are kept. */
function mapFrame(map: SourceMap, [frame = '', file = '', line = '', column = '']: string[]): string {
  if (slashes(file) !== slashes(__filename)) return frame;
  const entry = map.findEntry(Number(line) - 1, Number(column) - 1);
  if (!('originalSource' in entry)) return frame;
  const source = path.resolve(path.dirname(__filename), entry.originalSource);
  return `${source}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
}

/**
 * Point bundle frames (`dist-test/integration/index.js:L:C`) back at the TypeScript source. The extension host
 * installs its own stack formatter, so Node's `--enable-source-maps` has no effect here.
 */
export function mapStack(stack: string): string {
  const map = loadSourceMap();
  if (map === null) return stack;
  return stack.replaceAll(/([^\s()]+):(\d+):(\d+)/g, (...match: string[]) => mapFrame(map, match),
  );
}

export function recordFailure(type: string, name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack !== undefined ? mapStack(error.stack) : undefined;
  const location = locationOf(stack);
  failures.push({ type, suite, name, message, ...(location ? { location } : {}), ...(stack ? { stack } : {}) });
  const report = process.env.MIGENT_IT_FAILURE_REPORT;
  if (report) {
    fs.writeFileSync(report, JSON.stringify({ vscodeVersion: vscode.version, status: 'failed', failures }, null, JSON_INDENT));
  }
}

/** One readable block per failed case: where it ran, what failed and the test line that failed. */
export function formatFailures(items: readonly Failure[] = failures): string {
  return items.map(formatFailure).join('\n');
}

function formatFailure(item: Failure, index: number): string {
  const lines = [`${index + 1}) [${item.suite}] ${item.name}`, `   ${item.message.replaceAll('\n', '\n   ')}`];
  if (item.location) lines.push(`   at ${item.location}`);
  return lines.join('\n');
}
