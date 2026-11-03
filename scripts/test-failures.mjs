/** Format only failed Vitest cases and failed suite setup. */
export function formatVitestFailures(report) {
  const lines = [];
  for (const suite of report.testResults ?? []) {
    if (suite.status !== 'failed') continue;
    const failedCases = (suite.assertionResults ?? []).filter((item) => item.status === 'failed');
    for (const item of failedCases) {
      lines.push(`FAIL ${suite.name} > ${item.fullName}`);
      lines.push(...(item.failureMessages ?? []));
    }
    if (suite.message && failedCases.length === 0) lines.push(`FAIL ${suite.name}\n${suite.message}`);
  }
  return lines.join('\n');
}
