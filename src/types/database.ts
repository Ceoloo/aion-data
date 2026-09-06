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
  agent_uri: string | null;
  domain: string | null;
  role: string | null;
  tenant_id: string | null;
  company_id: string | null;
  venture_id: string | null;
  project_id: string | null;
  autonomy_level: string | null;
  allowed_data: unknown;
  input_contract: string | null;
  output_contract: string | null;
  evaluation_criteria: unknown;
  observability_requirements: unknown;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ExecutionRow {
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
  cost: unknown;
  outcome_id: string | null;
  outcome_summary: string | null;
  revenue_attributed: string | null;
  audit_trace: unknown;
  started_at: Date | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceRow {
  service_id: string;
  service_key: string;
  name: string;
  version: number;
  capability: string;
  owner: string;
  description: string | null;
  input_schema_ref: string | null;
  output_schema_ref: string | null;
  required_permissions: unknown;
  agent_compatibility: unknown;
  tools: unknown;
  risk_level: string;
  approval_required: boolean;
  cost_hint_units: string | null;
  sla_hint: string | null;
  eval_refs: unknown;
  consumers: unknown;
  workflow_id: string | null;
  status: string;
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

export interface WorkflowRow {
  workflow_id: string;
  name: string;
  description: string;
  version: string;
  steps: unknown;
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
  execution_id: string | null;
  tenant_id: string | null;
  command_snapshot: Record<string, unknown>;
  risk_level: string;
  reason: string;
  status: string;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  note: string | null;
  expires_at: Date | null;
  consumed_at: Date | null;
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

/** Mission 007 — durable EvaluationResult row. */
export interface EvaluationResultRow {
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
  policy_events: unknown;
  business_outcome: string | null;
  economic_value: string | number | null;
  tenant_id: string | null;
  evaluated_at: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
}

/** Mission 008 — durable AutonomyGrant row. */
export interface AutonomyGrantRow {
  grant_id: string;
  agent_id: string;
  service_key: string | null;
  capability: string | null;
  tenant_id: string;
  environment: string;
  current_level: string;
  eligible_level: string;
  evidence: unknown;
  status: string;
  grant_reason: string;
  granted_by: string;
  l4_allowed: boolean;
  max_waive_risk: string;
  last_reviewed_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
  metadata: Record<string, unknown>;
}
