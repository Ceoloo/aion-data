import {
  AgentId,
  EvaluationId,
  EvaluationResult,
  ExecutionId,
  MissionId,
  ServiceKey,
  type PolicyEventRecord,
} from '@aion/core';
import type { EvaluationResultRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, numberOrUndefined, toIso } from './_shared.js';

/**
 * Fail closed on corrupt policy_events jsonb. Soft-coercing bad elements to
 * `{ kind: 'unknown' }` hid contract drift; MappingError surfaces it at the
 * persistence boundary instead.
 */
function policyEventsArray(v: unknown): PolicyEventRecord[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new MappingError('persisted evaluation policy_events must be a jsonb array', {
      policyEventsType: typeof v,
    });
  }
  return v.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new MappingError('persisted evaluation policy_events entry is not an object', {
        index,
      });
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.kind !== 'string' || rec.kind.length < 1) {
      throw new MappingError('persisted evaluation policy_events entry missing kind', {
        index,
      });
    }
    const out: PolicyEventRecord = { kind: rec.kind };
    if (
      rec.decision === 'ALLOW' ||
      rec.decision === 'DENY' ||
      rec.decision === 'REQUIRE_APPROVAL'
    ) {
      out.decision = rec.decision;
    }
    if (typeof rec.detail === 'string') out.detail = rec.detail;
    return out;
  });
}

/** Row → Core EvaluationResult. */
export function rowToEvaluation(row: EvaluationResultRow): EvaluationResult {
  const evaluationId = EvaluationId.safeParse(row.evaluation_id);
  const executionId = ExecutionId.safeParse(row.execution_id);
  const missionId =
    row.mission_id !== null ? MissionId.safeParse(row.mission_id) : undefined;
  const agentId =
    row.agent_id !== null ? AgentId.safeParse(row.agent_id) : undefined;
  const serviceKey =
    row.service_key !== null ? ServiceKey.safeParse(row.service_key) : undefined;

  if (
    !evaluationId.success ||
    !executionId.success ||
    (missionId && !missionId.success) ||
    (agentId && !agentId.success) ||
    (serviceKey && !serviceKey.success)
  ) {
    throw new MappingError('persisted evaluation failed Core contract validation', {
      evaluationId: row.evaluation_id,
      executionId: row.execution_id,
    });
  }

  const economicValue = numberOrUndefined(
    row.economic_value === null || row.economic_value === undefined
      ? null
      : String(row.economic_value),
  );

  return EvaluationResult.parse({
    evaluationId: evaluationId.data,
    executionId: executionId.data,
    ...(missionId?.success ? { missionId: missionId.data } : {}),
    ...(serviceKey?.success ? { serviceKey: serviceKey.data } : {}),
    ...(row.service_version !== null
      ? { serviceVersion: row.service_version }
      : {}),
    ...(agentId?.success ? { agentId: agentId.data } : {}),
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.workflow_version
      ? { workflowVersion: row.workflow_version }
      : {}),
    qualityScore: Number(row.quality_score),
    success: row.success,
    latencyMs: Number(row.latency_ms),
    totalCost: Number(row.total_cost),
    humanIntervention: row.human_intervention,
    policyEvents: policyEventsArray(row.policy_events),
    ...(row.business_outcome
      ? { businessOutcome: row.business_outcome }
      : {}),
    ...(economicValue !== undefined ? { economicValue } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    evaluatedAt: toIso(row.evaluated_at),
    metadata: metadataObject(row.metadata),
  });
}

/** Column values for INSERT/UPSERT. */
export function evaluationToColumns(ev: EvaluationResult): {
  evaluation_id: string;
  execution_id: string;
  mission_id: string | null;
  service_key: string | null;
  service_version: number | null;
  agent_id: string | null;
  provider: string | null;
  model: string | null;
  workflow_version: string | null;
  quality_score: number;
  success: boolean;
  latency_ms: number;
  total_cost: number;
  human_intervention: boolean;
  policy_events: string;
  business_outcome: string | null;
  economic_value: number | null;
  tenant_id: string | null;
  evaluated_at: string;
  metadata: string;
} {
  return {
    evaluation_id: ev.evaluationId,
    execution_id: ev.executionId,
    mission_id: ev.missionId ?? null,
    service_key: ev.serviceKey ?? null,
    service_version: ev.serviceVersion ?? null,
    agent_id: ev.agentId ?? null,
    provider: ev.provider ?? null,
    model: ev.model ?? null,
    workflow_version: ev.workflowVersion ?? null,
    quality_score: ev.qualityScore,
    success: ev.success,
    latency_ms: ev.latencyMs,
    total_cost: ev.totalCost,
    human_intervention: ev.humanIntervention,
    policy_events: JSON.stringify(ev.policyEvents),
    business_outcome: ev.businessOutcome ?? null,
    economic_value: ev.economicValue ?? null,
    tenant_id: ev.tenantId ?? null,
    evaluated_at: ev.evaluatedAt,
    metadata: JSON.stringify(ev.metadata),
  };
}
