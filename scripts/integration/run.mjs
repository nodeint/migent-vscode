/**
 * Integration test runner (@vscode/test-electron).
 *
 * Usage: node scripts/integration/run.mjs [--versions 1.93.0,stable] [--file reply] [--case "empty reply"]
 * --file and --case narrow the run to matching suites/cases (case-insensitive substrings) for quick verification;
 * a filter that matches nothing fails the run.
 * Default versions: the minimum supported VS Code (engines.vscode) and the latest stable.
 * Add --exclude to run with files.watcherExclude for .migent (informational: VS Code delivers no watcher
 * events for excluded paths, a known limitation; see docs/testing.md).
 * Every version runs even if an earlier one fails; the exit code is non-zero if any failed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

// Locally, keep successful runs quiet and replay runner output if anything fails.
// CI prints the runner output and each version's VS Code log for diagnosis.
if (!process.env.MIGENT_IT_CAPTURED && !process.env.CI) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    env: { ...process.env, MIGENT_IT_CAPTURED: '1' },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => output.push(chunk));
  child.on('error', (error) => {
    console.error('Failed to start integration tests:', error);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    if (code !== 0) {
      for (const chunk of output) process.stderr.write(chunk);
      if (signal) console.error(`Integration tests terminated by ${signal}`);
      process.exitCode = code || 1;
    }
  });
} else {
  await runIntegration();
}

async function runIntegration() {
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const minimum = String(pkg.engines.vscode).replace(/^[^\d]*/, '');

const versionsArg = process.argv.indexOf('--versions');
const versions =
  versionsArg === -1 ? [minimum, 'stable'] : process.argv[versionsArg + 1].split(',').filter(Boolean);
// --file reply: only suites whose file name contains the text (reply.integration.test.ts, "watcherProbe", ...).
// --case "empty reply": only cases whose name contains the text. Both are case-insensitive and combine.
function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}
const fileFilter = optionValue('--file');
const caseFilter = optionValue('--case');
const labels = versions.map((version) => version.replace(/[^a-zA-Z0-9._-]/g, '_'));
if (new Set(labels).size !== labels.length) throw new Error('VS Code versions must have distinct report names');

