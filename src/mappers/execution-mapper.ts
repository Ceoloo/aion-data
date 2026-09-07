import { ExecutionObject } from '@aion/core';
import type { ExecutionRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import {
  metadataObject,
  numberOrUndefined,
  toIso,
  toIsoOrUndefined,
} from './_shared.js';

/**
 * Execution Object ⇄ row mapping.
 *
 * Persists Core's canonical `aion_execution` contract. Cost and audit_trace are
 * jsonb; identity, status, autonomy, and refs are relational columns.
 */
export function rowToExecution(row: ExecutionRow): ExecutionObject {
  const cost =
    row.cost && typeof row.cost === 'object' && !Array.isArray(row.cost)
      ? (row.cost as Record<string, unknown>)
      : { units: 0 };
  const auditTrace = Array.isArray(row.audit_trace) ? row.audit_trace : [];

  const candidate = {
    executionId: row.execution_id,
    actorId: row.actor_id,
    ...(row.agent_uri ? { agentUri: row.agent_uri } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.domain ? { domain: row.domain } : {}),
    ...(row.company_id ? { companyId: row.company_id } : {}),
    ...(row.venture_id ? { ventureId: row.venture_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_execution_id
      ? { parentExecutionId: row.parent_execution_id }
      : {}),
    ...(row.root_execution_id ? { rootExecutionId: row.root_execution_id } : {}),
    runId: row.run_id,
    requestId: row.request_id,
    commandId: row.command_id,
    ...(row.mission_id ? { missionId: row.mission_id } : {}),
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    correlationId: row.correlation_id,
    status: row.status,
    autonomyLevel: row.autonomy_level,
    ...(row.risk_level ? { riskLevel: row.risk_level } : {}),
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    cost,
    ...(row.outcome_id ? { outcomeId: row.outcome_id } : {}),
    ...(row.outcome_summary ? { outcomeSummary: row.outcome_summary } : {}),
    ...(row.revenue_attributed !== null
      ? { revenueAttributed: numberOrUndefined(row.revenue_attributed) }
      : {}),
    auditTrace,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(row.started_at ? { startedAt: toIsoOrUndefined(row.started_at) } : {}),
    ...(row.completed_at
      ? { completedAt: toIsoOrUndefined(row.completed_at) }
      : {}),
    metadata: metadataObject(row.metadata),
  };

  const parsed = ExecutionObject.safeParse(candidate);
  if (!parsed.success) {
    throw new MappingError('persisted execution failed Core contract validation', {
      executionId: row.execution_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function executionToColumns(exe: ExecutionObject): {
  execution_id: string;
  actor_id: string;
  agent_uri: string | null;
  tenant_id: string | null;
  domain: string | null;
  company_id: string | null;
  venture_id: string | null;
  project_id: string | null;
  parent_execution_id: string | null;
  root_execution_id: string | null;
  run_id: string;
  request_id: string;
  command_id: string;
  mission_id: string | null;
  workflow_id: string | null;
  correlation_id: string;
  status: string;
  autonomy_level: string;
  risk_level: string | null;
  approval_id: string | null;
  cost: string;
  outcome_id: string | null;
  outcome_summary: string | null;
  revenue_attributed: number | null;
  audit_trace: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
} {
  return {
    execution_id: exe.executionId,
    actor_id: exe.actorId,
    agent_uri: exe.agentUri ?? null,
    tenant_id: exe.tenantId ?? null,
    domain: exe.domain ?? null,
    company_id: exe.companyId ?? null,
    venture_id: exe.ventureId ?? null,
    project_id: exe.projectId ?? null,
    parent_execution_id: exe.parentExecutionId ?? null,
    root_execution_id: exe.rootExecutionId ?? null,
    run_id: exe.runId,
    request_id: exe.requestId,
    command_id: exe.commandId,
    mission_id: exe.missionId ?? null,
    workflow_id: exe.workflowId ?? null,
    correlation_id: exe.correlationId,
    status: exe.status,
    autonomy_level: exe.autonomyLevel,
    risk_level: exe.riskLevel ?? null,
    approval_id: exe.approvalId ?? null,
    cost: JSON.stringify(exe.cost),
    outcome_id: exe.outcomeId ?? null,
    outcome_summary: exe.outcomeSummary ?? null,
    revenue_attributed: exe.revenueAttributed ?? null,
    audit_trace: JSON.stringify(exe.auditTrace),
    started_at: exe.startedAt ?? null,
    completed_at: exe.completedAt ?? null,
    metadata: JSON.stringify(exe.metadata),
    created_at: exe.createdAt,
    updated_at: exe.updatedAt,
  };
}
