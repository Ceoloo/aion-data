import { newOutcomeId } from '@aion/core';
import type { OutcomeId, RunId, MissionId } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { OutcomeRow } from '../types/database.js';
import { NotFoundError, toPersistenceError, type DataError } from '../errors/index.js';
import { rowToOutcomeRecord } from '../mappers/outcome-mapper.js';
import type {
  CreateOutcomeInput,
  OutcomeRecord,
  UpdateOutcomeInput,
} from './outcome.js';

/**
 * Durable outcome repository — LOCAL to aion-data.
 *
 * The smallest clean repository for recording real-world outcomes (Phase 2 §32).
 * Core defines only an OutcomeReference and no port, so this lives here and is
 * not forced into Core. It mints the canonical `outcome_id` with Core's
 * generator so the identifier is a first-class AION Core id. Lessons and
 * recommendations are NOT built — this is only the durable outcome foundation.
 */
export class PostgresOutcomeRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateOutcomeInput): Promise<OutcomeRecord> {
    const outcomeId = newOutcomeId();
    try {
      const { rows } = await this.db.query<OutcomeRow>(
        `INSERT INTO outcomes (
           outcome_id, run_id, mission_id, status, outcome_type,
           external_reference, value, currency, measured_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING *`,
        [
          outcomeId,
          input.runId,
          input.missionId ?? null,
          input.status ?? 'pending',
          input.outcomeType ?? null,
          input.externalReference ?? null,
          input.value ?? null,
          input.currency ?? null,
          input.measuredAt ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      // RETURNING always yields the inserted row.
      return rowToOutcomeRecord(rows[0] as OutcomeRow);
    } catch (err) {
      throw wrap('create outcome', err, { runId: input.runId });
    }
  }

  async get(id: OutcomeId): Promise<OutcomeRecord | undefined> {
    try {
      const { rows } = await this.db.query<OutcomeRow>(
        'SELECT * FROM outcomes WHERE outcome_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToOutcomeRecord(row) : undefined;
    } catch (err) {
      throw wrap('get outcome', err, { outcomeId: id });
    }
  }

  async listByMission(missionId: MissionId): Promise<OutcomeRecord[]> {
    return this.query(
      'SELECT * FROM outcomes WHERE mission_id = $1 ORDER BY created_at, outcome_id',
      [missionId],
    );
  }

  async listByRun(runId: RunId): Promise<OutcomeRecord[]> {
    return this.query(
      'SELECT * FROM outcomes WHERE run_id = $1 ORDER BY created_at, outcome_id',
      [runId],
    );
  }

  /**
   * Applies a partial update as reality resolves (a pending outcome becoming
   * realized, a value being measured). Read-modify-write keeps the SQL inspectable
   * and the merge explicit.
   */
  async update(id: OutcomeId, patch: UpdateOutcomeInput): Promise<OutcomeRecord> {
    const existing = await this.get(id);
    if (!existing) {
      throw new NotFoundError(`outcome "${id}" not found`, { outcomeId: id });
    }
    const merged = { ...existing, ...patch };
    try {
      const { rows } = await this.db.query<OutcomeRow>(
        `UPDATE outcomes SET
           status = $2, outcome_type = $3, external_reference = $4, value = $5,
           currency = $6, measured_at = $7, metadata = $8::jsonb, updated_at = now()
         WHERE outcome_id = $1
         RETURNING *`,
        [
          id,
          merged.status,
          merged.outcomeType ?? null,
          merged.externalReference ?? null,
          merged.value ?? null,
          merged.currency ?? null,
          merged.measuredAt ?? null,
          JSON.stringify(merged.metadata ?? {}),
        ],
      );
      return rowToOutcomeRecord(rows[0] as OutcomeRow);
    } catch (err) {
      throw wrap('update outcome', err, { outcomeId: id });
    }
  }

  private async query(sql: string, params: readonly unknown[]): Promise<OutcomeRecord[]> {
    try {
      const { rows } = await this.db.query<OutcomeRow>(sql, params);
      return rows.map(rowToOutcomeRecord);
    } catch (err) {
      throw wrap('list outcomes', err, {});
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
