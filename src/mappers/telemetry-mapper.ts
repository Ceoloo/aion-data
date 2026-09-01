import { TelemetryRecord } from '@aion/core';
import type { TelemetryRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, numberOrUndefined, toIso } from './_shared.js';

/**
 * TelemetryRecord ⇄ row mapping.
 *
 * Core's TelemetryRecord carries no identity of its own; the DB-minted
 * `telemetry_id` and `seq` are storage concerns and are dropped on the way out.
 * numeric columns (duration_ms, token_usage, cost) come back from pg as strings
 * and are converted to numbers. Telemetry is append-only — no update mapping.
 */
export function rowToTelemetryRecord(row: TelemetryRow): TelemetryRecord {
  const parsed = TelemetryRecord.safeParse({
    timestamp: toIso(row.occurred_at),
    operation: row.operation,
    status: row.status,
    ...(row.request_id !== null ? { requestId: row.request_id } : {}),
    ...(row.mission_id !== null ? { missionId: row.mission_id } : {}),
    ...(row.workflow_id !== null ? { workflowId: row.workflow_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.command_id !== null ? { commandId: row.command_id } : {}),
    ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    ...(row.tool_id !== null ? { toolId: row.tool_id } : {}),
    ...(row.approval_id !== null ? { approvalId: row.approval_id } : {}),
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    ...(row.actor_type !== null ? { actorType: row.actor_type } : {}),
    ...(row.tool_used !== null ? { toolUsed: row.tool_used } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.input_context_reference !== null
      ? { inputContextReference: row.input_context_reference }
      : {}),
    ...(row.decision !== null ? { decision: row.decision } : {}),
    ...(row.duration_ms !== null ? { durationMs: numberOrUndefined(row.duration_ms) } : {}),
    ...(row.executor !== null ? { executor: row.executor } : {}),
    ...(row.token_usage !== null ? { tokenUsage: numberOrUndefined(row.token_usage) } : {}),
    ...(row.cost !== null ? { cost: numberOrUndefined(row.cost) } : {}),
    ...(row.risk_level !== null ? { riskLevel: row.risk_level } : {}),
    ...(row.approval_state !== null ? { approvalState: row.approval_state } : {}),
    ...(row.outcome_reference !== null ? { outcomeReference: row.outcome_reference } : {}),
    metadata: metadataObject(row.metadata),
  });
  if (!parsed.success) {
    throw new MappingError('persisted telemetry failed Core contract validation', {
      operation: row.operation,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for append (INSERT). telemetry_id/seq are DB-generated. */
export function telemetryToColumns(record: TelemetryRecord): {
  occurred_at: string;
  operation: string;
  status: string;
  request_id: string | null;
  mission_id: string | null;
  workflow_id: string | null;
  run_id: string | null;
  command_id: string | null;
  actor_id: string | null;
  agent_id: string | null;
  tool_id: string | null;
  approval_id: string | null;
  correlation_id: string | null;
  actor_type: string | null;
  tool_used: string | null;
  model: string | null;
  input_context_reference: string | null;
  decision: string | null;
  duration_ms: number | null;
  executor: string | null;
  token_usage: number | null;
  cost: number | null;
  risk_level: string | null;
  approval_state: string | null;
  outcome_reference: string | null;
  metadata: string;
} {
  return {
    occurred_at: record.timestamp,
    operation: record.operation,
    status: record.status,
    request_id: record.requestId ?? null,
    mission_id: record.missionId ?? null,
    workflow_id: record.workflowId ?? null,
    run_id: record.runId ?? null,
    command_id: record.commandId ?? null,
    actor_id: record.actorId ?? null,
    agent_id: record.agentId ?? null,
    tool_id: record.toolId ?? null,
    approval_id: record.approvalId ?? null,
    correlation_id: record.correlationId ?? null,
    actor_type: record.actorType ?? null,
    tool_used: record.toolUsed ?? null,
    model: record.model ?? null,
    input_context_reference: record.inputContextReference ?? null,
    decision: record.decision ?? null,
    duration_ms: record.durationMs ?? null,
    executor: record.executor ?? null,
    token_usage: record.tokenUsage ?? null,
    cost: record.cost ?? null,
    risk_level: record.riskLevel ?? null,
    approval_state: record.approvalState ?? null,
    outcome_reference: record.outcomeReference ?? null,
    metadata: JSON.stringify(record.metadata),
  };
}
