/**
 * Apply pending migrations.
 *
 * Usage: `npm run migrate`
 *
 * Uses MIGRATION_DATABASE_URL if set (the higher-privileged DDL role — see
 * docs/security.md), otherwise DATABASE_URL. This is an operational entrypoint,
 * so it is the one place env-driven config is read.
 */
import 'dotenv/config';
import { createPool } from '../src/db/client.js';
import { configFromEnv } from '../src/db/config.js';
import { runMigrations } from '../src/migrations/runner.js';

async function main(): Promise<void> {
  const config = configFromEnv(
    process.env,
    process.env.MIGRATION_DATABASE_URL ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL',
  );
  const pool = createPool(config);
  try {
    const results = await runMigrations(pool);
    const applied = results.filter((r) => r.status === 'applied');
    const skipped = results.filter((r) => r.status === 'skipped');
    for (const r of results) {
      console.log(`  [${r.status.padEnd(7)}] ${r.version}_${r.name}`);
    }
    console.log(
      `Migrations complete: ${applied.length} applied, ${skipped.length} already present.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
