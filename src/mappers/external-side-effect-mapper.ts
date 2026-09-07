import {
  ApprovalId,
  ExecutionId,
  ExternalSideEffect,
  ExternalSideEffectId,
  ServiceKey,
} from '@aion/core';
import type { ExternalSideEffectRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, toIso } from './_shared.js';

/** Row → Core ExternalSideEffect. */
export function rowToExternalSideEffect(row: ExternalSideEffectRow): ExternalSideEffect {
  const sideEffectId = ExternalSideEffectId.safeParse(row.side_effect_id);
  const executionId = ExecutionId.safeParse(row.execution_id);
  const serviceKey = ServiceKey.safeParse(row.service_key);
  const approvalId =
    row.approval_id !== null ? ApprovalId.safeParse(row.approval_id) : undefined;

  if (
    !sideEffectId.success ||
    !executionId.success ||
    !serviceKey.success ||
    (approvalId && !approvalId.success)
  ) {
    throw new MappingError('persisted external side-effect failed Core validation', {
      sideEffectId: row.side_effect_id,
    });
  }

  return ExternalSideEffect.parse({
    sideEffectId: sideEffectId.data,
    executionId: executionId.data,
    tenantId: row.tenant_id,
    serviceKey: serviceKey.data,
    idempotencyKey: row.idempotency_key,
    requestedAction: row.requested_action,
    performedAt: toIso(row.performed_at),
    status: row.status,
    provider: row.provider,
    ...(row.external_resource_id
      ? { externalResourceId: row.external_resource_id }
      : {}),
    ...(row.external_request_id ? { externalRequestId: row.external_request_id } : {}),
    ...(approvalId?.success ? { approvalId: approvalId.data } : {}),
    ...(row.result_hash ? { resultHash: row.result_hash } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    metadata: metadataObject(row.metadata),
  });
}

export function externalSideEffectToColumns(e: ExternalSideEffect): {
  side_effect_id: string;
  execution_id: string;
  tenant_id: string;
  service_key: string;
  idempotency_key: string;
  external_resource_id: string | null;
  external_request_id: string | null;
  requested_action: string;
  approval_id: string | null;
  performed_at: string;
  result_hash: string | null;
  status: string;
  provider: string;
  error_code: string | null;
  error_message: string | null;
  metadata: string;
} {
  return {
    side_effect_id: e.sideEffectId,
    execution_id: e.executionId,
    tenant_id: e.tenantId,
    service_key: e.serviceKey,
    idempotency_key: e.idempotencyKey,
    external_resource_id: e.externalResourceId ?? null,
    external_request_id: e.externalRequestId ?? null,
    requested_action: e.requestedAction,
    approval_id: e.approvalId ?? null,
    performed_at: e.performedAt,
    result_hash: e.resultHash ?? null,
    status: e.status,
    provider: e.provider,
    error_code: e.errorCode ?? null,
    error_message: e.errorMessage ?? null,
    metadata: JSON.stringify(e.metadata ?? {}),
  };
}
