import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts', 'src/cli/**/*.test.ts', 'src/vscode/questions/**/*.test.ts', 'src/vscode/webview/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    testTimeout: 10_000,
  },
});
