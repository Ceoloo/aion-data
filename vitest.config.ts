import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL instance (see
 * docs/phase-2.md and tests/setup). File-level parallelism is disabled because
 * the suites share one database and coordinate through per-test truncation; the
 * migration suite additionally rebuilds the schema, which must not race other
 * suites.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