// Build the extension itself (dist/extension.js) and the test bundle, so the suite never runs a stale extension.
for (const flags of [[], ['--integration']]) {
  const build = spawnSync(process.execPath, [join(root, 'esbuild.mjs'), ...flags], {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

// --exclude: probe with the user-level exclude that silences VS Code watchers (known limitation, not required to pass).
const isExclude = process.argv.includes('--exclude');

const runs = [];
for (const version of versions) {
  // Resolve downloads sequentially: an alias and an explicit version can share one cache directory.
  let executable;
  let downloadError;
  try {
    executable = await downloadAndUnzipVSCode({ version });
  } catch (error) {
    downloadError = error;
  }
  runs.push(runVersion(version, executable, downloadError).catch((error) => {
    console.error(`VS Code ${version}: integration runner failed:`, error);
    return 1;
  }));
}
const outcomes = await Promise.all(runs);
process.exit(outcomes.some((outcome) => outcome !== 0) ? 1 : 0);

async function runVersion(version, executable, downloadError) {
  const label = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  const outputDir = join(root, 'dist-test');
  mkdirSync(outputDir, { recursive: true });
  const reportPath = join(outputDir, `integration-failure-${label}.json`);
  const logPath = join(outputDir, `integration-${label}.log`);
  rmSync(reportPath, { force: true });
  const log = createWriteStream(logPath);
  // One scratch tree per run: `anchor` is the only folder the window opens with (it never holds `.migent`), `template`
  // is copied into a fresh folder for every scenario, and the VS Code profile lives outside every workspace folder.
  const scratch = mkdtempSync(join(tmpdir(), 'migent-it-'));
  const anchor = join(scratch, 'anchor');
  const template = join(scratch, 'template');
  mkdirSync(anchor);
  mkdirSync(join(scratch, 'cases'));
  cpSync(join(root, 'src', 'integration', 'fixtures', 'workspace'), template, { recursive: true });
  // Opening from a .code-workspace file makes the window multi-root from the start. This guards against
  // the extension-host restart that adding a folder to a plain single-folder window can cause.
  const workspace = join(scratch, 'integration.code-workspace');
  writeFileSync(workspace, JSON.stringify({ folders: [{ path: anchor }] }, null, 2));
  if (isExclude) {
    writeFileSync(
      join(template, '.vscode', 'settings.json'),
      JSON.stringify({ 'files.watcherExclude': { '**/.migent/**': true } }, null, 2) + '\n',
    );
  }
  // The extension finds the CLI on PATH only, so a `migent` launcher for the fake CLI goes first, as `npm install -g` would.
  const bin = writeFakeCliLauncher(scratch, join(template, 'fake-migent.js'));
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  console.log(`\n=== VS Code ${version} (scratch ${scratch}) ===`);
  try {
    if (downloadError) throw downloadError;
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'dist-test', 'integration', 'index.js'),
      launchArgs: [workspace, `--user-data-dir=${join(scratch, 'vscode-user')}`, `--extensions-dir=${join(scratch, 'vscode-extensions')}`, '--disable-workspace-trust'],
      stdout: log,
      stderr: log,
      extensionTestsEnv: { [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ''}`, MIGENT_IT_TEMPLATE: template, MIGENT_IT_SCRATCH: join(scratch, 'cases'), MIGENT_IT_FAILURE_REPORT: reportPath, MIGENT_IT_PROBE_LABEL: label, MIGENT_IT_ERROR_PATH: join(outputDir, `last-error-${label}.txt`), ...(isExclude ? { MIGENT_IT_EXCLUDE: '1' } : {}), ...(fileFilter ? { MIGENT_IT_FILE: fileFilter } : {}), ...(caseFilter ? { MIGENT_IT_CASE: caseFilter } : {}) },
    });
    return 0;
  } catch (error) {
    console.error(`VS Code ${version}: integration tests failed`);
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      for (const failure of report.failures) {
        const where = failure.location ? `\n  at ${failure.location}` : '';
        console.error(`FAIL [${failure.suite}] ${failure.name}\n  ${failure.message.replaceAll('\n', '\n  ')}${where}`);
        if (process.env.GITHUB_ACTIONS) {
          const [file, line] = String(failure.location ?? '').split(':');
          const properties = file ? `file=${file},line=${line},` : '';
          const title = `VS Code ${version}: ${failure.name}`.replaceAll(/[\r\n:,]/g, ' ');
          console.error(`::error ${properties}title=${title}::${failure.message.replaceAll('\n', '%0A')}`);
        }
      }
      console.error(`Failure report: ${reportPath}`);
    } catch {
      const message = `Test startup or reporting failed: ${String(error)}`;
      writeFileSync(reportPath, JSON.stringify({ vscodeVersion: version, status: 'failed', failures: [{ type: 'startup', suite: 'runner', name: 'VS Code launch', message }] }, null, 2));
      console.error(message);
      console.error(`Failure report: ${reportPath}`);
    }
    console.error(`Full VS Code log: ${logPath}`);
    return 1;
  } finally {
    log.end();
    await finished(log);
    if (process.env.CI) {
      console.log(`\n=== VS Code ${version} full log ===\n${readFileSync(logPath, 'utf8')}`);
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
}

/** A directory whose `migent` runs `fakeCli` with node: a `.cmd` shim on Windows, a `#!/bin/sh` wrapper elsewhere. */
function writeFakeCliLauncher(scratch, fakeCli) {
  const bin = join(scratch, 'bin');
  mkdirSync(bin);
  copyFileSync(fakeCli, join(bin, 'fake-migent.js'));
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'migent.cmd'), '@node "%~dp0\\fake-migent.js" %*\r\n');
  } else {
    writeFileSync(join(bin, 'migent'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-migent.js" "$@"\n');
    chmodSync(join(bin, 'migent'), 0o755);
  }
  return bin;
}
