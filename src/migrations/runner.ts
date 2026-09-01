import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { MigrationError } from '../errors/index.js';

/**
 * Deterministic, forward-only SQL migration runner.
 *
 * Migrations are plain, reviewable `.sql` files in `migrations/`, named
 * `NNNN_description.sql` and applied in ascending numeric order (see
 * migrations/README.md). Each is applied exactly once inside its own
 * transaction and recorded — with a content checksum — in `schema_migrations`.
 * Re-running is a no-op; an already-applied file whose content changed is a
 * drift error, not a silent re-apply. No hidden schema mutation, no ORM
 * autosync (aion-docs/engineering/data-contracts.md: migrations are owned,
 * versioned and reviewable).
 */

export interface Migration {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  version: string;
  name: string;
  /** 'applied' when run now, 'skipped' when already present. */
  status: 'applied' | 'skipped';
}

const MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;

/** Resolves the repository's `migrations/` directory for both src and dist. */
export function defaultMigrationsDir(): string {
  // src/migrations/runner.ts → ../../migrations ; dist/migrations/runner.js →
  // ../../migrations. Both are two levels below the package root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}

/** Reads and orders the migration set from disk. */
export function readMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const entries = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f));
  const migrations = entries.map((filename) => {
    const match = MIGRATION_FILE.exec(filename);
    // Guaranteed by the filter above; assert for the type-checker.
    if (!match) throw new MigrationError(`unparseable migration name: ${filename}`);
    const sql = readFileSync(join(dir, filename), 'utf8');
    return {
      version: match[1] as string,
      name: match[2] as string,
      filename,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    } satisfies Migration;
  });

  migrations.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));

  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new MigrationError(`duplicate migration version: ${m.version}`, {
        version: m.version,
      });
    }
    seen.add(m.version);
  }
  return migrations;
}

async function ensureMigrationsTable(db: pg.Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Applies all pending migrations in order. Idempotent: already-applied
 * migrations are verified (checksum) and skipped. Returns the per-migration
 * outcome so callers/tests can assert what ran.
 */
export async function runMigrations(
  pool: pg.Pool,
  dir: string = defaultMigrationsDir(),
): Promise<MigrationResult[]> {
  await ensureMigrationsTable(pool);
  const migrations = readMigrations(dir);

  const appliedRows = await pool.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  const applied = new Map(appliedRows.rows.map((r) => [r.version, r.checksum]));

  const results: MigrationResult[] = [];
  for (const migration of migrations) {
    const existingChecksum = applied.get(migration.version);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== migration.checksum) {
        throw new MigrationError(
          `migration ${migration.version} changed after being applied ` +
            '(checksum mismatch) — migrations are immutable once applied',
          { version: migration.version, filename: migration.filename },
        );
      }
      results.push({ version: migration.version, name: migration.name, status: 'skipped' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationError(`migration ${migration.filename} failed`, {
        version: migration.version,
        filename: migration.filename,
        cause: err instanceof Error ? err.message : String(err),
      });
    } finally {
      client.release();
    }
    results.push({ version: migration.version, name: migration.name, status: 'applied' });
  }

  return results;
}
