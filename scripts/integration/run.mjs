/**
 * Integration test runner (@vscode/test-electron).
 *
 * Usage: node scripts/integration/run.mjs [--versions 1.90.0,stable]
 * Default versions: the minimum supported VS Code (engines.vscode) and the latest stable.
 * Add --control to run without files.watcherExclude (harness sanity check).
 * Every version runs even if an earlier one fails; the exit code is non-zero if any failed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

import { copyFixtureWorkspace } from './fixtureWorkspace.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const minimum = String(pkg.engines.vscode).replace(/^[^\d]*/, '');

const versionsArg = process.argv.indexOf('--versions');
const versions =
  versionsArg === -1 ? [minimum, 'stable'] : process.argv[versionsArg + 1].split(',').filter(Boolean);

const build = spawnSync(process.execPath, [join(root, 'esbuild.mjs'), '--integration'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// --control: same probe without files.watcherExclude, to tell harness defects from exclude-related failures.
const isControl = process.argv.includes('--control');

let failed = 0;
for (const version of versions) {
  const workspace = copyFixtureWorkspace(join(root, 'src', 'integration', 'fixtures', 'workspace'));
  if (isControl) {
    writeFileSync(join(workspace, '.vscode', 'settings.json'), '{}\n');
  }
  console.log(`\n=== VS Code ${version} (workspace ${workspace}) ===`);
  try {
    await runTests({
      version,
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'dist-test', 'integration', 'index.js'),
      launchArgs: [workspace, '--profile-temp', '--disable-workspace-trust'],
      extensionTestsEnv: { MIGENT_IT_WORKSPACE: workspace, ...(isControl ? { MIGENT_IT_CONTROL: '1' } : {}) },
    });
  } catch (error) {
    failed += 1;
    console.error(`VS Code ${version}: integration tests failed`, error);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
process.exit(failed === 0 ? 0 : 1);
