import {
  OutcomeId,
  RunId,
  MissionId,
  OutcomeStatus,
  OutcomeReference,
} from '@aion/core';
import type { OutcomeRecord } from '../outcomes/outcome.js';
import type { OutcomeRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, numberOrUndefined, toIso, toIsoOrUndefined } from './_shared.js';

/**
 * OutcomeRecord ⇄ row mapping, plus the down-map to Core's OutcomeReference.
 *
 * The branded identifiers are validated with Core's own id schemas so the
 * canonical AION Core identity is preserved exactly (aion-docs identifier
 * rules). `toOutcomeReference` re-validates through the Core contract, so an
 * OutcomeRecord always projects to a Core-valid reference — the Phase-2
 * compatibility guarantee.
 */
export function rowToOutcomeRecord(row: OutcomeRow): OutcomeRecord {
  const outcomeId = OutcomeId.safeParse(row.outcome_id);
  const runId = RunId.safeParse(row.run_id);
  const status = OutcomeStatus.safeParse(row.status);
  const missionId =
    row.mission_id !== null ? MissionId.safeParse(row.mission_id) : undefined;

  if (
    !outcomeId.success ||
    !runId.success ||
    !status.success ||
    (missionId && !missionId.success)
  ) {
    throw new MappingError('persisted outcome failed Core contract validation', {
      outcomeId: row.outcome_id,
    });
  }

  const record: OutcomeRecord = {
    outcomeId: outcomeId.data,
    runId: runId.data,
    status: status.data,
    metadata: metadataObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (missionId?.success) record.missionId = missionId.data;
  if (row.outcome_type !== null) record.outcomeType = row.outcome_type;
  if (row.external_reference !== null) record.externalReference = row.external_reference;
  const value = numberOrUndefined(row.value);
  if (value !== undefined) record.value = value;
  if (row.currency !== null) record.currency = row.currency;
  const measuredAt = toIsoOrUndefined(row.measured_at);
  if (measuredAt !== undefined) record.measuredAt = measuredAt;
  return record;
}

/** Projects an OutcomeRecord down to Core's minimal OutcomeReference. */
export function toOutcomeReference(record: OutcomeRecord): OutcomeReference {
  return OutcomeReference.parse({
    outcomeId: record.outcomeId,
    runId: record.runId,
    ...(record.missionId ? { missionId: record.missionId } : {}),
    status: record.status,
    ...(record.externalReference ? { externalReference: record.externalReference } : {}),
    metadata: record.metadata,
  });
}

/** Column values for INSERT/UPSERT. */
export function outcomeToColumns(record: OutcomeRecord): {
  outcome_id: string;
  run_id: string;
  mission_id: string | null;
  status: string;
  outcome_type: string | null;
  external_reference: string | null;
  value: number | null;
  currency: string | null;
  measured_at: string | null;
  metadata: string;
} {
  return {
    outcome_id: record.outcomeId,
    run_id: record.runId,
    mission_id: record.missionId ?? null,
    status: record.status,
    outcome_type: record.outcomeType ?? null,
    external_reference: record.externalReference ?? null,
    value: record.value ?? null,
    currency: record.currency ?? null,
    measured_at: record.measuredAt ?? null,
    metadata: JSON.stringify(record.metadata),
  };
}
