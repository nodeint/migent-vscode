import * as fs from 'node:fs';
import * as path from 'node:path';

import { runCapabilityScenarios } from './capability.integration.test';
import { runMonitoringScenarios } from './monitoring.integration.test';
import { runResultsScenarios } from './results.integration.test';
import { runSessionsTreeScenarios } from './sessionsTree.integration.test';
import { runStatusBarScenarios } from './statusBar.integration.test';
import { runTimelineScenarios } from './timeline.integration.test';
import { runWatcherProbe } from './watcherProbe.integration.test';
import { runWorkflowsProjectScenarios } from './workflowsProject.integration.test';

/** Entry point loaded by VS Code (`extensionTestsPath`). Rejects when a required case fails. */
export async function run(): Promise<void> {
  try {
    const probeFailed = await runWatcherProbe();
    // With files.watcherExclude on .migent VS Code delivers no events (known limitation): the probe only
    // reports in that mode, and the scenarios that depend on watcher events are skipped.
    const isExclude = process.env.MIGENT_IT_EXCLUDE === '1';
    let scenariosFailed = 0;
    if (!isExclude) {
      scenariosFailed += await runMonitoringScenarios();
      scenariosFailed += await runSessionsTreeScenarios();
      scenariosFailed += await runWorkflowsProjectScenarios();
      scenariosFailed += await runCapabilityScenarios();
      scenariosFailed += await runTimelineScenarios();
      scenariosFailed += await runStatusBarScenarios();
      scenariosFailed += await runResultsScenarios();
    }
    const failed = probeFailed + scenariosFailed;
    if (failed > 0) {
      throw new Error(`${failed} required integration case(s) failed`);
    }
  } catch (error) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error('INTEGRATION ERROR:', text);
    fs.writeFileSync(path.resolve(__dirname, '..', 'last-error.txt'), text);
    throw error;
  }
}
