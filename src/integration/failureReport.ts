import * as fs from 'node:fs';

import * as vscode from 'vscode';

interface Failure {
  type: string;
  suite: string;
  name: string;
  message: string;
  stack?: string;
}

const failures: Failure[] = [];
const JSON_INDENT = 2;
let suite = 'startup';

export function setFailureSuite(name: string): void {
  suite = name;
}

export function recordFailure(type: string, name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  failures.push({ type, suite, name, message, ...(stack ? { stack } : {}) });
  const report = process.env.MIGENT_IT_FAILURE_REPORT;
  if (report) {
    fs.writeFileSync(report, JSON.stringify({ vscodeVersion: vscode.version, status: 'failed', failures }, null, JSON_INDENT));
  }
}
