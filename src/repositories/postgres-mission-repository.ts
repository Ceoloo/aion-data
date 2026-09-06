import type { Mission, MissionId, MissionRepository } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { MissionRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import { missionToColumns, rowToMission } from '../mappers/mission-mapper.js';

/**
 * Durable {@link MissionRepository} backed by PostgreSQL.
 *
 * Implements the exact AION Core port — Core depends on the interface, never on
 * this class or on `pg` (aion-docs/repositories/dependency-rules.md). `save` is
 * an idempotent upsert keyed on the Core `mission_id`, matching the in-memory
 * adapter's last-write-wins semantics while persisting durably.
 */
export class PostgresMissionRepository implements MissionRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: MissionId): Promise<Mission | undefined> {
    try {
      const { rows } = await this.db.query<MissionRow>(
        'SELECT * FROM missions WHERE mission_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToMission(row) : undefined;
    } catch (err) {
      throw wrap('get mission', err, { missionId: id });
    }
  }

  async save(mission: Mission): Promise<void> {
    const c = missionToColumns(mission);
    try {
      await this.db.query(
        `INSERT INTO missions (
           mission_id, name, description, owner, status, objective,
           success_criteria, risk_level, metadata, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)
         ON CONFLICT (mission_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           owner = EXCLUDED.owner,
           status = EXCLUDED.status,
           objective = EXCLUDED.objective,
           success_criteria = EXCLUDED.success_criteria,
           risk_level = EXCLUDED.risk_level,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [
          c.mission_id, c.name, c.description, c.owner, c.status, c.objective,
          c.success_criteria, c.risk_level, c.metadata, c.created_at,
        ],
      );
    } catch (err) {
      throw wrap('save mission', err, { missionId: mission.missionId });
    }
  }

  /**
   * Mission 006 — DISTINCT missions referenced by executions for a tenant.
   * Missions have no tenant_id; tenancy is derived from `executions.tenant_id`.
   */
  async listForTenant(tenantId: string): Promise<Mission[]> {
    try {
      const { rows } = await this.db.query<MissionRow>(
        `SELECT DISTINCT ON (m.mission_id) m.*
         FROM missions m
         INNER JOIN executions e ON e.mission_id = m.mission_id
         WHERE e.tenant_id = $1
         ORDER BY m.mission_id, m.created_at DESC`,
        [tenantId],
      );
      // Re-sort by created_at after DISTINCT ON (which requires mission_id first).
      const missions = rows.map(rowToMission);
      missions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return missions;
    } catch (err) {
      throw wrap('list missions for tenant', err, { tenantId });
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
