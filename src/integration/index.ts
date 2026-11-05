import * as fs from 'node:fs';
import * as path from 'node:path';

import { runCapabilityScenarios } from './capability.integration.test';
import { runControlScenarios } from './control.integration.test';
import { failureCount, formatFailures, recordFailure, setFailureSuite } from './failureReport';
import { selectedScenarioCount } from './harness';
import { runMonitoringScenarios } from './monitoring.integration.test';
import { runNextStepScenarios } from './nextStep.integration.test';
import { runQuestionScenarios } from './questions.integration.test';
import { runReplyScenarios } from './reply.integration.test';
import { runResultsScenarios } from './results.integration.test';
import { runSessionMetricsScenarios } from './sessionMetrics.integration.test';
import { runSessionsTreeScenarios } from './sessionsTree.integration.test';
import { runStatusBarScenarios } from './statusBar.integration.test';
import { runTimelineScenarios } from './timeline.integration.test';
import { runWatcherProbe } from './watcherProbe.integration.test';
import { runWorkflowsProjectScenarios } from './workflowsProject.integration.test';

class CasesFailedError extends Error {}

/** Lower-case a `--file` filter or suite name and drop `run`, `Scenarios` and `.integration.test(.ts)` noise. */
function normalizeFilter(text: string | undefined): string | undefined {
  return text
    ?.toLowerCase()
    .replace(/\.integration\.test(\.ts)?$/, '')
    .replace(/^run/, '')
    .replace(/scenarios$/, '');
}

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
  runResultsScenarios,
  runSessionMetricsScenarios,
  runControlScenarios,
  runNextStepScenarios,
  runQuestionScenarios,
  runReplyScenarios,
];

/** `--file` / `--case` filters from the runner; undefined means "everything". */
interface Filters {
  file: string | undefined;
  case: string | undefined;
}

function isFileSelected(filters: Filters, name: string): boolean {
  return filters.file === undefined || (normalizeFilter(name) ?? '').includes(filters.file);
}

/** The probe has its own cases: it runs unfiltered, or when `--file` names it. */
function shouldRunProbe(filters: Filters): boolean {
  if (filters.file === undefined) return filters.case === undefined;
  return isFileSelected(filters, 'watcherProbe');
}

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
  try {
    const filters: Filters = { file: normalizeFilter(process.env.MIGENT_IT_FILE), case: process.env.MIGENT_IT_CASE };
    const isFiltered = filters.file !== undefined || filters.case !== undefined;
    let probeFailed = 0;
    if (shouldRunProbe(filters)) {
      setFailureSuite('watcher probe');
      probeFailed = await runWatcherProbe();
    }
    // With files.watcherExclude on .migent VS Code delivers no events (known limitation): the probe only
    // reports in that mode, and the scenarios that depend on watcher events are skipped.
    const scenariosFailed = process.env.MIGENT_IT_EXCLUDE === '1' ? 0 : await runSuites(filters);
    if (isFiltered && selectedScenarioCount() === 0 && !shouldRunProbe(filters)) {
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
