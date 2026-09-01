import { Run } from '@aion/core';
import type { RunRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { toIso } from './_shared.js';

/**
 * Run ⇄ row mapping.
 *
 * The DB-only `version` column (optimistic concurrency) is NOT part of the Core
 * Run contract and is deliberately dropped on the way out — Core sees only its
 * own contract. The repository reads `version` separately for compare-and-save.
 */
export function rowToRun(row: RunRow): Run {
  const parsed = Run.safeParse({
    runId: row.run_id,
    requestId: row.request_id,
    ...(row.mission_id !== null ? { missionId: row.mission_id } : {}),
    ...(row.workflow_id !== null ? { workflowId: row.workflow_id } : {}),
    commandId: row.command_id,
    actorId: row.actor_id,
    state: row.state,
    ...(row.risk_level !== null ? { riskLevel: row.risk_level } : {}),
    ...(row.approval_id !== null ? { approvalId: row.approval_id } : {}),
    correlationId: row.correlation_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
  if (!parsed.success) {
    throw new MappingError('persisted run failed Core contract validation', {
      runId: row.run_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for INSERT/UPSERT (version is managed by the repository). */
export function runToColumns(run: Run): {
  run_id: string;
  request_id: string;
  mission_id: string | null;
  workflow_id: string | null;
  command_id: string;
  actor_id: string;
  state: string;
  risk_level: string | null;
  approval_id: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
} {
  return {
    run_id: run.runId,
    request_id: run.requestId,
    mission_id: run.missionId ?? null,
    workflow_id: run.workflowId ?? null,
    command_id: run.commandId,
    actor_id: run.actorId,
    state: run.state,
    risk_level: run.riskLevel ?? null,
    approval_id: run.approvalId ?? null,
    correlation_id: run.correlationId,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}
