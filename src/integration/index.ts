import * as fs from 'node:fs';
import * as path from 'node:path';

import { runCapabilityScenarios } from './capability.integration.test';
import { runControlScenarios } from './control.integration.test';
import { failureCount, formatFailures, recordFailure, setFailureSuite } from './failureReport';
import { type Filters, isEmptySelection, isFileSelected, normalizeFilter, parsePass, shouldRunProbe, shouldRunSuites } from './filters';
import { selectedScenarioCount } from './harness';
import { runMonitoringScenarios } from './monitoring.integration.test';
import { runNextStepScenarios } from './nextStep.integration.test';
import { runOverviewScenarios } from './overview.integration.test';
import { runQuestionScenarios } from './questions.integration.test';
import { runReplyScenarios } from './reply.integration.test';
import { runSessionMetricsScenarios } from './sessionMetrics.integration.test';
import { runSessionsTreeScenarios } from './sessionsTree.integration.test';
import { runStatusBarScenarios } from './statusBar.integration.test';
import { runTimelineScenarios } from './timeline.integration.test';
import { runWatcherProbe } from './watcherProbe.integration.test';
import { runWorkflowsProjectScenarios } from './workflowsProject.integration.test';

/**
 * Put the runner's fake CLI launcher first on PATH. On macOS VS Code merges the login shell's PATH ahead of
 * the one the runner passes, so an installed `migent` can shadow the fixture CLI; this entry runs before any
 * project appears and makes the extension locate the launcher wherever the window's PATH was ordered.
 */
function preferFixtureCli(): void {
  const bin = process.env.MIGENT_IT_CLI_BIN;
  if (bin === undefined || bin === '') return;
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const entries = (process.env[key] ?? '').split(path.delimiter).filter((entry) => entry !== '' && entry !== bin);
  process.env[key] = [bin, ...entries].join(path.delimiter);
}

class CasesFailedError extends Error {}

/** A failed run reports its failed cases; the stack of the summary error itself says nothing useful. */
function describe(error: unknown): string {
  if (error instanceof CasesFailedError) return error.message;
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

const SUITES = [
  runMonitoringScenarios,
  runSessionsTreeScenarios,
  runWorkflowsProjectScenarios,
  runCapabilityScenarios,
  runTimelineScenarios,
  runStatusBarScenarios,
  runOverviewScenarios,
  runSessionMetricsScenarios,
  runControlScenarios,
  runNextStepScenarios,
  runQuestionScenarios,
  runReplyScenarios,
];

async function runSuites(filters: Filters): Promise<number> {
  let failed = 0;
  for (const suite of SUITES) {
    if (!isFileSelected(filters, suite.name)) continue;
    setFailureSuite(suite.name);
    failed += await suite();
  }
  return failed;
}

/** Entry point loaded by VS Code (`extensionTestsPath`). Rejects when a required case fails. */
export async function run(): Promise<void> {
  preferFixtureCli();
  try {
    const filters: Filters = { file: normalizeFilter(process.env.MIGENT_IT_FILE), case: process.env.MIGENT_IT_CASE };
    const pass = parsePass(process.env.MIGENT_IT_WATCH);
    let probeFailed = 0;
    if (shouldRunProbe(filters, pass)) {
      setFailureSuite('watcher probe');
      probeFailed = await runWatcherProbe();
    }
    // With files.watcherExclude on .migent VS Code delivers no events (known limitation): the probe only
    // reports in that mode, and the scenarios that depend on watcher events are skipped.
    const scenariosFailed = process.env.MIGENT_IT_EXCLUDE === '1' || !shouldRunSuites(pass) ? 0 : await runSuites(filters);
    if (isEmptySelection(filters, pass, selectedScenarioCount())) {
      throw new CasesFailedError(`No integration case matched --file ${filters.file ?? '*'} --case ${filters.case ?? '*'}`);
    }
    const failed = probeFailed + scenariosFailed;
    if (failed > 0) {
      throw new CasesFailedError(`${failed} required integration case(s) failed:
${formatFailures()}`);
    }
  } catch (error) {
    if (!(error instanceof CasesFailedError)) {
      recordFailure('setup', 'integration run interrupted', error);
    }
    const text = describe(error);
    console.error(`INTEGRATION ERROR (${failureCount()} failure(s)):\n${text}`);
    fs.writeFileSync(process.env.MIGENT_IT_ERROR_PATH ?? path.resolve(__dirname, '..', 'last-error.txt'), text);
    throw error instanceof CasesFailedError ? new Error(error.message) : error;
  }
}
