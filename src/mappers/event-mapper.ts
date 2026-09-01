import { AionEvent } from '@aion/core';
import type { EventRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, toIso } from './_shared.js';

/**
 * AionEvent ⇄ row mapping.
 *
 * Events are immutable facts; there is no update mapping. The row's `occurred_at`
 * is Core's `timestamp` (the moment the fact occurred), distinct from the DB's
 * `recorded_at`/`seq` which capture insertion order and are not part of the Core
 * envelope.
 */
export function rowToEvent(row: EventRow): AionEvent {
  const parsed = AionEvent.safeParse({
    eventId: row.event_id,
    eventType: row.event_type,
    timestamp: toIso(row.occurred_at),
    ...(row.request_id !== null ? { requestId: row.request_id } : {}),
    ...(row.mission_id !== null ? { missionId: row.mission_id } : {}),
    ...(row.workflow_id !== null ? { workflowId: row.workflow_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id !== null ? { causationId: row.causation_id } : {}),
    payload: metadataObject(row.payload),
    metadata: metadataObject(row.metadata),
  });
  if (!parsed.success) {
    throw new MappingError('persisted event failed Core contract validation', {
      eventId: row.event_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for append (INSERT). Events are never updated. */
export function eventToColumns(event: AionEvent): {
  event_id: string;
  event_type: string;
  occurred_at: string;
  request_id: string | null;
  mission_id: string | null;
  workflow_id: string | null;
  run_id: string | null;
  actor_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload: string;
  metadata: string;
} {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    occurred_at: event.timestamp,
    request_id: event.requestId ?? null,
    mission_id: event.missionId ?? null,
    workflow_id: event.workflowId ?? null,
    run_id: event.runId ?? null,
    actor_id: event.actorId ?? null,
    correlation_id: event.correlationId ?? null,
    causation_id: event.causationId ?? null,
    payload: JSON.stringify(event.payload),
    metadata: JSON.stringify(event.metadata),
  };
}
