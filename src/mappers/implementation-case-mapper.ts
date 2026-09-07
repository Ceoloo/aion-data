import {
  ImplementationCase,
  ImplementationCaseId,
} from '@aion/core';
import type { ImplementationCaseRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, toIso } from './_shared.js';

/** Row → Core ImplementationCase. */
export function rowToImplementationCase(
  row: ImplementationCaseRow,
): ImplementationCase {
  const caseId = ImplementationCaseId.safeParse(row.case_id);
  if (!caseId.success) {
    throw new MappingError('persisted implementation case failed Core validation', {
      caseId: row.case_id,
    });
  }

  return ImplementationCase.parse({
    caseId: caseId.data,
    tenantId: row.tenant_id,
    clientRef: row.client_ref,
    clientName: row.client_name,
    ownerId: row.owner_id,
    commercialStatus: row.commercial_status,
    deliveryStatus: row.delivery_status,
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    evidenceLinks: Array.isArray(row.evidence_links) ? row.evidence_links : [],
    ...(row.intake ? { intake: row.intake } : {}),
    ...(row.recommendation ? { recommendation: row.recommendation } : {}),
    ...(row.blueprint ? { blueprint: row.blueprint } : {}),
    ...(row.provisioning ? { provisioning: row.provisioning } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metadata: metadataObject(row.metadata),
  });
}

export function implementationCaseToColumns(c: ImplementationCase): {
  case_id: string;
  tenant_id: string;
  client_ref: string;
  client_name: string;
  owner_id: string;
  commercial_status: string;
  delivery_status: string;
  next_action: string | null;
  blockers: string;
  evidence_links: string;
  intake: string | null;
  recommendation: string | null;
  blueprint: string | null;
  provisioning: string | null;
  created_at: string;
  updated_at: string;
  metadata: string;
} {
  return {
    case_id: c.caseId,
    tenant_id: c.tenantId,
    client_ref: c.clientRef,
    client_name: c.clientName,
    owner_id: c.ownerId,
    commercial_status: c.commercialStatus,
    delivery_status: c.deliveryStatus,
    next_action: c.nextAction ?? null,
    blockers: JSON.stringify(c.blockers ?? []),
    evidence_links: JSON.stringify(c.evidenceLinks ?? []),
    intake: c.intake ? JSON.stringify(c.intake) : null,
    recommendation: c.recommendation ? JSON.stringify(c.recommendation) : null,
    blueprint: c.blueprint ? JSON.stringify(c.blueprint) : null,
    provisioning: c.provisioning ? JSON.stringify(c.provisioning) : null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    metadata: JSON.stringify(c.metadata ?? {}),
  };
}
