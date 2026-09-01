import type { Run, RunId, RunRepository } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { RunRow } from '../types/database.js';
import {
  ConcurrencyError,
  NotFoundError,
  toPersistenceError,
  type DataError,
} from '../errors/index.js';
import { rowToRun, runToColumns } from '../mappers/run-mapper.js';

/** A run together with its DB optimistic-concurrency version. */
export interface VersionedRun {
  run: Run;
  version: number;
}

/**
 * Durable {@link RunRepository} backed by PostgreSQL.
 *
 * `save` is a last-write-wins upsert, matching the Phase 1 in-memory adapter and
 * the current Core port (whose `save(run)` signature carries no expected
 * version). The `version` column is nonetheless incremented on every update, and
 * this class additionally exposes {@link getWithVersion} and
 * {@link compareAndSave} for callers that want optimistic-concurrency control.
 *
 * That extra pair is a documented EXTENSION, not a replacement for the port
 * (docs/phase-2.md, §"Architecture issues"): Core cannot yet request a
 * version-checked save through `RunRepository`, so the safe default honours the
 * port and the stronger guarantee is opt-in. This surfaces the gap rather than
 * silently forking the API.
 */
export class PostgresRunRepository implements RunRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: RunId): Promise<Run | undefined> {
    const versioned = await this.getWithVersion(id);
    return versioned?.run;
  }

  async getWithVersion(id: RunId): Promise<VersionedRun | undefined> {
    try {
      const { rows } = await this.db.query<RunRow>(
        'SELECT * FROM runs WHERE run_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? { run: rowToRun(row), version: row.version } : undefined;
    } catch (err) {
      throw wrap('get run', err, { runId: id });
    }
  }

  async save(run: Run): Promise<void> {
    const c = runToColumns(run);
    try {
      await this.db.query(
        `INSERT INTO runs (
           run_id, request_id, mission_id, workflow_id, command_id, actor_id,
           state, risk_level, approval_id, correlation_id, version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12)
         ON CONFLICT (run_id) DO UPDATE SET
           request_id = EXCLUDED.request_id,
           mission_id = EXCLUDED.mission_id,
           workflow_id = EXCLUDED.workflow_id,
           command_id = EXCLUDED.command_id,
           actor_id = EXCLUDED.actor_id,
           state = EXCLUDED.state,
           risk_level = EXCLUDED.risk_level,
           approval_id = EXCLUDED.approval_id,
           correlation_id = EXCLUDED.correlation_id,
           version = runs.version + 1,
           updated_at = EXCLUDED.updated_at`,
        [
          c.run_id, c.request_id, c.mission_id, c.workflow_id, c.command_id,
          c.actor_id, c.state, c.risk_level, c.approval_id, c.correlation_id,
          c.created_at, c.updated_at,
        ],
      );
    } catch (err) {
      throw wrap('save run', err, { runId: run.runId });
    }
  }

  /**
   * Version-checked update: applies the write only if the stored version still
   * equals `expectedVersion`, otherwise throws {@link ConcurrencyError} (or
   * {@link NotFoundError} if the run is absent). Returns the new version.
   */
  async compareAndSave(run: Run, expectedVersion: number): Promise<number> {
    const c = runToColumns(run);
    let rowCount: number;
    let newVersion: number | undefined;
    try {
      const result = await this.db.query<{ version: number }>(
        `UPDATE runs SET
           request_id = $2, mission_id = $3, workflow_id = $4, command_id = $5,
           actor_id = $6, state = $7, risk_level = $8, approval_id = $9,
           correlation_id = $10, updated_at = $11, version = version + 1
         WHERE run_id = $1 AND version = $12
         RETURNING version`,
        [
          c.run_id, c.request_id, c.mission_id, c.workflow_id, c.command_id,
          c.actor_id, c.state, c.risk_level, c.approval_id, c.correlation_id,
          c.updated_at, expectedVersion,
        ],
      );
      rowCount = result.rowCount ?? 0;
      newVersion = result.rows[0]?.version;
    } catch (err) {
      throw wrap('compare-and-save run', err, { runId: run.runId });
    }

    if (rowCount === 1 && newVersion !== undefined) return newVersion;

    const existing = await this.getWithVersion(run.runId as RunId);
    if (!existing) {
      throw new NotFoundError(`run "${run.runId}" not found`, { runId: run.runId });
    }
    throw new ConcurrencyError(
      `stale run update for "${run.runId}": expected version ${expectedVersion}, ` +
        `found ${existing.version}`,
      { runId: run.runId, expectedVersion, actualVersion: existing.version },
    );
  }

  async list(): Promise<Run[]> {
    try {
      const { rows } = await this.db.query<RunRow>(
        'SELECT * FROM runs ORDER BY created_at, run_id',
      );
      return rows.map(rowToRun);
    } catch (err) {
      throw wrap('list runs', err, {});
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
