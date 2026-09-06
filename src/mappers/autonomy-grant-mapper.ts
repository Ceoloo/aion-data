import {
  AgentId,
  AutonomyEvidence,
  AutonomyGrant,
  AutonomyGrantId,
  Capability,
  ServiceKey,
} from '@aion/core';
import type { AutonomyGrantRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, toIso, toIsoOrUndefined } from './_shared.js';

/** Row → Core AutonomyGrant. */
export function rowToAutonomyGrant(row: AutonomyGrantRow): AutonomyGrant {
  const grantId = AutonomyGrantId.safeParse(row.grant_id);
  const agentId = AgentId.safeParse(row.agent_id);
  const serviceKey =
    row.service_key !== null ? ServiceKey.safeParse(row.service_key) : undefined;
  const capability =
    row.capability !== null ? Capability.safeParse(row.capability) : undefined;
  const evidence = AutonomyEvidence.safeParse(row.evidence ?? {});

  if (
    !grantId.success ||
    !agentId.success ||
    !evidence.success ||
    (serviceKey && !serviceKey.success) ||
    (capability && !capability.success)
  ) {
    throw new MappingError('persisted autonomy grant failed Core validation', {
      grantId: row.grant_id,
    });
  }

  return AutonomyGrant.parse({
    grantId: grantId.data,
    agentId: agentId.data,
    ...(serviceKey?.success ? { serviceKey: serviceKey.data } : {}),
    ...(capability?.success ? { capability: capability.data } : {}),
    tenantId: row.tenant_id,
    environment: row.environment,
    currentLevel: row.current_level,
    eligibleLevel: row.eligible_level,
    evidence: evidence.data,
    status: row.status,
    grantReason: row.grant_reason,
    grantedBy: row.granted_by,
    l4Allowed: row.l4_allowed,
    maxWaiveRisk: row.max_waive_risk,
    lastReviewedAt: toIso(row.last_reviewed_at),
    createdAt: toIso(row.created_at),
    ...(row.revoked_at
      ? { revokedAt: toIsoOrUndefined(row.revoked_at) }
      : {}),
    ...(row.revoke_reason ? { revokeReason: row.revoke_reason } : {}),
    metadata: metadataObject(row.metadata),
  });
}

export function autonomyGrantToColumns(g: AutonomyGrant): {
  grant_id: string;
  agent_id: string;
  service_key: string | null;
  capability: string | null;
  tenant_id: string;
  environment: string;
  current_level: string;
  eligible_level: string;
  evidence: string;
  status: string;
  grant_reason: string;
  granted_by: string;
  l4_allowed: boolean;
  max_waive_risk: string;
  last_reviewed_at: string;
  created_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  metadata: string;
} {
  return {
    grant_id: g.grantId,
    agent_id: g.agentId,
    service_key: g.serviceKey ?? null,
    capability: g.capability ?? null,
    tenant_id: g.tenantId,
    environment: g.environment,
    current_level: g.currentLevel,
    eligible_level: g.eligibleLevel,
    evidence: JSON.stringify(g.evidence),
    status: g.status,
    grant_reason: g.grantReason,
    granted_by: g.grantedBy,
    l4_allowed: g.l4Allowed,
    max_waive_risk: g.maxWaiveRisk,
    last_reviewed_at: g.lastReviewedAt,
    created_at: g.createdAt,
    revoked_at: g.revokedAt ?? null,
    revoke_reason: g.revokeReason ?? null,
    metadata: JSON.stringify(g.metadata),
  };
}
