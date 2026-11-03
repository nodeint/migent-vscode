import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';

test('integration failure report preserves case names, suites, and error details', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'migent-report-test-'));
  const previous = process.env.MIGENT_IT_FAILURE_REPORT;
  try {
    const report = join(dir, 'report.json');
    const bundle = join(dir, 'report.mjs');
    await build({
      entryPoints: [resolve('src/integration/failureReport.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [{
        name: 'vscode-stub',
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const version = "test-version";' }));
        },
      }],
    });
    process.env.MIGENT_IT_FAILURE_REPORT = report;
    const recorder = await import(pathToFileURL(bundle).href);
    recorder.setFailureSuite('monitoring');
    recorder.recordFailure('scenario', 'first case', new Error('first reason'));
    recorder.recordFailure('watcher probe', 'second case', 'second reason');
    const result = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(result.vscodeVersion, 'test-version');
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.failures.map(({ type, suite, name, message }) => ({ type, suite, name, message })), [
      { type: 'scenario', suite: 'monitoring', name: 'first case', message: 'first reason' },
      { type: 'watcher probe', suite: 'monitoring', name: 'second case', message: 'second reason' },
    ]);
    assert.match(result.failures[0].stack, /first reason/);
  } finally {
    if (previous === undefined) delete process.env.MIGENT_IT_FAILURE_REPORT;
    else process.env.MIGENT_IT_FAILURE_REPORT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
