import { Mission } from '@aion/core';
import type { MissionRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, stringArray, toIso } from './_shared.js';

/**
 * Mission ⇄ row mapping.
 *
 * Reads validate the persisted row against the Core Mission contract before
 * returning it — the boundary never hands Core an object Core would reject
 * (aion-docs/engineering/data-contracts.md). Writes produce the ordered column
 * values for an upsert.
 */
export function rowToMission(row: MissionRow): Mission {
  const parsed = Mission.safeParse({
    missionId: row.mission_id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    status: row.status,
    objective: row.objective,
    successCriteria: stringArray(row.success_criteria),
    riskLevel: row.risk_level,
    createdAt: toIso(row.created_at),
    metadata: metadataObject(row.metadata),
  });
  if (!parsed.success) {
    throw new MappingError('persisted mission failed Core contract validation', {
      missionId: row.mission_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for INSERT/UPSERT, in a fixed, documented order. */
export function missionToColumns(mission: Mission): {
  mission_id: string;
  name: string;
  description: string;
  owner: string;
  status: string;
  objective: string;
  success_criteria: string;
  risk_level: string;
  metadata: string;
  created_at: string;
} {
  return {
    mission_id: mission.missionId,
    name: mission.name,
    description: mission.description,
    owner: mission.owner,
    status: mission.status,
    objective: mission.objective,
    success_criteria: JSON.stringify(mission.successCriteria),
    risk_level: mission.riskLevel,
    metadata: JSON.stringify(mission.metadata),
    created_at: mission.createdAt,
  };
}
