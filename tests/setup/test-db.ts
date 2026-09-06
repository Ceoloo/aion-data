import 'dotenv/config';
import { createDataLayer, type DataLayer } from '../../src/index.js';

/**
 * Test-database helpers.
 *
 * Integration tests run against a REAL PostgreSQL instance (Phase 2 §34): the
 * connection comes from TEST_DATABASE_URL (or DATABASE_URL), always an isolated,
 * disposable database. Suites share one database and coordinate through
 * per-test truncation; vitest runs files serially (see vitest.config.ts).
 */

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/aion_data_test';

export function testConnectionString(): string {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_URL;
}

export function createTestDataLayer(): DataLayer {
  return createDataLayer({
    connectionString: testConnectionString(),
    applicationName: 'aion-data-tests',
  });
}

/** The canonical tables, most-dependent first (order is moot under CASCADE). */
export const ALL_TABLES = [
  'evaluation_results',
  'executions',
  'services',
  'outcomes',
  'approvals',
  'telemetry_records',
  'events',
  'runs',
  'workflows',
  'missions',
  'actors',
] as const;

/** Drops and recreates the public schema (a from-scratch slate). */
export async function resetSchema(dl: DataLayer): Promise<void> {
  await dl.pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await dl.pool.query('CREATE SCHEMA public');
}

/** Ensures the schema is migrated (idempotent). */
export async function ensureMigrated(dl: DataLayer): Promise<void> {
  await dl.migrate();
}

/** Empties every canonical table between tests, resetting identity sequences. */
export async function truncateAll(dl: DataLayer): Promise<void> {
  await dl.pool.query(
    `TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
