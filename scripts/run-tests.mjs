import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { formatVitestFailures } from './test-failures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-test');
const reportPath = join(outDir, 'unit-vitest.json');
const logPath = join(outDir, 'unit-test.log');
mkdirSync(outDir, { recursive: true });
rmSync(reportPath, { force: true });

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const vitest = run([join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', `--outputFile=${reportPath}`, '--silent=passed-only']);
if (vitest.status !== 0) {
  const raw = `${vitest.stdout ?? ''}${vitest.stderr ?? ''}${vitest.error ?? ''}`;
  writeFileSync(logPath, raw);
  let summary = '';
  try {
    summary = formatVitestFailures(JSON.parse(readFileSync(reportPath, 'utf8')));
  } catch {
    // Startup errors may prevent Vitest from writing a report.
  }
  console.error(summary || raw || `Vitest terminated by ${vitest.signal ?? 'an unknown error'}`);
  console.error(`Full test log: ${logPath}`);
  process.exit(vitest.status || 1);
}

const reporter = pathToFileURL(join(root, 'scripts', 'node-failure-reporter.mjs')).href;
const nodeTests = run(['--test', `--test-reporter=${reporter}`, 'scripts/*.test.mjs']);
if (nodeTests.status !== 0) {
  const raw = `${nodeTests.stdout ?? ''}${nodeTests.stderr ?? ''}${nodeTests.error ?? ''}`;
  writeFileSync(logPath, raw);
  console.error(raw || `Node tests terminated by ${nodeTests.signal ?? 'an unknown error'}`);
  console.error(`Full test log: ${logPath}`);
  process.exit(nodeTests.status || 1);
}
