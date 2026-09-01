import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MigrationError, readMigrations } from '../../src/index.js';
import { createTestDataLayer, resetSchema, ALL_TABLES } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

/**
 * MIGRATIONS_APPLY + schema/constraint presence + idempotency.
 *
 * Rebuilds the schema from scratch so it can assert the before/after state,
 * then leaves a migrated schema for the remaining suites.
 */
describe('migrations', () => {
  let dl: DataLayer;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await resetSchema(dl);
  });

  afterAll(async () => {
    // Leave a migrated schema behind for other suites, then close.
    await dl.migrate();
    await dl.close();
  });

  it('applies cleanly from an empty schema and reports each migration applied', async () => {
    const results = await dl.migrate();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(results.map((r) => r.version)).toContain('0001');
  });

  it('produces exactly the expected canonical tables', async () => {
    const { rows } = await dl.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const expected of [...ALL_TABLES, 'schema_migrations']) {
      expect(tables).toContain(expected);
    }
    // No unexpected / speculative tables crept in.
    const allowed = new Set<string>([...ALL_TABLES, 'schema_migrations']);
    expect(tables.filter((t) => !allowed.has(t))).toEqual([]);
  });

  it('creates the primary keys, foreign keys, and check constraints', async () => {
    const { rows } = await dl.pool.query<{ conname: string; contype: string; table_name: string }>(
      `SELECT c.conname, c.contype, t.relname AS table_name
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'`,
    );
    const byType = (type: string) => rows.filter((r) => r.contype === type);

    // Every canonical table has a primary key.
    const pkTables = new Set(byType('p').map((r) => r.table_name));
    for (const table of ALL_TABLES) expect(pkTables.has(table)).toBe(true);

    // Key foreign keys exist.
    const fkTables = byType('f').map((r) => r.table_name);
    expect(fkTables).toContain('runs'); // → missions, actors
    expect(fkTables).toContain('approvals'); // → runs, actors
    expect(fkTables).toContain('outcomes'); // → runs, missions

    // Check constraints (enums, coherence) exist on the governed tables.
    const checkTables = new Set(byType('c').map((r) => r.table_name));
    for (const table of ['actors', 'missions', 'runs', 'approvals', 'events', 'telemetry_records', 'outcomes']) {
      expect(checkTables.has(table)).toBe(true);
    }
    // The approval decision-coherence constraint is present by name.
    expect(rows.some((r) => r.conname === 'approvals_decision_coherent')).toBe(true);
  });

  it('creates the documented access-pattern indexes', async () => {
    const { rows } = await dl.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexes = rows.map((r) => r.indexname);
    for (const expected of [
      'runs_mission_id_idx',
      'runs_status_idx',
      'approvals_run_id_idx',
      'events_run_id_seq_idx',
      'telemetry_run_id_seq_idx',
      'outcomes_mission_id_idx',
    ]) {
      expect(indexes).toContain(expected);
    }
  });

  it('is idempotent: a second run skips everything', async () => {
    const results = await dl.migrate();
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('records each applied migration with a checksum', async () => {
    const { rows } = await dl.pool.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.length).toBe(readMigrations().length);
    expect(rows.every((r) => r.checksum.length === 64)).toBe(true);
  });

  it('surfaces migration content as a checksum drift error', async () => {
    // Simulate a tampered / re-edited applied migration.
    await dl.pool.query(
      "UPDATE schema_migrations SET checksum = 'deadbeef' WHERE version = '0001'",
    );
    await expect(dl.migrate()).rejects.toBeInstanceOf(MigrationError);
    // Restore the real checksum so afterAll's migrate() is clean.
    const [first] = readMigrations();
    await dl.pool.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [
      first!.checksum,
      first!.version,
    ]);
  });
});
