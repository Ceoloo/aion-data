import type { AionEvent, EventSink, EventType, MissionId, RunId } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { EventRow } from '../types/database.js';
import { toPersistenceError } from '../errors/index.js';
import { eventToColumns, rowToEvent } from '../mappers/event-mapper.js';

/**
 * Durable {@link EventSink} backed by PostgreSQL.
 *
 * Events are immutable, append-only facts (aion-docs/engineering/
 * event-standards.md). `emit` is INSERT ... ON CONFLICT (event_id) DO NOTHING,
 * so re-delivering an event with the same id is idempotent and never creates a
 * duplicate or mutates the original — durable retries are safe. There is
 * deliberately no update or delete path; corrections are new (compensating)
 * events, never edits to history.
 */
export class PostgresEventSink implements EventSink {
  constructor(private readonly db: Queryable) {}

  async emit(event: AionEvent): Promise<void> {
    const c = eventToColumns(event);
    try {
      await this.db.query(
        `INSERT INTO events (
           event_id, event_type, occurred_at, request_id, mission_id, workflow_id,
           run_id, actor_id, correlation_id, causation_id, payload, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          c.event_id, c.event_type, c.occurred_at, c.request_id, c.mission_id,
          c.workflow_id, c.run_id, c.actor_id, c.correlation_id, c.causation_id,
          c.payload, c.metadata,
        ],
      );
    } catch (err) {
      throw toPersistenceError('emit event', err, { eventId: event.eventId });
    }
  }

  /** Events for a run, in durable insertion order (read helper; not a Core port). */
  async listByRun(runId: RunId): Promise<AionEvent[]> {
    return this.query('SELECT * FROM events WHERE run_id = $1 ORDER BY seq', [runId]);
  }

  /** Events for a mission, in durable insertion order (read helper). */
  async listByMission(missionId: MissionId): Promise<AionEvent[]> {
    return this.query('SELECT * FROM events WHERE mission_id = $1 ORDER BY seq', [missionId]);
  }

  /** Events of a given type, in durable insertion order (read helper). */
  async listByType(type: EventType): Promise<AionEvent[]> {
    return this.query('SELECT * FROM events WHERE event_type = $1 ORDER BY seq', [type]);
  }

  private async query(sql: string, params: readonly unknown[]): Promise<AionEvent[]> {
    try {
      const { rows } = await this.db.query<EventRow>(sql, params);
      return rows.map(rowToEvent);
    } catch (err) {
      throw toPersistenceError('read events', err, {});
    }
  }
}
