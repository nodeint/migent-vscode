import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { formatVitestFailures } from './test-failures.mjs';
import { selectTests } from './test-selection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-test');
const reportPath = join(outDir, 'unit-vitest.json');
const logPath = join(outDir, 'unit-test.log');
mkdirSync(outDir, { recursive: true });
rmSync(reportPath, { force: true });

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const vitestBin = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const paths = process.argv.slice(2).filter((arg) => arg !== '--');
let vitestFiles = [];
let nodeFiles = globSync('scripts/*.test.mjs', { cwd: root });
if (paths.length > 0) {
  const listPath = join(outDir, 'unit-test-files.json');
  rmSync(listPath, { force: true });
  const discovery = run([vitestBin, 'list', '--filesOnly', `--json=${listPath}`]);
  if (discovery.status !== 0) {
    console.error(`${discovery.stdout ?? ''}${discovery.stderr ?? ''}${discovery.error ?? ''}`);
    process.exit(discovery.status || 1);
  }
  try {
    const configured = JSON.parse(readFileSync(listPath, 'utf8')).map(({ file }) => file);
    const selected = selectTests(root, paths, [...configured, ...nodeFiles]);
    vitestFiles = selected.filter((file) => configured.includes(file));
    nodeFiles = selected.filter((file) => nodeFiles.includes(file));
    console.log(`Selected ${vitestFiles.length} Vitest files and ${nodeFiles.length} Node test files.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (paths.length === 0 || vitestFiles.length > 0) {
const vitest = run([vitestBin, 'run', ...vitestFiles, '--reporter=json', `--outputFile=${reportPath}`, '--silent=passed-only']);
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
}

if (nodeFiles.length > 0) {
const reporter = pathToFileURL(join(root, 'scripts', 'node-failure-reporter.mjs')).href;
const nodeTests = run(['--test', `--test-reporter=${reporter}`, ...nodeFiles]);
if (nodeTests.status !== 0) {
  const raw = `${nodeTests.stdout ?? ''}${nodeTests.stderr ?? ''}${nodeTests.error ?? ''}`;
  writeFileSync(logPath, raw);
  console.error(raw || `Node tests terminated by ${nodeTests.signal ?? 'an unknown error'}`);
  console.error(`Full test log: ${logPath}`);
  process.exit(nodeTests.status || 1);
}
}
