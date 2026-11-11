import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts', 'src/cli/**/*.test.ts', 'src/integration/filters.test.ts', 'src/integration/fixtureConformance.test.ts', 'src/vscode/commands/**/*.test.ts', 'src/vscode/pollingWatchBackend.test.ts', 'src/vscode/notices.test.ts', 'src/vscode/notifier.test.ts', 'src/vscode/questionNotifier.test.ts', 'src/vscode/questions/**/*.test.ts', 'src/vscode/session/**/*.test.ts', 'src/vscode/sessionWorkflow/**/*.test.ts', 'src/vscode/workflowEditor/**/*.test.ts', 'src/vscode/webview/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    testTimeout: 10_000,
  },
});
