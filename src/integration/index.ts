import * as fs from 'node:fs';
import * as path from 'node:path';

import { runWatcherProbe } from './watcherProbe.integration.test';

/** Entry point loaded by VS Code (`extensionTestsPath`). Rejects when a required case fails. */
export async function run(): Promise<void> {
  try {
    const failed = await runWatcherProbe();
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
