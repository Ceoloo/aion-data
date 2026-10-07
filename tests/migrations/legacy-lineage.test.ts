import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMigrations } from '../../src/index.js';
import { createTestDataLayer, resetSchema } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

/**
 * Upgrade path for databases migrated on the pre-alignment `execution-object`
 * lineage (aion-runtime's old aion-data pin + revenue_sessions overlay), where
 * 0009 = implementation_cases, 0010 = ie002_activation_statuses and
 * 0011 = revenue_sessions. The canonical runner must relabel that history and
 * apply only what is genuinely missing — never re-run existing DDL, never fail
 * on checksum drift.
 */
describe('legacy execution-object lineage reconciliation', () => {
  let dl: DataLayer;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await resetSchema(dl);
  });

  afterAll(async () => {
    await resetSchema(dl);
    await dl.migrate();
    await dl.close();
  });

  it('upgrades a legacy-lineage database to canonical history', async () => {
    const all = readMigrations();
    const byVersion = new Map(all.map((m) => [m.version, m]));

    await dl.pool.query(`
      CREATE TABLE schema_migrations (
        version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now())`);

    // 0001–0008 are shared by both lineages.
    for (const m of all.filter((x) => Number(x.version) <= 8)) {
      await dl.pool.query(m.sql);
      await dl.pool.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [m.version, m.name, m.checksum],
      );
    }
    // Legacy 0009/0010/0011 — same schema effects, different numbering/checksums.
    const legacy: Array<[string, string, string]> = [
      ['0009', 'implementation_cases', byVersion.get('0011')!.sql],
      ['0010', 'ie002_activation_statuses', byVersion.get('0012')!.sql],
      ['0011', 'revenue_sessions', `-- Overlay\n${byVersion.get('0009')!.sql}`],
    ];
    for (const [version, name, sql] of legacy) {
      await dl.pool.query(sql);
      await dl.pool.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, 'legacy')",
        [version, name],
      );
    }

    const results = await dl.migrate();
    const applied = results.filter((r) => r.status === 'applied').map((r) => r.version);
    // Only genuinely-missing canonical migrations run (0014 = Agent Identity Registry).
    expect(applied).toEqual(['0010', '0013', '0014']);

    const { rows } = await dl.pool.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => `${r.version}_${r.name}`)).toEqual(
      all.map((m) => `${m.version}_${m.name}`),
    );
    for (const r of rows) expect(r.checksum).toBe(byVersion.get(r.version)!.checksum);

    // Idempotent afterwards.
    const again = await dl.migrate();
    expect(again.every((r) => r.status === 'skipped')).toBe(true);
  });
});
