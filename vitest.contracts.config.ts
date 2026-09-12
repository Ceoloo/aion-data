import { defineConfig } from 'vitest/config';

/**
 * Contract unit tests (no Postgres). Run with `npm run test:contracts`.
 * Full integration suite remains `npm test` (requires TEST_DATABASE_URL).
 */
export default defineConfig({
  test: {
    include: ['tests/contracts/**/*.test.ts'],
    fileParallelism: true,
    testTimeout: 15_000,
  },
});
