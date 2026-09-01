/**
 * Database row shapes.
 *
 * These describe rows exactly as node-postgres returns them, and are kept
 * deliberately separate from AION Core's domain contracts (mappers translate
 * between the two — see src/mappers). node-postgres type mapping to remember:
 *   timestamptz → Date, numeric/bigint → string, jsonb → parsed value,
 *   integer → number, uuid/text → string.
 *
 * Nothing here leaks into Core. Core sees only its own contracts.
 */

export interface ActorRow {
  actor_id: string;
  actor_type: string;
  name: string;
  permissions: unknown;
  allowed_tools: unknown;
  forbidden_capabilities: unknown;
  max_risk_level: string;
  agent_id: string | null;
  purpose: string | null;
  owner: string | null;
  default_risk_level: string | null;
  escalation_conditions: unknown;
  cost_budget: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface MissionRow {
  mission_id: string;
  name: string;
  description: string;
  owner: string;
  status: string;
  objective: string;
  success_criteria: unknown;
  risk_level: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface RunRow {
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
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ApprovalRow {
  approval_id: string;
  run_id: string;
  request_id: string;
  mission_id: string | null;
  command_snapshot: Record<string, unknown>;
  risk_level: string;
  reason: string;
  status: string;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EventRow {
  event_id: string;
  event_type: string;
  occurred_at: Date;
  request_id: string | null;
  mission_id: string | null;
  workflow_id: string | null;
  run_id: string | null;
  actor_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  seq: string;
  recorded_at: Date;
}

export interface TelemetryRow {
  telemetry_id: string;
  occurred_at: Date;
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
  duration_ms: string | null;
  executor: string | null;
  token_usage: string | null;
  cost: string | null;
  risk_level: string | null;
  approval_state: string | null;
  outcome_reference: string | null;
  metadata: Record<string, unknown>;
  seq: string;
  recorded_at: Date;
}

export interface OutcomeRow {
  outcome_id: string;
  run_id: string;
  mission_id: string | null;
  status: string;
  outcome_type: string | null;
  external_reference: string | null;
  value: string | null;
  currency: string | null;
  measured_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
