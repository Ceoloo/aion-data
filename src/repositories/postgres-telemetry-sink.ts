import type { MissionId, RunId, TelemetryRecord, TelemetrySink } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { TelemetryRow } from '../types/database.js';
import { toPersistenceError } from '../errors/index.js';
import { rowToTelemetryRecord, telemetryToColumns } from '../mappers/telemetry-mapper.js';

/**
 * Durable {@link TelemetrySink} backed by PostgreSQL.
 *
 * Telemetry is the append-only observability spine. Core's TelemetryRecord has
 * no natural identity, so each `record` call appends a new row with a
 * DB-minted `telemetry_id`. Idempotency policy (docs/phase-2.md): there is no
 * dedup key because Core provides none — each submission is a distinct
 * observation, and a retry that re-submits is recorded again rather than being
 * silently swallowed. Callers requiring exactly-once telemetry must supply their
 * own dedup key in metadata; Phase 2 does not impose one.
 */
export class PostgresTelemetrySink implements TelemetrySink {
  constructor(private readonly db: Queryable) {}

  async record(record: TelemetryRecord): Promise<void> {
    const c = telemetryToColumns(record);
    try {
      await this.db.query(
        `INSERT INTO telemetry_records (
           occurred_at, operation, status, request_id, mission_id, workflow_id,
           run_id, command_id, actor_id, agent_id, tool_id, approval_id,
           correlation_id, actor_type, tool_used, model, input_context_reference,
           decision, duration_ms, executor, token_usage, cost, risk_level,
           approval_state, outcome_reference, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
           $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb
         )`,
        [
          c.occurred_at, c.operation, c.status, c.request_id, c.mission_id,
          c.workflow_id, c.run_id, c.command_id, c.actor_id, c.agent_id,
          c.tool_id, c.approval_id, c.correlation_id, c.actor_type, c.tool_used,
          c.model, c.input_context_reference, c.decision, c.duration_ms,
          c.executor, c.token_usage, c.cost, c.risk_level, c.approval_state,
          c.outcome_reference, c.metadata,
        ],
      );
    } catch (err) {
      throw toPersistenceError('record telemetry', err, { operation: record.operation });
    }
  }

  /** Telemetry for a run, in durable insertion order (read helper; not a port). */
  async listByRun(runId: RunId): Promise<TelemetryRecord[]> {
    return this.query('SELECT * FROM telemetry_records WHERE run_id = $1 ORDER BY seq', [runId]);
  }

  /** Telemetry for a mission, in durable insertion order (read helper). */
  async listByMission(missionId: MissionId): Promise<TelemetryRecord[]> {
    return this.query(
      'SELECT * FROM telemetry_records WHERE mission_id = $1 ORDER BY seq',
      [missionId],
    );
  }

  private async query(sql: string, params: readonly unknown[]): Promise<TelemetryRecord[]> {
    try {
      const { rows } = await this.db.query<TelemetryRow>(sql, params);
      return rows.map(rowToTelemetryRecord);
    } catch (err) {
      throw toPersistenceError('read telemetry', err, {});
    }
  }
}
