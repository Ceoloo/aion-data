import { ApprovalRequest } from '@aion/core';
import type { ApprovalRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { toIso, toIsoOrUndefined } from './_shared.js';

/**
 * ApprovalRequest ⇄ row mapping.
 *
 * The full Core Command is persisted as the immutable `command_snapshot` jsonb
 * so a gated run can resume deterministically after a restart (the "command
 * durability" decision — see docs/phase-2.md). Reads re-validate the ENTIRE
 * request, command snapshot included, against the Core contract, so a corrupted
 * or drifted snapshot is caught at the boundary rather than resuming a run from
 * a malformed intent.
 */
export function rowToApprovalRequest(row: ApprovalRow): ApprovalRequest {
  const parsed = ApprovalRequest.safeParse({
    approvalId: row.approval_id,
    runId: row.run_id,
    requestId: row.request_id,
    ...(row.mission_id !== null ? { missionId: row.mission_id } : {}),
    command: row.command_snapshot,
    riskLevel: row.risk_level,
    reason: row.reason,
    status: row.status,
    requestedAt: toIso(row.requested_at),
    ...(row.decided_at !== null ? { decidedAt: toIsoOrUndefined(row.decided_at) } : {}),
    ...(row.decided_by !== null ? { decidedBy: row.decided_by } : {}),
    ...(row.note !== null ? { note: row.note } : {}),
  });
  if (!parsed.success) {
    throw new MappingError('persisted approval failed Core contract validation', {
      approvalId: row.approval_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for INSERT/UPSERT. `metadataObject` guards the snapshot shape. */
export function approvalToColumns(request: ApprovalRequest): {
  approval_id: string;
  run_id: string;
  request_id: string;
  mission_id: string | null;
  command_snapshot: string;
  risk_level: string;
  reason: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
} {
  return {
    approval_id: request.approvalId,
    run_id: request.runId,
    request_id: request.requestId,
    mission_id: request.missionId ?? null,
    command_snapshot: JSON.stringify(request.command),
    risk_level: request.riskLevel,
    reason: request.reason,
    status: request.status,
    requested_at: request.requestedAt,
    decided_at: request.decidedAt ?? null,
    decided_by: request.decidedBy ?? null,
    note: request.note ?? null,
  };
}
