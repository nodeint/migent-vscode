import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts', 'src/cli/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    testTimeout: 10_000,
  },
});
