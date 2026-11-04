import * as fs from 'node:fs';
import * as path from 'node:path';

import { runCapabilityScenarios } from './capability.integration.test';
import { runControlScenarios } from './control.integration.test';
import { recordFailure, setFailureSuite } from './failureReport';
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

/** Entry point loaded by VS Code (`extensionTestsPath`). Rejects when a required case fails. */
export async function run(): Promise<void> {
  try {
    setFailureSuite('watcher probe');
    const probeFailed = await runWatcherProbe();
    // With files.watcherExclude on .migent VS Code delivers no events (known limitation): the probe only
    // reports in that mode, and the scenarios that depend on watcher events are skipped.
    const isExclude = process.env.MIGENT_IT_EXCLUDE === '1';
    let scenariosFailed = 0;
    if (!isExclude) {
      const suites = [
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
      for (const suite of suites) {
        setFailureSuite(suite.name);
        scenariosFailed += await suite();
      }
    }
    const failed = probeFailed + scenariosFailed;
    if (failed > 0) {
      throw new Error(`${failed} required integration case(s) failed`);
    }
  } catch (error) {
    if (!(error instanceof Error && /^\d+ required integration case\(s\) failed$/.test(error.message))) {
      recordFailure('setup', 'integration run interrupted', error);
    }
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error('INTEGRATION ERROR:', text);
    fs.writeFileSync(process.env.MIGENT_IT_ERROR_PATH ?? path.resolve(__dirname, '..', 'last-error.txt'), text);
    throw error;
  }
}
