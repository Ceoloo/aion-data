/**
 * Reset the test database: drop and recreate the public schema, then migrate.
 *
 * Usage: `npm run reset-test-db`
 *
 * Operates on TEST_DATABASE_URL only, and refuses to run unless the target
 * database name contains "test" — a guard against ever pointing this at real
 * data (aion-docs/architecture/environments.md: production data is isolated).
 */
import 'dotenv/config';
import { createPool } from '../src/db/client.js';
import { runMigrations } from '../src/migrations/runner.js';

async function main(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is not set');
  }
  const dbName = new URL(connectionString).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `refusing to reset "${dbName}": TEST_DATABASE_URL must point at a database ` +
        'whose name contains "test"',
    );
  }

  const pool = createPool({ connectionString });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    const results = await runMigrations(pool);
    console.log(`Reset "${dbName}": ${results.length} migration(s) applied.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exitCode = 1;
});
