import assert from 'node:assert/strict';
import test from 'node:test';

import failureReporter from './node-failure-reporter.mjs';
import { formatVitestFailures } from './test-failures.mjs';

test('formats failed Vitest cases and setup without passed cases', () => {
  const result = formatVitestFailures({ testResults: [
    { status: 'passed', name: 'pass.ts' },
    { status: 'failed', name: 'cases.ts', assertionResults: [
      { status: 'passed', fullName: 'pass' },
      { status: 'failed', fullName: 'group case', failureMessages: ['expected 1, got 2'] },
    ] },
    { status: 'failed', name: 'setup.ts', message: 'setup failed' },
  ] });
  assert.match(result, /cases\.ts > group case\nexpected 1, got 2/);
  assert.match(result, /setup\.ts\nsetup failed/);
  assert.doesNotMatch(result, /pass\.ts/);
});

test('node reporter emits failures but not successful cases or duplicate parent failures', async () => {
  async function* events() {
    yield { type: 'test:pass', data: { name: 'ok' } };
    yield { type: 'test:fail', data: { name: 'broken', file: 'sample.mjs', details: { error: new Error('reason') } } };
    yield { type: 'test:fail', data: { name: 'parent', details: { error: { failureType: 'subtestsFailed' } } } };
  }
  let output = '';
  for await (const chunk of failureReporter(events())) output += chunk;
  assert.match(output, /FAIL sample\.mjs > broken/);
  assert.match(output, /reason/);
  assert.doesNotMatch(output, /FAIL .* > (parent|ok)\b/);
});
