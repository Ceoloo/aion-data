-- ============================================================================
-- Migration 0002 — Canonical Execution Object + agent identity fields
-- ============================================================================
-- Week 1 Execution Platform primitives (Notion Progress Assessment, Sep 2026):
--   1. Expand `actors` with agent identity / permission-registry fields so
--      agents carry agent://aion/{domain}/{role}/{id}, autonomy, allowed data,
--      I/O contracts, evals, and observability requirements.
--   2. Add `executions` (aion_execution) — the canonical Execution Object that
--      converges runs, gateway records, and product sessions into one durable
--      enterprise labor unit. Runtime's HTTP surface (reconciled Execution
--      Gateway — not a second gateway) is the write path.
--
-- Additive only. Existing rows keep NULL/default for new agent columns.
-- ============================================================================

-- ── actors: agent identity + permission-registry fields ─────────────────────
ALTER TABLE actors
  ADD COLUMN agent_uri                    text,
  ADD COLUMN domain                       text,
  ADD COLUMN role                         text,
  ADD COLUMN tenant_id                    text,
  ADD COLUMN autonomy_level               text
    CHECK (autonomy_level IS NULL OR autonomy_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  ADD COLUMN allowed_data                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN input_contract               text,
  ADD COLUMN output_contract              text,
  ADD COLUMN evaluation_criteria          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN observability_requirements   jsonb NOT NULL DEFAULT '[]'::jsonb;

-- agent_uri is unique when present (canonical attributable handle).
CREATE UNIQUE INDEX actors_agent_uri_key ON actors (agent_uri) WHERE agent_uri IS NOT NULL;
CREATE INDEX actors_tenant_id_idx ON actors (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX actors_domain_role_idx ON actors (domain, role)
  WHERE domain IS NOT NULL AND role IS NOT NULL;

-- Non-agents must not carry agent-only identity columns.
ALTER TABLE actors DROP CONSTRAINT actors_agent_fields_coherent;
ALTER TABLE actors ADD CONSTRAINT actors_agent_fields_coherent CHECK (
  (actor_type = 'agent'
    AND agent_id IS NOT NULL
    AND purpose IS NOT NULL
    AND owner IS NOT NULL
    AND default_risk_level IS NOT NULL)
  OR
  (actor_type <> 'agent'
    AND agent_id IS NULL
    AND purpose IS NULL
    AND owner IS NULL
    AND default_risk_level IS NULL
    AND agent_uri IS NULL
    AND domain IS NULL
    AND role IS NULL
    AND autonomy_level IS NULL
    AND input_contract IS NULL
    AND output_contract IS NULL)
);

-- ── executions (aion_execution) ─────────────────────────────────────────────
-- Canonical Execution Object. One row per governed unit of machine labor.
-- `run_id` is unique: one execution record mirrors one Core Run. Cost / outcome
-- / audit fields live here so products and gateways do not invent parallel
-- records.
CREATE TABLE executions (
  execution_id          text PRIMARY KEY,
  actor_id              text NOT NULL REFERENCES actors (actor_id),
  agent_uri             text,
  tenant_id             text,
  domain                text,
  run_id                text NOT NULL UNIQUE REFERENCES runs (run_id),
  request_id            text NOT NULL,
  command_id            text NOT NULL,
  mission_id            text REFERENCES missions (mission_id),
  workflow_id           text,
  correlation_id        text NOT NULL,
  status                text NOT NULL
                          CHECK (status IN (
                            'created', 'evaluating', 'awaiting_approval', 'approved',
                            'executing', 'succeeded', 'failed', 'denied', 'cancelled'
                          )),
  autonomy_level        text NOT NULL DEFAULT 'L1'
                          CHECK (autonomy_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  risk_level            text CHECK (risk_level IS NULL OR risk_level IN ('R0', 'R1', 'R2', 'R3')),
  approval_id           text,
  cost                  jsonb NOT NULL DEFAULT '{"units":0}'::jsonb,
  -- No FK on outcome_id (mirrors runs.approval_id): outcomes reference runs,
  -- and linking here would create an insert-order hazard with the outcome
  -- repository. Integrity is application-enforced via Core OutcomeId brands.
  outcome_id            text,
  outcome_summary       text,
  revenue_attributed    numeric,
  audit_trace           jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at            timestamptz,
  completed_at          timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL
);

CREATE INDEX executions_actor_id_idx ON executions (actor_id);
CREATE INDEX executions_request_id_idx ON executions (request_id);
CREATE INDEX executions_status_idx ON executions (status);
CREATE INDEX executions_tenant_id_idx ON executions (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX executions_agent_uri_idx ON executions (agent_uri) WHERE agent_uri IS NOT NULL;
CREATE INDEX executions_correlation_id_idx ON executions (correlation_id);
