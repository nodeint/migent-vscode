import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { selectTests } from './test-selection.mjs';

const root = resolve('selection-fixture');
const files = ['src/cli/a.test.ts', 'src/cli/nested/b.test.ts', 'src/client/c.test.ts', 'scripts/tool.test.mjs'];

test('directory selection respects boundaries and deduplicates overlapping paths', () => {
  assert.deepEqual(selectTests(root, ['src/cli/', './src/cli/a.test.ts'], files), files.slice(0, 2));
});

test('selects exact and absolute files across runners', () => {
  assert.deepEqual(selectTests(root, [resolve(root, files[0]), files[3]], files), [files[0], files[3]]);
});

test('rejects every unmatched path and unsupported flags', () => {
  for (const path of ['missing', 'src/cli/a.ts', 'src/cli/a.test', '--passWithNoTests']) {
    assert.throws(() => selectTests(root, [files[0], path], files), /No configured|Expected a test/);
  }
});
