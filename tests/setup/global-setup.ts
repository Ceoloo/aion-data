import 'dotenv/config';
import { createTestDataLayer, resetSchema } from './test-db.js';

/**
 * Vitest global setup: prove the test database is reachable and start every run
 * from a clean, migrated schema. Runs once before any suite. Individual suites
 * additionally call `ensureMigrated` (idempotent) and truncate between tests, so
 * ordering never leaves a suite without its tables.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const dl = createTestDataLayer();
  try {
    await dl.pool.query('SELECT 1');
  } catch (err) {
    await dl.close();
    throw new Error(
      'Cannot reach the test database. Set TEST_DATABASE_URL to an isolated ' +
        'PostgreSQL database (see .env.example / docs/phase-2.md). ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await resetSchema(dl);
  await dl.migrate();
  await dl.close();

  return async () => {
    // No global teardown state to clean; each suite manages its own data layer.
  };
}
